"""
Misconception detection.

INTEGRATION POINT — not implemented yet.

Returning None means "no analysis available". The dashboard falls back to a
plain correct/incorrect threshold and labels it as such, so nothing is ever
presented as a detected misconception when it is not one.
"""

from typing import Optional, List


def detect(
    student_id: str,
    topic_id: str,
    question_id: str,
    chosen_option: str,
) -> Optional[dict]:
    """Identify the misconception behind one wrong answer.

    Expected return once implemented::

        {"id": str, "label": str, "description": str, "confidence": float}
    """
    return None


def list_for_student(student_id: str) -> Optional[List[dict]]:
    """Return the misconceptions currently believed to be active.

    Expected return once implemented::

        [{"topic": str, "description": str, "confidence": float}, ...]

    The dashboard reads this through EduSpace.insights.misconceptions().
    """
    return None
