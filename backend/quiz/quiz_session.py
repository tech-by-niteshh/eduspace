"""
In-memory storage for AI-generated quiz sessions.

Mirrors learning/learning_session.py: EduSpace has no database for AI
content, so a quiz session lives in this process's memory only, addressed
by a generated quiz id, and is never required for the app to keep working
elsewhere. Sessions expire after an hour so a long-abandoned quiz does not
sit in memory forever.

The stored question objects keep their authoritative correct_answer index —
quiz_service.py strips that field before anything is sent to the browser.
"""

import time
import uuid
from typing import Optional

_SESSIONS: dict = {}

_SESSION_TTL_SECONDS = 60 * 60


def _sweep() -> None:
    now = time.time()
    expired = [qid for qid, session in _SESSIONS.items() if now - session["created_at"] > _SESSION_TTL_SECONDS]
    for qid in expired:
        _SESSIONS.pop(qid, None)


def create_session(topic: str, questions: list) -> str:
    """``questions`` is the full, authoritative list from ai_agent.generate_quiz."""
    _sweep()
    quiz_id = str(uuid.uuid4())
    _SESSIONS[quiz_id] = {
        "topic": topic,
        "questions": {q["id"]: q for q in questions},
        "answers": {},  # question_id -> {"selected_answer", "correct", "feedback"}
        "created_at": time.time(),
        "completed": False,
    }
    return quiz_id


def get_session(quiz_id: str) -> Optional[dict]:
    return _SESSIONS.get(quiz_id)


def record_answer(quiz_id: str, question_id: int, selected_answer: int, correct: bool, feedback: dict) -> None:
    session = _SESSIONS.get(quiz_id)
    if not session:
        return
    session["answers"][question_id] = {
        "selected_answer": selected_answer,
        "correct": correct,
        "feedback": feedback,
    }


def mark_completed(quiz_id: str) -> None:
    session = _SESSIONS.get(quiz_id)
    if session:
        session["completed"] = True
