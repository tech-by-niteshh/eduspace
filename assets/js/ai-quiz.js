/* ==========================================================================
   EduSpace — ai-quiz.js
   Owns the AI-generated quiz flow on quiz.html: the "what do you want to be
   quizzed on" modal, generating five questions from the backend, scoring
   and explaining each answer, and rendering the final Groq performance
   report.

   Loads before quiz.js. The static curriculum-based quiz in quiz.js targets
   element ids (#quiz-card, #quiz-question, ...) that no longer exist in
   quiz.html, so it safely no-ops (see the guard at the top of its init) —
   nothing here has to coordinate with it.

   The AI quiz session lives in sessionStorage only — one tab, one quiz,
   gone when the tab closes, exactly like ai-learning.js's learning session.

   Every answer is scored server-side (backend/quiz/quiz_service.py); this
   file never decides correctness itself, only displays what the backend
   and Gemini/Groq returned.

   Requires common.js.
   ========================================================================== */

(() => {
  "use strict";

  const EduSpace = (window.EduSpace = window.EduSpace || {});

  if (!EduSpace.api || !EduSpace.progress) {
    console.error("EduSpace: common.js must load before ai-quiz.js.");
    return;
  }

  const { api, progress } = EduSpace;
  const STORAGE_KEY = "eduspace_ai_quiz_session";
  const MAX_TOPIC_LENGTH = 80;
  const GENERIC_ERROR = "Something went wrong while preparing your quiz. Please try again.";

  const el = (id) => document.getElementById(id);

  /* ---- Modal elements ---- */
  const modal = el("ai-quiz-modal");
  const form = el("ai-quiz-form");
  const input = el("ai-quiz-input");
  const loadingBox = el("ai-quiz-loading");
  const loadingText = el("ai-quiz-loading-text");
  const errorEl = el("ai-quiz-error");

  /* ---- Quiz shell elements ---- */
  const shell = el("quiz-ai-shell");
  const topicNameEl = el("quiz-ai-topic-name");
  const positionEl = el("quiz-ai-position");
  const progressBar = el("quiz-ai-progress-bar");

  const card = el("quiz-ai-card");
  const overlay = el("quiz-ai-card-overlay");
  const overlayText = el("quiz-ai-card-overlay-text");
  const difficultyEl = el("quiz-ai-difficulty");
  const questionEl = el("quiz-ai-question");
  const optionsEl = el("quiz-ai-options");
  const feedbackEl = el("quiz-ai-feedback");
  const hintEl = el("quiz-ai-hint");
  const submitBtn = el("quiz-ai-submit-btn");
  const nextBtn = el("quiz-ai-next-btn");

  const resultEl = el("quiz-ai-result");
  const fatalEl = el("quiz-ai-fatal");
  const fatalText = el("quiz-ai-fatal-text");
  const fatalRetry = el("quiz-ai-fatal-retry");

  if (!modal || !shell || !card) return;

  const DIFFICULTY_LABELS = {
    easy: "Easy",
    "easy-medium": "Easy / Medium",
    medium: "Medium",
    "medium-hard": "Medium / Hard",
    hard: "Hard",
  };

  /** @type {{quiz_id:string, topic:string, questions:Array, index:number, answers:Object, selected:(number|null), result:(Object|null)}|null} */
  let quizState = null;
  let submittingTopic = false;
  let submittingAnswer = false;

  /* ------------------------------------------------------------------
     Session storage — one AI quiz per tab.
     ------------------------------------------------------------------ */
  function readStoredSession() {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.quiz_id || !parsed.topic || !Array.isArray(parsed.questions)) return null;
      if (!parsed.answers || typeof parsed.answers !== "object") parsed.answers = {};
      if (typeof parsed.index !== "number") parsed.index = 0;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function persist() {
    if (!quizState) return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          quiz_id: quizState.quiz_id,
          topic: quizState.topic,
          questions: quizState.questions,
          index: quizState.index,
          answers: quizState.answers,
          result: quizState.result,
        }),
      );
    } catch (err) {
      /* non-fatal — session just won't survive a refresh */
    }
  }

  function clearStoredSession() {
    quizState = null;
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      /* non-fatal */
    }
  }

  function slugify(text) {
    return (
      (text || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "topic"
    );
  }

  /* ------------------------------------------------------------------
     Modal
     ------------------------------------------------------------------ */
  function showModal() {
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add("is-open"));
    document.body.classList.add("no-scroll");
    window.setTimeout(() => input?.focus(), 80);
  }

  function hideModal() {
    modal.classList.remove("is-open");
    document.body.classList.remove("no-scroll");
    window.setTimeout(() => {
      modal.hidden = true;
    }, 260);
  }

  function setModalError(message) {
    if (!errorEl) return;
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
  }

  function setModalLoading(isLoading, text) {
    if (loadingBox) loadingBox.hidden = !isLoading;
    if (form) form.hidden = isLoading;
    if (isLoading && loadingText && text) loadingText.textContent = text;
  }

  async function submitTopic(topic) {
    if (submittingTopic) return;
    submittingTopic = true;
    setModalError(null);
    setModalLoading(true, "Analyzing the topic…");

    const t1 = window.setTimeout(() => setModalLoading(true, "Creating 5 questions…"), 1300);
    const t2 = window.setTimeout(() => setModalLoading(true, "Balancing the difficulty…"), 3200);

    const res = await api.post("/quiz/start", { topic }, { timeoutMs: 45000 });
    window.clearTimeout(t1);
    window.clearTimeout(t2);
    submittingTopic = false;

    const data = res.data;
    if (!res.ok || !data || data.success !== true || !Array.isArray(data.questions) || data.questions.length !== 5) {
      setModalLoading(false);
      setModalError((data && data.error && data.error.message) || res.error || GENERIC_ERROR);
      return;
    }

    quizState = {
      quiz_id: data.quiz_id,
      topic: data.topic,
      questions: data.questions,
      index: 0,
      answers: {},
      selected: null,
      result: null,
    };
    persist();
    setModalLoading(false);
    hideModal();
    beginQuiz();
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const topic = (input?.value || "").replace(/\s+/g, " ").trim();
    if (!topic) {
      setModalError("Please tell EduSpace what you'd like to be quizzed on.");
      input?.focus();
      return;
    }
    if (topic.length > MAX_TOPIC_LENGTH) {
      setModalError(`Please keep the topic under ${MAX_TOPIC_LENGTH} characters.`);
      return;
    }
    submitTopic(topic);
  });

  /* ------------------------------------------------------------------
     Safe formatted-text rendering for AI copy — DOM construction only,
     never innerHTML. Supports **bold**, `inline code`, and paragraphs.
     ------------------------------------------------------------------ */
  function appendInline(parent, text) {
    const re = /(\*\*(?!\s)[^*]+?(?<!\s)\*\*|`[^`]+`)/g;
    let lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIndex) parent.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      const token = m[0];
      if (token.startsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      } else {
        const code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  function textBlock(tagName, text, className) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    appendInline(node, text || "");
    return node;
  }

  /* ------------------------------------------------------------------
     Quiz shell
     ------------------------------------------------------------------ */
  function beginQuiz() {
    shell.hidden = false;
    fatalEl.hidden = true;
    resultEl.hidden = true;
    card.hidden = false;
    topicNameEl.textContent = quizState.topic;

    const answeredCount = Object.keys(quizState.answers).length;
    const total = quizState.questions.length;
    if (quizState.result) {
      renderResult(quizState.result);
    } else if (answeredCount >= total) {
      requestFinish();
    } else {
      quizState.index = answeredCount;
      renderQuestion();
    }
  }

  function currentQuestion() {
    return quizState.questions[quizState.index];
  }

  function renderPosition() {
    const total = quizState.questions.length;
    if (positionEl) positionEl.textContent = `Question ${quizState.index + 1} of ${total}`;
    if (progressBar) {
      const answered = Object.keys(quizState.answers).length;
      const pct = total ? (answered / total) * 100 : 0;
      progressBar.style.width = `${Math.min(100, pct)}%`;
    }
  }

  function setOverlay(isVisible, text) {
    if (!overlay) return;
    overlay.hidden = !isVisible;
    if (isVisible && overlayText && text) overlayText.textContent = text;
    card.classList.toggle("is-busy", isVisible);
  }

  function renderQuestion() {
    const q = currentQuestion();
    if (!q) return;

    quizState.selected = null;
    card.hidden = false;
    resultEl.hidden = true;

    if (difficultyEl) {
      difficultyEl.textContent = DIFFICULTY_LABELS[q.difficulty] || q.difficulty;
      difficultyEl.className = "pill quiz-ai-difficulty";
    }
    if (questionEl) questionEl.textContent = q.question;

    optionsEl.innerHTML = "";
    const letters = ["A", "B", "C", "D"];
    q.options.forEach((optionText, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-option";
      btn.dataset.index = String(i);
      btn.dataset.key = letters[i];
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", "false");
      btn.textContent = optionText;
      optionsEl.appendChild(btn);
    });

    feedbackEl.hidden = true;
    feedbackEl.innerHTML = "";
    if (hintEl) {
      hintEl.hidden = false;
      hintEl.textContent = "Select an answer to continue.";
    }
    if (submitBtn) {
      submitBtn.hidden = false;
      submitBtn.disabled = true;
    }
    if (nextBtn) nextBtn.hidden = true;

    renderPosition();
  }

  optionsEl?.addEventListener("click", (e) => {
    const btn = e.target.closest(".quiz-option");
    if (!btn || btn.disabled || submittingAnswer) return;
    optionsEl.querySelectorAll(".quiz-option").forEach((b) => {
      b.classList.remove("is-selected");
      b.setAttribute("aria-checked", "false");
    });
    btn.classList.add("is-selected");
    btn.setAttribute("aria-checked", "true");
    quizState.selected = Number(btn.dataset.index);
    if (submitBtn) submitBtn.disabled = false;
  });

  function showInlineNotice(message) {
    if (!hintEl) return;
    hintEl.hidden = false;
    hintEl.textContent = message;
    hintEl.classList.add("is-error");
    window.setTimeout(() => hintEl.classList.remove("is-error"), 2600);
  }

  async function handleSubmitAnswer() {
    if (submittingAnswer || quizState.selected === null || quizState.selected === undefined) return;
    const q = currentQuestion();
    if (quizState.answers[q.id]) return; // already answered — anti-duplicate guard

    submittingAnswer = true;
    optionsEl.querySelectorAll(".quiz-option").forEach((b) => (b.disabled = true));
    if (submitBtn) submitBtn.disabled = true;
    setOverlay(true, "Evaluating your answer…");

    const res = await api.post(
      "/quiz/question",
      { quiz_id: quizState.quiz_id, question_id: q.id, selected_answer: quizState.selected },
      { timeoutMs: 30000 },
    );
    setOverlay(false);
    submittingAnswer = false;

    const data = res.data;
    if (!res.ok || !data || data.success !== true || !data.feedback || !data.quiz_id) {
      optionsEl.querySelectorAll(".quiz-option").forEach((b) => (b.disabled = false));
      if (submitBtn) submitBtn.disabled = false;
      showInlineNotice((data && data.error && data.error.message) || res.error || GENERIC_ERROR);
      return;
    }

    // Quiz sessions are stateless tokens, not server memory (see
    // backend/quiz/quiz_session.py) — every answer issues a new quiz_id
    // that must be used for the next request.
    quizState.quiz_id = data.quiz_id;

    const selectedIndex = quizState.selected;
    quizState.answers[q.id] = {
      selected_answer: selectedIndex,
      correct: data.correct,
      correct_index: data.correct_index,
      feedback: data.feedback,
    };
    persist();

    markOptions(selectedIndex, data.correct_index);
    renderFeedback(q, selectedIndex, data.correct, data.feedback);
    recordLocalProgress(q, data.correct);

    if (hintEl) hintEl.hidden = true;
    if (submitBtn) submitBtn.hidden = true;
    if (nextBtn) {
      nextBtn.hidden = false;
      nextBtn.textContent = quizState.index === quizState.questions.length - 1 ? "See my results" : "Next question →";
      nextBtn.focus();
    }
    renderPosition();
  }

  submitBtn?.addEventListener("click", handleSubmitAnswer);

  function markOptions(selectedIndex, correctIndex) {
    optionsEl.querySelectorAll(".quiz-option").forEach((btn) => {
      const i = Number(btn.dataset.index);
      btn.disabled = true;
      if (i === correctIndex) btn.classList.add("ai-correct");
      else if (i === selectedIndex) btn.classList.add("ai-wrong-pick");
    });
  }

  function renderFeedback(question, selectedIndex, isCorrect, feedback) {
    feedbackEl.innerHTML = "";
    feedbackEl.hidden = false;
    feedbackEl.classList.toggle("is-correct", isCorrect);
    feedbackEl.classList.toggle("is-review", !isCorrect);

    const header = document.createElement("div");
    header.className = "quiz-ai-feedback-head";
    const badge = document.createElement("span");
    badge.className = "quiz-ai-feedback-badge";
    badge.textContent = isCorrect ? "✓ Correct" : "Let's understand this";
    header.appendChild(badge);
    if (feedback.concept) {
      const concept = document.createElement("span");
      concept.className = "quiz-ai-feedback-concept";
      concept.textContent = feedback.concept;
      header.appendChild(concept);
    }
    feedbackEl.appendChild(header);

    if (!isCorrect) {
      const rows = document.createElement("div");
      rows.className = "quiz-ai-feedback-rows";
      const addRow = (label, value) => {
        const row = document.createElement("div");
        const l = document.createElement("span");
        l.className = "quiz-ai-feedback-label";
        l.textContent = label;
        const v = document.createElement("span");
        appendInline(v, value);
        row.append(l, v);
        rows.appendChild(row);
      };
      addRow("Your answer", question.options[selectedIndex] || "");
      addRow("Correct answer", feedback.correct_answer);
      feedbackEl.appendChild(rows);
    }

    const body = document.createElement("div");
    body.className = "quiz-ai-feedback-body";
    body.appendChild(textBlock("p", feedback.explanation, "quiz-ai-feedback-explanation"));
    if (!isCorrect && feedback.solution) {
      body.appendChild(textBlock("p", feedback.solution, "quiz-ai-feedback-solution"));
    }
    feedbackEl.appendChild(body);

    if (feedback.learning_tip) {
      const tip = document.createElement("div");
      tip.className = "quiz-ai-feedback-tip";
      const tag = document.createElement("span");
      tag.className = "quiz-ai-feedback-tip-tag";
      tag.textContent = "✦ Tutor tip";
      const tipText = document.createElement("span");
      appendInline(tipText, feedback.learning_tip);
      tip.append(tag, tipText);
      feedbackEl.appendChild(tip);
    }
  }

  function recordLocalProgress(question, isCorrect) {
    const topicId = `quiz:${slugify(quizState.topic)}`;
    progress.recordQuizAttempt({ topicId, topicName: quizState.topic, isCorrect });
  }

  function goNext() {
    if (quizState.index >= quizState.questions.length - 1) {
      requestFinish();
      return;
    }
    card.classList.add("is-swapping");
    window.setTimeout(() => {
      quizState.index += 1;
      persist();
      renderQuestion();
      card.classList.remove("is-swapping");
    }, 260);
  }

  nextBtn?.addEventListener("click", goNext);

  /* ------------------------------------------------------------------
     Finishing — Groq performance analysis
     ------------------------------------------------------------------ */
  async function requestFinish() {
    card.hidden = false;
    resultEl.hidden = true;
    setOverlay(true, "Analyzing your performance…");
    if (submitBtn) submitBtn.hidden = true;
    if (nextBtn) nextBtn.hidden = true;
    if (hintEl) hintEl.hidden = true;

    const res = await api.post("/quiz/result", { quiz_id: quizState.quiz_id }, { timeoutMs: 40000 });
    setOverlay(false);

    const data = res.data;
    if (!res.ok || !data || data.success !== true || !data.result) {
      showFatal((data && data.error && data.error.message) || res.error || GENERIC_ERROR);
      return;
    }

    quizState.result = data.result;
    persist();

    const total = quizState.questions.length;
    const correct = Object.values(quizState.answers).filter((a) => a.correct).length;
    const topicId = `quiz:${slugify(quizState.topic)}`;
    progress.recordQuizSession({ topicId, topicName: quizState.topic, correct, total });
    progress.markTopicCompleted({ topicId, topicName: quizState.topic });

    renderResult(data.result);
  }

  function showFatal(message) {
    card.hidden = true;
    resultEl.hidden = true;
    fatalEl.hidden = false;
    if (fatalText) fatalText.textContent = message;
  }

  fatalRetry?.addEventListener("click", () => {
    fatalEl.hidden = true;
    const answeredCount = Object.keys(quizState?.answers || {}).length;
    const total = quizState?.questions.length || 0;
    if (quizState && answeredCount >= total) {
      requestFinish();
    } else if (quizState) {
      card.hidden = false;
      renderQuestion();
    } else {
      clearStoredSession();
      showModal();
    }
  });

  /* ------------------------------------------------------------------
     Result dashboard
     ------------------------------------------------------------------ */
  function scoreRingGradient(pct) {
    return `conic-gradient(var(--sky) 0deg, var(--azure) ${pct * 1.2}deg, var(--cloud) ${pct * 3.6}deg 360deg)`;
  }

  function buildCardList(items, className) {
    const ul = document.createElement("ul");
    ul.className = className;
    items.forEach((text) => {
      const li = document.createElement("li");
      appendInline(li, text);
      ul.appendChild(li);
    });
    return ul;
  }

  function renderResult(result) {
    card.hidden = true;
    fatalEl.hidden = true;
    resultEl.hidden = false;
    resultEl.innerHTML = "";

    const pct = Number(result.percentage) || 0;

    const head = document.createElement("div");
    head.className = "quiz-ai-result-head";

    const ring = document.createElement("div");
    ring.className = "quiz-ai-score-ring";
    ring.style.background = scoreRingGradient(pct);
    const ringInner = document.createElement("div");
    ringInner.className = "quiz-ai-score-ring-inner";
    const scoreValue = document.createElement("strong");
    scoreValue.textContent = `${result.score}/${result.total}`;
    const scorePct = document.createElement("span");
    scorePct.textContent = `${pct}%`;
    ringInner.append(scoreValue, scorePct);
    ring.appendChild(ringInner);

    const headText = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Your result";
    const h2 = document.createElement("h2");
    h2.textContent = `${result.performance_level} on ${quizState.topic}`;
    const summary = document.createElement("p");
    appendInline(summary, result.summary || "");
    headText.append(eyebrow, h2, summary);

    head.append(ring, headText);
    resultEl.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "quiz-ai-result-grid";

    if (Array.isArray(result.strengths) && result.strengths.length) {
      const box = document.createElement("div");
      box.className = "quiz-ai-result-box quiz-ai-result-strengths";
      box.appendChild(textBlock("h3", "What you did well"));
      box.appendChild(buildCardList(result.strengths, "quiz-ai-result-list"));
      grid.appendChild(box);
    }

    if (Array.isArray(result.weaknesses) && result.weaknesses.length) {
      const box = document.createElement("div");
      box.className = "quiz-ai-result-box quiz-ai-result-weaknesses";
      box.appendChild(textBlock("h3", "Topics to revisit"));
      box.appendChild(buildCardList(result.weaknesses, "quiz-ai-result-list"));
      grid.appendChild(box);
    }

    resultEl.appendChild(grid);

    const rec = document.createElement("div");
    rec.className = "quiz-ai-result-box quiz-ai-result-recommendation";
    rec.appendChild(textBlock("h3", "Recommended next step"));
    rec.appendChild(textBlock("p", result.recommendation || ""));
    if (result.next_step) rec.appendChild(textBlock("p", result.next_step, "quiz-ai-result-next"));
    resultEl.appendChild(rec);

    const revisionTopics = Array.isArray(result.revision_topics) ? result.revision_topics : [];
    if (revisionTopics.length) {
      const learnBox = document.createElement("div");
      learnBox.className = "quiz-ai-result-box quiz-ai-learn-box";
      learnBox.appendChild(textBlock("h3", "Learn what you missed"));
      const chips = document.createElement("div");
      chips.className = "quiz-ai-learn-chips";
      revisionTopics.forEach((topicName) => {
        const link = document.createElement("a");
        link.className = "btn btn-ghost quiz-ai-learn-chip";
        link.href = `learning.html?topic=${encodeURIComponent(topicName)}`;
        link.textContent = `Learn ${topicName}`;
        chips.appendChild(link);
      });
      learnBox.appendChild(chips);
      resultEl.appendChild(learnBox);
    }

    const actions = document.createElement("div");
    actions.className = "lesson-actions quiz-ai-result-actions";

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn btn-ghost";
    retryBtn.textContent = "Retry quiz";
    retryBtn.addEventListener("click", () => {
      const topic = quizState.topic;
      clearStoredSession();
      resultEl.hidden = true;
      card.hidden = false;
      submitTopic(topic);
    });

    const learningLink = document.createElement("a");
    learningLink.className = "btn btn-ghost";
    learningLink.href = "learning.html";
    learningLink.textContent = "Back to learning";

    const dashboardLink = document.createElement("a");
    dashboardLink.className = "btn btn-primary";
    dashboardLink.href = "dashboard.html";
    dashboardLink.textContent = "View dashboard";

    actions.append(retryBtn, learningLink, dashboardLink);
    resultEl.appendChild(actions);
  }

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  function init() {
    const existing = readStoredSession();
    if (existing) {
      quizState = { ...existing, selected: null };
      beginQuiz();
      return;
    }
    showModal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
