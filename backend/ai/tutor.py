"""
AI tutor explanations.

INTEGRATION POINT — not implemented yet.

Until this returns real text, the learning page shows an empty tutor note
rather than a generic or invented explanation.
"""

from typing import Optional


def explain_mistake(
    student_id: str,
    topic_id: str,
    question_id: str,
    chosen_option: str,
    misconception: Optional[dict] = None,
) -> Optional[str]:
    """Explain the specific error this student made, in plain language."""
    return None


def topic_note(student_id: str, topic_id: str) -> Optional[str]:
    """A short note about this student's pattern on this topic.

    Read by the learning page through EduSpace.insights.tutorNote().
    """
    return None
