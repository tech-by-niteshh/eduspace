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

from ai import prompts
from ai.providers import gemini_generate, groq_chat

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
# Quiz — separate integration point (ai/question_generator.py already owns
# quiz question generation). Left unimplemented here; out of scope for the
# learning-path feature.
# ---------------------------------------------------------------------------
def get_question(concept: str) -> str:
    pass
