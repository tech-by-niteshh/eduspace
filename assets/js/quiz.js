/* ==========================================================================
   EduSpace — quiz.js
   Runs a practice set: loads questions, evaluates answers, gives feedback,
   tracks position, and records every attempt.

   Attempts are written through EduSpace.progress — the same store the
   learning page writes to and the dashboard reads from — so finishing a set
   here is what makes the dashboard show real numbers.

   Requires common.js and curriculum.js.
   ========================================================================== */

(() => {
  "use strict";

  const EduSpace = window.EduSpace;
  if (!EduSpace || !EduSpace.curriculum) {
    console.error("EduSpace: common.js and curriculum.js must load before quiz.js.");
    return;
  }

  const { curriculum, progress, insights } = EduSpace;
  const el = (id) => document.getElementById(id);

  /* ---- Elements already present in quiz.html ---- */
  const card = el("quiz-card");
  const questionEl = el("quiz-question");
  const optionsEl = el("quiz-options");
  const feedbackEl = el("quiz-feedback");
  const feedbackLabel = el("feedback-label");
  const feedbackText = el("feedback-text");
  const positionEl = el("quiz-position");
  const progressBar = el("quiz-progress-bar");
  const nextBtn = el("next-btn");
  const skipBtn = el("skip-btn");
  const doneEl = el("quiz-done");
  const summaryEl = el("quiz-summary");
  const topEyebrow = document.querySelector(".quiz-top .eyebrow");

  if (!card || !questionEl || !optionsEl) return;

  /* ---- Session state ---- */
  let questions = [];
  let index = 0;
  let answeredThis = false;
  let correctCount = 0;
  let answeredCount = 0;
  let topic = null;

  /* ------------------------------------------------------------------
     Which topic are we practising?
     ------------------------------------------------------------------ */
  function resolveTopic() {
    const fromUrl = new URLSearchParams(window.location.search).get("topic");
    if (fromUrl && curriculum.getTopic(fromUrl)) return curriculum.getTopic(fromUrl);

    /* Otherwise practise whatever the student last opened on the lesson page. */
    try {
      const last = window.localStorage.getItem("eduspace_last_topic");
      if (last && curriculum.getTopic(last)) return curriculum.getTopic(last);
    } catch (err) {
      /* storage unavailable — fall through */
    }
    return curriculum.topics[0];
  }

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */
  function renderPosition() {
    if (positionEl) positionEl.textContent = `Question ${index + 1} of ${questions.length}`;
    if (progressBar) {
      const pct = questions.length ? ((index + (answeredThis ? 1 : 0)) / questions.length) * 100 : 0;
      progressBar.style.width = `${Math.min(100, pct)}%`;
    }
  }

  function renderQuestion() {
    const q = questions[index];
    if (!q) return;

    questionEl.textContent = q.prompt;
    optionsEl.innerHTML = "";

    q.options.forEach((option) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-option";
      btn.dataset.key = option.key;
      btn.dataset.value = option.value;
      btn.textContent = option.value;
      optionsEl.appendChild(btn);
    });

    answeredThis = false;
    if (feedbackEl) feedbackEl.hidden = true;
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.textContent = index === questions.length - 1 ? "See results" : "Next question";
    }
    if (skipBtn) skipBtn.disabled = false;
    renderPosition();
  }

  /* One low-velocity fade between questions. */
  function transitionTo(fn) {
    card.classList.add("is-swapping");
    window.setTimeout(() => {
      fn();
      card.classList.remove("is-swapping");
    }, 320);
  }

  /* ------------------------------------------------------------------
     Answering
     ------------------------------------------------------------------ */
  function handleAnswer(button) {
    if (answeredThis) return;
    const q = questions[index];
    const chosen = button.dataset.key;
    const isCorrect = chosen === q.answer;

    answeredThis = true;
    answeredCount += 1;
    if (isCorrect) correctCount += 1;

    /* Lock the options and mark them up. */
    optionsEl.querySelectorAll(".quiz-option").forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.key === q.answer) btn.classList.add("is-correct");
      else if (btn === button) btn.classList.add("is-wrong");
    });

    showFeedback(isCorrect, q);

    /* This is what the dashboard reads. */
    progress.recordQuizAttempt({
      topicId: q.topicId,
      topicName: q.topicName,
      isCorrect,
    });

    /* Also hand the answer to the backend pipeline. No-ops and returns null
       while the AI modules are unimplemented, so nothing here depends on it. */
    insights
      .submitAnswer({
        student_id: EduSpace.session.email() || "anonymous",
        topic_id: q.topicId,
        question_id: q.id,
        chosen_option: chosen,
        is_correct: isCorrect,
      })
      .catch(() => null);

    if (nextBtn) nextBtn.disabled = false;
    if (skipBtn) skipBtn.disabled = true;
    renderPosition();
  }

  function showFeedback(isCorrect, q) {
    if (!feedbackEl) return;
    feedbackEl.hidden = false;
    feedbackEl.classList.toggle("is-correct", isCorrect);
    feedbackEl.classList.toggle("is-wrong", !isCorrect);

    if (feedbackLabel) feedbackLabel.textContent = isCorrect ? "Correct" : "Not quite";
    if (feedbackText) {
      const answerText = q.options.find((o) => o.key === q.answer)?.value ?? "";
      feedbackText.textContent = isCorrect
        ? q.why
        : `The answer is ${answerText}. ${q.why}`;
    }
  }

  function goNext() {
    if (index >= questions.length - 1) {
      finish();
      return;
    }
    transitionTo(() => {
      index += 1;
      renderQuestion();
    });
  }

  function skip() {
    if (answeredThis) return;
    if (index >= questions.length - 1) {
      finish();
      return;
    }
    transitionTo(() => {
      index += 1;
      renderQuestion();
    });
  }

  /* ------------------------------------------------------------------
     Finishing
     ------------------------------------------------------------------ */
  function finish() {
    if (progressBar) progressBar.style.width = "100%";
    card.hidden = true;
    if (doneEl) doneEl.hidden = false;

    if (answeredCount > 0) {
      progress.recordQuizSession({
        topicId: topic.id,
        topicName: topic.name,
        correct: correctCount,
        total: answeredCount,
      });
      /* Finishing a practice set is what marks the topic as covered. */
      progress.markTopicCompleted({ topicId: topic.id, topicName: topic.name });
    }

    renderSummary();
  }

  function renderSummary() {
    if (!summaryEl) return;

    if (answeredCount === 0) {
      summaryEl.textContent =
        "You skipped every question in this set, so nothing was recorded. Try one when you're ready.";
      return;
    }

    const pct = Math.round((correctCount / answeredCount) * 100);
    summaryEl.textContent =
      `You answered ${correctCount} of ${answeredCount} correctly on ${topic.name} — ${pct}%. ` +
      "This has been added to your dashboard.";

    /* A plain score breakdown, built from what actually happened. */
    const existing = doneEl?.querySelector(".quiz-score");
    if (existing) existing.remove();

    const score = document.createElement("div");
    score.className = "quiz-score";
    [
      ["Correct", String(correctCount)],
      ["Answered", String(answeredCount)],
      ["Score", `${pct}%`],
    ].forEach(([label, value]) => {
      const cell = document.createElement("div");
      const l = document.createElement("span");
      l.className = "diag-label";
      l.textContent = label;
      const v = document.createElement("strong");
      v.textContent = value;
      cell.append(l, v);
      score.appendChild(cell);
    });
    summaryEl.after(score);
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */
  optionsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".quiz-option");
    if (btn && !btn.disabled) handleAnswer(btn);
  });

  nextBtn?.addEventListener("click", goNext);
  skipBtn?.addEventListener("click", skip);

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  async function init() {
    topic = resolveTopic();
    if (topEyebrow) topEyebrow.textContent = `${curriculum.unit.name} — ${topic.name}`;

    /* question_generator.py is not implemented, so this resolves to null and
       the authored set in curriculum.js is used. */
    let generated = null;
    await EduSpace.insightsReady;
    if (insights.available) {
      try {
        generated = await insights.generatedQuestions(topic.id);
      } catch (err) {
        console.warn("EduSpace: generated questions unavailable.", err);
      }
    }

    questions = Array.isArray(generated) && generated.length
      ? generated.map((q) => ({ ...q, topicId: topic.id, topicName: topic.name }))
      : curriculum.questionsFor(topic.id);

    if (!questions.length) {
      questionEl.textContent = "There are no questions for this topic yet.";
      optionsEl.innerHTML = "";
      if (nextBtn) nextBtn.disabled = true;
      if (skipBtn) skipBtn.disabled = true;
      if (positionEl) positionEl.textContent = "";
      return;
    }

    const backToLesson = doneEl?.querySelector('a[href^="learning.html"]');
    if (backToLesson) backToLesson.href = `learning.html?topic=${encodeURIComponent(topic.id)}`;

    renderQuestion();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
