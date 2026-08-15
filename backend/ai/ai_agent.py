"""
EduSpace AI learning functions.

Provider responsibilities are split on purpose (see prompts.py):
  - Groq   -> curriculum decomposition (get_topic_part), tutor note (get_ai_tutor_note)
  - Gemini -> summary (get_summary_of_each_topic), explanation (get_topic_explanation)

Every function here returns None on failure instead of raising or fabricating
content. Callers (learning_router.py) turn None into a clean, generic error
response — provider exceptions, prompts and API keys never reach the client.
"""

import json
import logging
import re
from typing import Optional

from backend.ai import prompts
from backend.ai.providers import gemini_generate, groq_chat

logger = logging.getLogger(__name__)

REQUIRED_PART_IDS = [1, 2, 3, 4, 5]
MAX_FIELD_LENGTH = 4000


def _validate_curriculum(data: object) -> Optional[dict]:
    """Return ``data`` if it matches the 5-part curriculum contract, else None."""
    if not isinstance(data, dict):
        return None

    topic = data.get("topic")
    parts = data.get("parts")
    if not isinstance(topic, str) or not topic.strip():
        return None
    if not isinstance(parts, list) or len(parts) != 5:
        return None

    seen_ids = []
    seen_titles = set()
    for part in parts:
        if not isinstance(part, dict):
            return None
        part_id = part.get("id")
        title = part.get("title")
        description = part.get("description")
        if not isinstance(part_id, int):
            return None
        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            return None
        if not isinstance(description, str) or not description.strip() or len(description) > 600:
            return None
        seen_ids.append(part_id)
        seen_titles.add(title.strip().lower())

    if sorted(seen_ids) != REQUIRED_PART_IDS:
        return None
    if len(seen_titles) != 5:
        return None  # duplicate titles

    return data


def _parse_json_object(raw: str) -> Optional[dict]:
    """Best-effort JSON parse: try straight, then strip stray code fences."""
    if not raw:
        return None
    candidate = raw.strip()
    try:
        return json.loads(candidate)
    except ValueError:
        pass

    # Some models wrap JSON in ```json ... ``` despite instructions not to.
    fenced = re.search(r"\{.*\}", candidate, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(0))
        except ValueError:
            return None
    return None


def get_topic_part(userConcept: str) -> Optional[dict]:
    """Ask Groq to split ``userConcept`` into exactly five ordered learning parts.

    Returns {"topic": str, "parts": [...]} on success, or None if the
    provider is unavailable or never produces a valid structure (one retry
    is attempted before giving up).
    """
    concept = (userConcept or "").strip()
    if not concept:
        return None

    user_message = f"Subject: {concept}"

    for attempt in range(2):
        raw = groq_chat(prompts.CURRICULUM_DECOMPOSER, user_message, json_mode=True, temperature=0.4)
        parsed = _parse_json_object(raw) if raw else None
        validated = _validate_curriculum(parsed) if parsed else None
        if validated:
            # Normalise part ordering to 1..5 regardless of provider order.
            validated["parts"] = sorted(validated["parts"], key=lambda p: p["id"])
            validated["topic"] = concept
            return validated
        logger.warning("Groq curriculum attempt %s failed validation.", attempt + 1)

    return None


def get_summary_of_each_topic(conceptName: str) -> Optional[str]:
    """Ask Gemini for an 80-150 word summary of one learning part."""
    concept = (conceptName or "").strip()
    if not concept:
        return None

    text = gemini_generate(
        prompts.SUMMARY_ENGINE,
        f"Learning part: {concept}",
        temperature=0.4,
        max_tokens=400,
    )
    text = (text or "").strip()
    if not text or len(text) > MAX_FIELD_LENGTH:
        return None
    return text


def get_topic_explanation(conceptName: str) -> Optional[str]:
    """Ask Gemini for a 150-300 word explanation of one learning part."""
    concept = (conceptName or "").strip()
    if not concept:
        return None

    text = gemini_generate(
        prompts.EXPLANATION_TUTOR,
        f"Learning part: {concept}",
        temperature=0.55,
        max_tokens=800,
    )
    text = (text or "").strip()
    if not text or len(text) > MAX_FIELD_LENGTH:
        return None
    return text


