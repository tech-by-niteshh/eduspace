"""
Insights API.

Exposes the learning pipeline over HTTP so the frontend can ask what the AI
layer currently knows. While the AI modules are unimplemented these routes
return ``available: false`` with null payloads — deliberately, so the UI can
show an empty state rather than a made-up one.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from ai import misconception, question_generator, tutor
from learning import knowledge_model, pipeline

router = APIRouter(prefix="/insights", tags=["Insights"])


class AnswerEvent(BaseModel):
    student_id: str
    topic_id: str
    question_id: str
    chosen_option: str
    is_correct: bool


@router.get("/status")
def insights_status():
    """Which pipeline stages are implemented right now."""
    return pipeline.status()


@router.post("/answer")
def submit_answer(event: AnswerEvent):
    """Run one answered question through the pipeline."""
    result = pipeline.run(
        student_id=event.student_id,
        topic_id=event.topic_id,
        question_id=event.question_id,
        chosen_option=event.chosen_option,
        is_correct=event.is_correct,
    )
    return {
        "success": True,
        "available": result["available"],
        "stages": result["stages"],
        "message": (
            "Pipeline ran."
            if result["available"]
            else "The AI modules are not implemented yet, so no analysis was produced."
        ),
    }


@router.get("/knowledge")
def knowledge_state(student_id: str):
    """Per-topic mastery estimates for one student."""
    state = knowledge_model.get_knowledge_state(student_id)
    return {"available": state is not None, "data": state}


@router.get("/misconceptions")
def misconceptions(student_id: str):
    """Misconceptions currently believed to be active for one student."""
    found = misconception.list_for_student(student_id)
    return {"available": found is not None, "data": found}


@router.get("/tutor-note")
def tutor_note(student_id: str, topic_id: str):
    """A short tutor note about this student on this topic."""
    note = tutor.topic_note(student_id, topic_id)
    return {"available": note is not None, "data": {"text": note} if note else None}


@router.get("/questions")
def generated_questions(topic_id: str, difficulty: str = "same"):
    """Generated practice questions, when the generator is implemented."""
    questions = question_generator.generate_for_topic(topic_id, difficulty)
    return {"available": questions is not None, "data": questions}
