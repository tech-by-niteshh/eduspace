# quiz
def get_answer_explanation(concept: str) -> str:
    pass


# learning
def get_explanation(conceptName: str) -> str:
    pass


def generate_for_topic(topic_id: str, difficulty: str = "same", count: int = 4):
    """Generate practice questions for a topic.

    INTEGRATION POINT — not implemented yet. Returning None makes the quiz
    page fall back to the authored question set in assets/js/curriculum.js.

    Expected return once implemented::

        [{"id": str,
          "prompt": str,
          "options": [{"key": "A", "value": str}, ...],
          "answer": "A",
          "why": str}, ...]
    """
    return None
