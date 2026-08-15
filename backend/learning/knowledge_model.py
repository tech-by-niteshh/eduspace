"""
Student knowledge modelling.

INTEGRATION POINT — not implemented yet.

Every function here returns None, which the API layer reports as
"available: false". The frontend renders that as an empty state and never
fabricates a knowledge estimate. Fill these in and the dashboard, learning
page and quiz page pick the results up without further changes.
"""

from typing import Optional


def update_knowledge_state(
    student_id: str,
    topic_id: str,
    question_id: str,
    is_correct: bool,
) -> Optional[dict]:
    """Fold one answered question into the student's knowledge state.

    Expected return once implemented::

        {"topic_id": str, "mastery": float, "confidence": float, "answered": int}
    """
    return None


def get_knowledge_state(student_id: str) -> Optional[dict]:
    """Return the student's current per-topic mastery estimates.

    Expected return once implemented::

        {"topics": [{"topic_id": str, "mastery": float}, ...]}
    """
    return None
