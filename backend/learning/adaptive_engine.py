"""
Adaptive difficulty and learning-path selection.

INTEGRATION POINT — not implemented yet.
"""

from typing import Optional


def next_step(
    student_id: str,
    knowledge_state: Optional[dict] = None,
    misconception: Optional[dict] = None,
) -> Optional[dict]:
    """Choose what the student should do next.

    Expected return once implemented::

        {"topic_id": str, "reason": str, "difficulty": str}
    """
    return None


def recommend_difficulty(
    student_id: str,
    topic_id: str,
    knowledge_state: Optional[dict] = None,
) -> Optional[str]:
    """Return "easier" | "same" | "harder", or None when unknown."""
    return None
