"""
Quiz business logic — generation, answer evaluation, and final analysis.

Provider split (see backend/ai/prompts.py):
    Gemini -> generate a quiz, explain one answer
    Groq   -> analyze the finished quiz

This module owns quiz-specific rules that are not AI concerns: stripping
correct answers before a question reaches the browser, the duplicate-
submission guard, and staying the authority on the final score. AI calls
and their output validation live in ai/ai_agent.py; HTTP concerns live in
quiz/quiz_router.py.
"""

from typing import Optional

from backend.ai import ai_agent
from backend.quiz import quiz_session

TOTAL_QUESTIONS = ai_agent.QUIZ_QUESTION_COUNT


class QuizError(Exception):
    """Raised for any expected failure; quiz_router.py turns this into a
    friendly {"success": false, "error": {...}} response."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _public_question(question: dict) -> dict:
    """Strip the correct answer before a question reaches the browser."""
    return {
        "id": question["id"],
        "question": question["question"],
        "options": question["options"],
        "difficulty": question["difficulty"],
    }


def start_quiz(topic: str) -> Optional[dict]:
    generated = ai_agent.generate_quiz(topic)
    if not generated:
        return None

    quiz_id = quiz_session.create_session(generated["topic"], generated["questions"])
    return {
        "quiz_id": quiz_id,
        "topic": generated["topic"],
        "total_questions": TOTAL_QUESTIONS,
        "questions": [_public_question(q) for q in generated["questions"]],
    }


def submit_answer(quiz_id: str, question_id: int, selected_answer: int) -> dict:
    session = quiz_session.get_session(quiz_id)
    if not session:
        raise QuizError("QUIZ_NOT_FOUND", "This quiz session has expired. Please start a new quiz.")

    question = session["questions"].get(question_id)
    if not question:
        raise QuizError("INVALID_QUESTION", "That question does not belong to this quiz.")

    # Idempotent: a duplicate submission (double click, retried request)
    # returns the original result instead of re-scoring or re-calling Gemini.
    # quiz_id is unchanged — nothing new was recorded, so there is no new token.
    existing = session["answers"].get(question_id)
    if existing:
        return {
            "quiz_id": quiz_id,
            "correct": existing["correct"],
            "correct_index": question["correct_answer"],
            "feedback": existing["feedback"],
        }

    if isinstance(selected_answer, bool) or not isinstance(selected_answer, int) or not (0 <= selected_answer <= 3):
        raise QuizError("INVALID_ANSWER", "Please select one of the four options.")

    is_correct = selected_answer == question["correct_answer"]
    correct_text = question["options"][question["correct_answer"]]
    selected_text = question["options"][selected_answer]

    feedback = ai_agent.evaluate_quiz_answer(
        topic=session["topic"],
        question=question["question"],
        options=question["options"],
        correct_answer=correct_text,
        selected_answer=selected_text,
        is_correct=is_correct,
    )
    if not feedback:
        raise QuizError(
            "AI_PROVIDER_ERROR",
            "We couldn't prepare feedback for that answer right now. Please try again.",
        )

    # There is no server-side session left to mutate — record_answer returns
    # a NEW token with this answer baked in, and the caller (quiz_router.py)
    # sends it back to the browser as the quiz_id to use from now on.
    new_quiz_id = quiz_session.record_answer(quiz_id, question_id, selected_answer, is_correct, feedback)
    if not new_quiz_id:
        raise QuizError("QUIZ_NOT_FOUND", "This quiz session has expired. Please start a new quiz.")

    return {
        "quiz_id": new_quiz_id,
        "correct": is_correct,
        "correct_index": question["correct_answer"],
        "feedback": feedback,
    }


def finish_quiz(quiz_id: str) -> dict:
    session = quiz_session.get_session(quiz_id)
    if not session:
        raise QuizError("QUIZ_NOT_FOUND", "This quiz session has expired. Please start a new quiz.")

    total = len(session["questions"])
    answers = session["answers"]
    if len(answers) < total:
        raise QuizError("INCOMPLETE_QUIZ", "Please answer all questions before viewing your results.")

    correct_count = sum(1 for a in answers.values() if a["correct"])
    percentage = round((correct_count / total) * 100) if total else 0

    # What Groq is allowed to see: question text, difficulty, whether it was
    # answered correctly, and the concept it tested (Gemini's own words from
    # evaluate_quiz_answer) — never the student's identity or raw options.
    breakdown = []
    for qid, question in session["questions"].items():
        answer = answers.get(qid, {})
        breakdown.append(
            {
                "question": question["question"],
                "difficulty": question["difficulty"],
                "correct": bool(answer.get("correct")),
                "concept": answer.get("feedback", {}).get("concept"),
            }
        )

    analysis = ai_agent.analyze_quiz_result(
        topic=session["topic"],
        correct=correct_count,
        total=total,
        breakdown=breakdown,
    )
    if not analysis:
        raise QuizError(
            "AI_PROVIDER_ERROR",
            "We couldn't analyze your results right now. Please try again.",
        )

    # The backend stays authoritative for the numbers no matter what Groq echoed back.
    analysis["score"] = correct_count
    analysis["total"] = total
    analysis["percentage"] = percentage
    return analysis
