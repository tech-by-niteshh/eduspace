"""
EduSpace learning pipeline.

Wires the existing modules together in the order the system is designed to
run, without inventing behaviour for the ones that are not written yet:

    Student answer
          v
    Knowledge model        (learning/knowledge_model.py)
          v
    Misconception analysis (ai/misconception.py)
          v
    Adaptive engine        (learning/adaptive_engine.py)
          v
    Question / explanation (ai/question_generator.py, ai/tutor.py)
          v
    Updated progress       (learning/progress_predictor.py)

Every stage currently returns None. `run` therefore reports which stages
produced something and sets ``available`` to False, so the frontend can show
an honest empty state instead of a fabricated result. As each module is
implemented its stage starts returning data and ``available`` flips to True
on its own — no changes are needed here or in the frontend.
"""

from typing import Optional

from ai import misconception, question_generator, tutor
from learning import adaptive_engine, knowledge_model, progress_predictor

#: Stage name -> module that owns it. Used by the status endpoint.
STAGES = (
    ("knowledge_model", "backend/learning/knowledge_model.py"),
    ("misconception", "backend/ai/misconception.py"),
    ("adaptive_engine", "backend/learning/adaptive_engine.py"),
    ("question_generator", "backend/ai/question_generator.py"),
    ("tutor", "backend/ai/tutor.py"),
    ("progress_predictor", "backend/learning/progress_predictor.py"),
)


def run(
    student_id: str,
    topic_id: str,
    question_id: str,
    chosen_option: str,
    is_correct: bool,
) -> dict:
    """Run one answered question through the whole pipeline.

    Returns a dict whose ``stages`` values are None for anything not yet
    implemented. Nothing here substitutes a placeholder for a real result.
    """
    knowledge_state = knowledge_model.update_knowledge_state(
        student_id, topic_id, question_id, is_correct
    )

    detected: Optional[dict] = None
    explanation: Optional[str] = None
    if not is_correct:
        detected = misconception.detect(student_id, topic_id, question_id, chosen_option)
        explanation = tutor.explain_mistake(
            student_id, topic_id, question_id, chosen_option, detected
        )

    next_step = adaptive_engine.next_step(student_id, knowledge_state, detected)
    difficulty = adaptive_engine.recommend_difficulty(student_id, topic_id, knowledge_state)

    next_questions = None
    if next_step:
        next_questions = question_generator.generate_for_topic(
            next_step.get("topic_id", topic_id), difficulty or "same"
        )

    projection = progress_predictor.predict(student_id, knowledge_state)

    stages = {
        "knowledge_model": knowledge_state,
        "misconception": detected,
        "adaptive_engine": next_step,
        "question_generator": next_questions,
        "tutor": explanation,
        "progress_predictor": projection,
    }

    return {
        "available": any(value is not None for value in stages.values()),
        "stages": stages,
    }


def status() -> dict:
    """Report which pipeline stages are implemented.

    A stage counts as implemented once its entry point returns anything other
    than None for a probe call.
    """
    probe = run(
        student_id="__probe__",
        topic_id="__probe__",
        question_id="__probe__",
        chosen_option="__probe__",
        is_correct=False,
    )
    implemented = {name: probe["stages"][name] is not None for name, _ in STAGES}
    return {
        "available": probe["available"],
        "stages": [
            {"name": name, "module": module, "implemented": implemented[name]}
            for name, module in STAGES
        ],
    }