def get_ai_tutor_note(conceptName: str, student_context: Optional[dict] = None) -> Optional[str]:
    """Ask Groq for a short tutor note on one learning part.

    ``student_context`` is only ever real evidence supplied by the caller
    (e.g. quiz performance) — never fabricated here. When it is None, the
    note is phrased as general guidance rather than a personal diagnosis.
    """
    concept = (conceptName or "").strip()
    if not concept:
        return None

    user_message = f"Learning part: {concept}"
    if student_context:
        user_message += f"\nStudent evidence: {json.dumps(student_context)}"

    text = groq_chat(
        prompts.TUTOR_NOTE,
        user_message,
        json_mode=False,
        temperature=0.5,
        max_tokens=220,
    )
    text = (text or "").strip()
    if not text or len(text) > MAX_FIELD_LENGTH:
        return None
    return text


# ---------------------------------------------------------------------------
# AI quiz — Gemini generates questions and explains answers, Groq analyzes
# final performance. This provider split is deliberate (see prompts.py) and
# must not be swapped: Groq never writes quiz content, Gemini never scores
# a whole quiz.
#
# NOTE: this is a separate feature from ai/question_generator.py, which is
# the (unimplemented) integration point for the adaptive curriculum-practice
# pipeline in learning/pipeline.py. That pipeline is out of scope here.
# ---------------------------------------------------------------------------
QUIZ_QUESTION_COUNT = 5
QUIZ_OPTION_COUNT = 4
VALID_DIFFICULTIES = {"easy", "easy-medium", "medium", "medium-hard", "hard"}
VALID_PERFORMANCE_LEVELS = {"Excellent", "Strong", "Developing", "Needs Practice", "Needs Foundation"}


def _validate_quiz(data: object, topic: str) -> Optional[dict]:
    """Return a normalised {"topic", "questions"} dict, or None if invalid."""
    if not isinstance(data, dict):
        return None
    questions = data.get("questions")
    if not isinstance(questions, list) or len(questions) != QUIZ_QUESTION_COUNT:
        return None

    seen_ids = []
    seen_questions = set()
    normalised = []
    for q in questions:
        if not isinstance(q, dict):
            return None
        qid = q.get("id")
        prompt_text = q.get("question")
        options = q.get("options")
        correct = q.get("correct_answer")
        difficulty = str(q.get("difficulty") or "").strip().lower()

        if not isinstance(qid, int):
            return None
        if not isinstance(prompt_text, str) or not prompt_text.strip() or len(prompt_text) > 500:
            return None
        if not isinstance(options, list) or len(options) != QUIZ_OPTION_COUNT:
            return None
        if not all(isinstance(o, str) and o.strip() and len(o) <= 200 for o in options):
            return None
        if len({o.strip().lower() for o in options}) != QUIZ_OPTION_COUNT:
            return None  # duplicate options — not exactly one clearly correct answer
        if isinstance(correct, bool) or not isinstance(correct, int) or not (0 <= correct < QUIZ_OPTION_COUNT):
            return None
        if difficulty not in VALID_DIFFICULTIES:
            return None

        normalised_q = prompt_text.strip().lower()
        if normalised_q in seen_questions:
            return None  # duplicate question
        seen_questions.add(normalised_q)
        seen_ids.append(qid)

        normalised.append(
            {
                "id": qid,
                "question": prompt_text.strip(),
                "options": [o.strip() for o in options],
                "correct_answer": correct,
                "difficulty": difficulty,
            }
        )

    if sorted(seen_ids) != list(range(1, QUIZ_QUESTION_COUNT + 1)):
        return None

    normalised.sort(key=lambda item: item["id"])
    return {"topic": topic, "questions": normalised}


def generate_quiz(topic: str) -> Optional[dict]:
    """Ask Gemini for exactly five multiple-choice questions on ``topic``.

    Returns {"topic": str, "questions": [...]} with authoritative
    correct_answer indexes, or None if Gemini is unavailable or never
    produces a valid quiz (one retry is attempted before giving up).
    """
    clean_topic = (topic or "").strip()
    if not clean_topic:
        return None

    user_message = f"Topic: {clean_topic}"
    for attempt in range(2):
        raw = gemini_generate(prompts.QUIZ_ARCHITECT, user_message, temperature=0.6, max_tokens=2400)
        parsed = _parse_json_object(raw) if raw else None
        validated = _validate_quiz(parsed, clean_topic) if parsed else None
        if validated:
            return validated
        logger.warning("Gemini quiz generation attempt %s failed validation.", attempt + 1)

    return None


