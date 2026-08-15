"""
AI quiz API.

    POST /api/quiz/start    — generate a 5-question quiz for a topic (Gemini)
    POST /api/quiz/question — score one answer and explain it (Gemini)
    POST /api/quiz/result   — analyze the finished quiz (Groq)

The "/api" prefix is baked directly into this router (not added by a
rewrite or an ASGI wrapper) — see backend/server.py's docstring for why:
Vercel's Python runtime forwards the full "/api/*" path straight to the
FastAPI app in api/index.py, and FastAPI does its own routing from there,
so the app's own route paths must already be the real, final paths.

Same envelope convention as learning_router.py: {"success": true, ...} or
{"success": false, "error": {"code", "message"}}. AI failures and validation
failures both resolve to a friendly, generic message — provider details,
prompts and API keys never reach the client. Technical detail is logged
server-side only (see ai/ai_agent.py).
"""

import logging
import re

from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from backend.quiz import quiz_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/quiz", tags=["Quiz"])

MAX_TOPIC_LENGTH = 80
MIN_TOPIC_LENGTH = 2


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _error(code: str, message: str) -> dict:
    return {"success": False, "error": {"code": code, "message": message}}


class StartQuizRequest(BaseModel):
    topic: str

    @field_validator("topic")
    @classmethod
    def _bounded(cls, value: str) -> str:
        # Structural bound only — emptiness/content is judged after cleaning,
        # in the route, so the error message can be specific and friendly.
        return value[: MAX_TOPIC_LENGTH + 200] if value else value


class AnswerRequest(BaseModel):
    quiz_id: str
    question_id: int
    selected_answer: int


class ResultRequest(BaseModel):
    quiz_id: str


@router.post("/start")
def start(payload: StartQuizRequest):
    topic = _clean(payload.topic)

    if not topic:
        return _error("EMPTY_TOPIC", "Please tell EduSpace what you'd like to be quizzed on.")
    if len(topic) < MIN_TOPIC_LENGTH:
        return _error("TOPIC_TOO_SHORT", "That topic is a little too short. Try adding a word or two.")
    if len(topic) > MAX_TOPIC_LENGTH:
        return _error("TOPIC_TOO_LONG", f"Please keep the topic under {MAX_TOPIC_LENGTH} characters.")

    result = quiz_service.start_quiz(topic)
    if not result:
        return _error(
            "AI_PROVIDER_ERROR",
            "We couldn't prepare your quiz right now. Please try again in a moment.",
        )

    return {"success": True, **result}


@router.post("/question")
def answer(payload: AnswerRequest):
    quiz_id = _clean(payload.quiz_id)
    if not quiz_id:
        return _error("INVALID_REQUEST", "Missing quiz session.")

    try:
        result = quiz_service.submit_answer(quiz_id, payload.question_id, payload.selected_answer)
    except quiz_service.QuizError as exc:
        return _error(exc.code, exc.message)

    return {
        "success": True,
        # A new, opaque quiz_id — the frontend must use this one for the
        # next call (see backend/quiz/quiz_session.py for why: sessions are
        # stateless tokens, not server memory, so recording an answer means
        # issuing a new token rather than mutating one in place).
        "quiz_id": result["quiz_id"],
        "correct": result["correct"],
        "correct_index": result["correct_index"],
        "feedback": result["feedback"],
    }


@router.post("/result")
def result(payload: ResultRequest):
    quiz_id = _clean(payload.quiz_id)
    if not quiz_id:
        return _error("INVALID_REQUEST", "Missing quiz session.")

    try:
        analysis = quiz_service.finish_quiz(quiz_id)
    except quiz_service.QuizError as exc:
        return _error(exc.code, exc.message)

    return {"success": True, "result": analysis}
