"""
AI learning-path API.

    POST /learning/start  — decompose a student's topic into 5 parts (Groq)
    POST /learning/part   — generate one part's lesson content
                             (Gemini summary + Gemini explanation + Groq tutor
                             note, run concurrently since none depend on
                             each other)

Every response follows the same envelope: {"success": true, ...} or
{"success": false, "error": {"code", "message"}}. Provider failures and
validation failures both resolve to a friendly, generic message — nothing
about the underlying exception, prompt or API key is ever returned to the
client. Technical detail is logged server-side only.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from backend.ai import ai_agent
from backend.learning import learning_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/learning", tags=["Learning"])

MAX_TOPIC_LENGTH = 80
MIN_TOPIC_LENGTH = 2


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _error(code: str, message: str) -> dict:
    return {"success": False, "error": {"code": code, "message": message}}


class TopicRequest(BaseModel):
    topic: str

    @field_validator("topic")
    @classmethod
    def _bounded(cls, value: str) -> str:
        # Structural bound only — emptiness/content is judged after cleaning,
        # in the route, so the error message can be specific and friendly.
        return value[: MAX_TOPIC_LENGTH + 200] if value else value


class PartRequest(BaseModel):
    topic: str
    part_id: int
    part_title: str
    student_id: Optional[str] = None


@router.post("/start")
def start_learning(payload: TopicRequest):
    topic = _clean(payload.topic)

    if not topic:
        return _error("EMPTY_TOPIC", "Please tell EduSpace what you'd like to learn.")
    if len(topic) < MIN_TOPIC_LENGTH:
        return _error("TOPIC_TOO_SHORT", "That topic is a little too short. Try adding a word or two.")
    if len(topic) > MAX_TOPIC_LENGTH:
        return _error(
            "TOPIC_TOO_LONG", f"Please keep the topic under {MAX_TOPIC_LENGTH} characters."
        )

    result = ai_agent.get_topic_part(topic)
    if not result:
        return _error(
            "AI_PROVIDER_ERROR",
            "We couldn't build your learning path right now. Please try again in a moment.",
        )

    session_id = learning_session.create_session(result["topic"], result["parts"])

    return {
        "success": True,
        "session_id": session_id,
        "topic": result["topic"],
        "parts": result["parts"],
    }


@router.post("/part")
def get_part(payload: PartRequest):
    topic = _clean(payload.topic)
    title = _clean(payload.part_title)
    student_id = _clean(payload.student_id) if payload.student_id else None

    if not topic or not title:
        return _error("INVALID_REQUEST", "Missing topic or part information.")
    if payload.part_id not in (1, 2, 3, 4, 5):
        return _error("INVALID_REQUEST", "Invalid part id.")

    # Anonymous requests (no student_id) may reuse a cached generation for
    # the same topic+part within this process; personalized requests never
    # read or write the cache.
    if not student_id:
        cached = learning_session.get_cached_part(topic, payload.part_id)
        if cached:
            return {"success": True, "part": {"id": payload.part_id, "title": title, **cached}}

    concept = f"{topic} — {title}"
    student_context = {"student_id": student_id} if student_id else None

    with ThreadPoolExecutor(max_workers=3) as pool:
        summary_future = pool.submit(ai_agent.get_summary_of_each_topic, concept)
        explanation_future = pool.submit(ai_agent.get_topic_explanation, concept)
        tutor_note_future = pool.submit(ai_agent.get_ai_tutor_note, concept, student_context)

        summary = summary_future.result()
        explanation = explanation_future.result()
        tutor_note = tutor_note_future.result()

    if not summary or not explanation or not tutor_note:
        logger.error(
            "Part generation incomplete for %r (summary=%s explanation=%s tutor_note=%s).",
            concept,
            bool(summary),
            bool(explanation),
            bool(tutor_note),
        )
        return _error(
            "AI_PROVIDER_ERROR",
            "We couldn't prepare this lesson right now. Please try again in a moment.",
        )

    part_data = {"summary": summary, "explanation": explanation, "tutor_note": tutor_note}

    if not student_id:
        learning_session.cache_part(topic, payload.part_id, part_data)

    return {"success": True, "part": {"id": payload.part_id, "title": title, **part_data}}