def _validate_answer_feedback(data: object) -> Optional[dict]:
    if not isinstance(data, dict):
        return None
    fields = {
        "correct_answer": data.get("correct_answer"),
        "explanation": data.get("explanation"),
        "solution": data.get("solution"),
        "concept": data.get("concept"),
        "learning_tip": data.get("learning_tip"),
    }
    if not all(isinstance(v, str) and v.strip() and len(v) <= 2000 for v in fields.values()):
        return None
    return {key: value.strip() for key, value in fields.items()}


def evaluate_quiz_answer(
    topic: str,
    question: str,
    options: list,
    correct_answer: str,
    selected_answer: str,
    is_correct: bool,
) -> Optional[dict]:
    """Ask Gemini to explain one already-scored quiz answer.

    Correctness is decided by the caller (quiz/quiz_service.py) from the
    authoritative stored question data, and passed in here as ground truth
    — this function only asks Gemini for the educational explanation text,
    never for the correct/incorrect verdict itself.
    """
    user_message = (
        f"Topic: {topic}\n"
        f"Question: {question}\n"
        f"Options: {json.dumps(options)}\n"
        f"Correct answer: {correct_answer}\n"
        f"Student's answer: {selected_answer}\n"
        f"Student was correct: {is_correct}"
    )

    for attempt in range(2):
        raw = gemini_generate(prompts.ANSWER_TUTOR, user_message, temperature=0.5, max_tokens=900)
        parsed = _parse_json_object(raw) if raw else None
        validated = _validate_answer_feedback(parsed) if parsed else None
        if validated:
            return validated
        logger.warning("Gemini answer evaluation attempt %s failed validation.", attempt + 1)

    return None


def _validate_quiz_analysis(data: object) -> Optional[dict]:
    if not isinstance(data, dict):
        return None
    performance_level = data.get("performance_level")
    summary = data.get("summary")
    strengths = data.get("strengths")
    weaknesses = data.get("weaknesses")
    revision_topics = data.get("revision_topics")
    recommendation = data.get("recommendation")
    next_step = data.get("next_step")

    if performance_level not in VALID_PERFORMANCE_LEVELS:
        return None
    if not isinstance(summary, str) or not summary.strip():
        return None
    if not isinstance(recommendation, str) or not recommendation.strip():
        return None
    if not isinstance(next_step, str) or not next_step.strip():
        return None
    for lst in (strengths, weaknesses, revision_topics):
        if not isinstance(lst, list) or not all(isinstance(x, str) and x.strip() for x in lst):
            return None

    return {
        "performance_level": performance_level,
        "summary": summary.strip(),
        "strengths": [s.strip() for s in strengths][:6],
        "weaknesses": [w.strip() for w in weaknesses][:6],
        "revision_topics": [r.strip() for r in revision_topics][:6],
        "recommendation": recommendation.strip(),
        "next_step": next_step.strip(),
    }


def analyze_quiz_result(topic: str, correct: int, total: int, breakdown: list) -> Optional[dict]:
    """Ask Groq to analyze a completed quiz's performance.

    ``correct``/``total`` are computed by the caller (quiz/quiz_service.py)
    and sent only as context — the caller overwrites score/total/percentage
    on the returned dict regardless of what Groq echoes back, so Groq's
    arithmetic is never trusted as the source of truth.
    """
    percentage = round((correct / total) * 100) if total else 0
    user_message = json.dumps(
        {
            "topic": topic,
            "total_questions": total,
            "correct_answers": correct,
            "percentage": percentage,
            "questions": breakdown,
        }
    )

    for attempt in range(2):
        raw = groq_chat(prompts.QUIZ_ANALYST, user_message, json_mode=True, temperature=0.4, max_tokens=1000)
        parsed = _parse_json_object(raw) if raw else None
        validated = _validate_quiz_analysis(parsed) if parsed else None
        if validated:
            return validated
        logger.warning("Groq quiz analysis attempt %s failed validation.", attempt + 1)

    return None
