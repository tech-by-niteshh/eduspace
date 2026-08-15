/* ==========================================================================
   EduSpace — ai-learning.js
   Owns the AI-generated learning path flow on learning.html: the "what do
   you want to learn" modal, building a 5-part curriculum from the backend,
   and rendering each part's summary / explanation / tutor note as the
   student moves through it.

   Loads before learning.js and flips EduSpace.aiLearningActive to true
   synchronously, so learning.js's static Fractions-unit renderer steps
   aside instead of racing this module for the same DOM. learning.js's own
   click handlers stay attached but no-op safely (they all guard on
   currentTopicId / curriculum.getTopic, which never match anything here).

   The AI session lives in sessionStorage only — one tab, one learning
   session, gone when the tab closes. Nothing here touches curriculum.js or
   the static topic data.

   Requires common.js.
   ========================================================================== */

(() => {
  "use strict";

  const EduSpace = (window.EduSpace = window.EduSpace || {});
  EduSpace.aiLearningActive = true;

  if (!EduSpace.api || !EduSpace.progress || !EduSpace.session) {
    console.error("EduSpace: common.js must load before ai-learning.js.");
    return;
  }

  const { api, progress, session: authSession } = EduSpace;
  const STORAGE_KEY = "eduspace_ai_learning_session";
  const MAX_TOPIC_LENGTH = 80;

  const el = (id) => document.getElementById(id);

  /* ---- Modal elements ---- */
  const modal = el("ai-topic-modal");
  const form = el("ai-topic-form");
  const input = el("ai-topic-input");
  const loadingBox = el("ai-topic-loading");
  const loadingText = el("ai-topic-loading-text");
  const errorEl = el("ai-topic-error");

  /* ---- Page elements shared with the static markup ---- */
  const sidebarName = el("sidebar-unit-name");
  const topicListEl = el("topic-list");
  const progressBar = el("unit-progress-bar");
  const progressLabel = el("unit-progress-label");
  const newTopicBtn = el("ai-new-topic-btn");

  const panel = document.querySelector(".lesson-panel");
  const pillEl = panel?.querySelector(".pill");
  const headingEl = panel?.querySelector(".lesson-head h1");
  const introEl = panel?.querySelector(".lesson-head > p");
  const bodyEl = panel?.querySelector(".lesson-body");
  const reviewBtn = el("mark-review");
  const completeBtn = el("mark-complete");
  const practiceLink = panel?.querySelector('a[href^="quiz.html"]');

  if (!modal || !panel) return;

  /** @type {{session_id:string, topic:string, parts:Array, current_part:number, completed_parts:number[], flags?:Object}|null} */
  let learningSession = null;
  let submitting = false;
  let openingPart = false;

  /* ------------------------------------------------------------------
     Session storage — one AI learning path per tab.
     ------------------------------------------------------------------ */
  function readStoredSession() {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.parts) || parsed.parts.length !== 5) return null;
      if (!parsed.session_id || !parsed.topic) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function persistSession() {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(learningSession));
    } catch (err) {
      /* non-fatal — session just won't survive a refresh */
    }
  }

  function clearStoredSession() {
    learningSession = null;
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      /* non-fatal */
    }
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
    if (submitting) return;
    submitting = true;
    setModalError(null);
    setModalLoading(true, "Analyzing your topic…");

    const phaseTimer = window.setTimeout(() => {
      setModalLoading(true, "Building your 5-part learning path…");
    }, 1400);

    const res = await api.post("/learning/start", { topic }, { timeoutMs: 30000 });
    window.clearTimeout(phaseTimer);
    submitting = false;

    const data = res.data;
    if (!res.ok || !data || data.success !== true || !Array.isArray(data.parts)) {
      setModalLoading(false);
      setModalError(
        (data && data.error && data.error.message) ||
          res.error ||
          "We couldn't build your learning path right now. Please try again in a moment.",
      );
      return;
    }

    learningSession = {
      session_id: data.session_id,
      topic: data.topic,
      parts: data.parts.map((p) => ({ id: p.id, title: p.title, description: p.description })),
      current_part: data.parts[0].id,
      completed_parts: [],
      flags: {},
    };
    persistSession();
    setModalLoading(false);
    hideModal();
    renderSidebar();
    openPart(learningSession.current_part, { animate: false });
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const topic = (input?.value || "").replace(/\s+/g, " ").trim();
    if (!topic) {
      setModalError("Please tell EduSpace what you'd like to learn.");
      input?.focus();
      return;
    }
    if (topic.length > MAX_TOPIC_LENGTH) {
      setModalError(`Please keep the topic under ${MAX_TOPIC_LENGTH} characters.`);
      return;
    }
    submitTopic(topic);
  });

  newTopicBtn?.addEventListener("click", () => {
    clearStoredSession();
    if (input) input.value = "";
    setModalError(null);
    setModalLoading(false);
    showModal();
  });

  /* ------------------------------------------------------------------
     Sidebar
     ------------------------------------------------------------------ */
  function renderSidebar() {
    if (!learningSession) return;
    if (sidebarName) sidebarName.textContent = learningSession.topic;
    if (newTopicBtn) newTopicBtn.hidden = false;

    if (topicListEl) {
      topicListEl.innerHTML = "";
      learningSession.parts.forEach((part) => {
        const isDone = learningSession.completed_parts.includes(part.id);
        const isActive = part.id === learningSession.current_part;

        const li = document.createElement("li");
        li.className = "topic-item";
        if (isDone) li.classList.add("done");
        if (isActive) li.classList.add("active");
        li.dataset.partId = String(part.id);
        li.tabIndex = 0;
        li.setAttribute("role", "button");
        li.setAttribute("aria-current", isActive ? "true" : "false");

        const status = document.createElement("span");
        status.className = "topic-status";
        status.textContent = isDone ? "✓" : isActive ? "●" : "○";
        status.setAttribute("aria-hidden", "true");

        const name = document.createElement("span");
        name.className = "topic-name";
        name.textContent = part.title;

        li.append(status, name);
        topicListEl.appendChild(li);
      });
    }

    const total = learningSession.parts.length;
    const done = learningSession.completed_parts.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressLabel) progressLabel.textContent = `${done} of ${total} parts complete`;
  }

  topicListEl?.addEventListener("click", (e) => {
    const item = e.target.closest(".topic-item[data-part-id]");
    if (item) openPart(Number(item.dataset.partId));
  });

  topicListEl?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target.closest(".topic-item[data-part-id]");
    if (!item) return;
    e.preventDefault();
    openPart(Number(item.dataset.partId));
  });

  /* ------------------------------------------------------------------
     Safe text rendering — DOM construction only, never innerHTML of AI
     text. Understands **bold**, `inline code`, blank-line paragraphs and
     fenced ```code blocks```.
     ------------------------------------------------------------------ */
  function appendInline(parent, text) {
    // Emphasis only counts when the asterisk hugs its content (no space right
    // after "*" / before the closing "*") — the same flanking rule markdown
    // itself uses to tell "*italic*" apart from a "* bullet" list marker, so
    // a stray list-style "* " in AI output is left as plain text instead of
    // swallowing everything up to the next "*".
    const re = /(\*\*(?!\s)[^*]+?(?<!\s)\*\*|\*(?!\s)[^*]+?(?<!\s)\*|`[^`]+`)/g;
    let lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIndex) {
        parent.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      }
      const token = m[0];
      if (token.startsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      } else if (token.startsWith("*")) {
        const em = document.createElement("em");
        em.textContent = token.slice(1, -1);
        parent.appendChild(em);
      } else {
        const code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  function renderFormattedText(container, text) {
    const codeFenceRe = /```(?:\w+)?\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    const appendParagraphs = (chunk) => {
      chunk.split(/\n{2,}/).forEach((para) => {
        const trimmed = para.trim();
        if (!trimmed) return;
        const p = document.createElement("p");
        appendInline(p, trimmed);
        container.appendChild(p);
      });
    };

    while ((match = codeFenceRe.exec(text)) !== null) {
      appendParagraphs(text.slice(lastIndex, match.index));
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = match[1].trim();
      pre.appendChild(code);
      container.appendChild(pre);
      lastIndex = codeFenceRe.lastIndex;
    }
    appendParagraphs(text.slice(lastIndex));
  }

  function buildCard(labelText, className) {
    const card = document.createElement("div");
    card.className = `ai-lesson-card card ${className}`;
    const label = document.createElement("span");
    label.className = "ai-lesson-card-label";
    label.textContent = labelText;
    const content = document.createElement("div");
    content.className = "ai-lesson-card-content";
    card.append(label, content);
    return { card, content };
  }

  /* ------------------------------------------------------------------
     Lesson body
     ------------------------------------------------------------------ */
  function renderLoadingLesson() {
    if (!bodyEl) return;
    bodyEl.classList.remove("card");
    bodyEl.innerHTML = "";
    const loadingCard = document.createElement("div");
    loadingCard.className = "ai-lesson-card card ai-lesson-loading";
    const spinner = document.createElement("span");
    spinner.className = "ai-topic-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const text = document.createElement("p");
    text.textContent = "Preparing your lesson…";
    loadingCard.append(spinner, text);
    bodyEl.appendChild(loadingCard);
  }

  function renderLessonError(message, partId) {
    if (!bodyEl) return;
    bodyEl.classList.remove("card");
    bodyEl.innerHTML = "";
    const errorCard = document.createElement("div");
    errorCard.className = "ai-lesson-card card ai-lesson-error";
    const text = document.createElement("p");
    text.textContent = message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn-ghost";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => openPart(partId, { animate: false }));
    errorCard.append(text, retry);
    bodyEl.appendChild(errorCard);
  }

  function renderLessonContent(part) {
    if (!bodyEl) return;
    bodyEl.classList.remove("card");
    bodyEl.innerHTML = "";

    const summary = buildCard("Quick summary", "ai-lesson-summary");
    renderFormattedText(summary.content, part.summary || "");
    bodyEl.appendChild(summary.card);

    const explanation = buildCard("Understand it", "ai-lesson-explanation");
    renderFormattedText(explanation.content, part.explanation || "");
    bodyEl.appendChild(explanation.card);

    const tutorNote = document.createElement("div");
    tutorNote.className = "tutor-note";
    const tag = document.createElement("span");
    tag.className = "tutor-tag";
    tag.textContent = "✦ AI tutor note";
    const tutorContent = document.createElement("div");
    renderFormattedText(tutorContent, part.tutor_note || "");
    tutorNote.append(tag, tutorContent);
    bodyEl.appendChild(tutorNote);
  }

  function updateHead(part) {
    if (!learningSession) return;
    const index = learningSession.parts.findIndex((p) => p.id === part.id);
    if (pillEl) pillEl.textContent = `Topic ${index + 1} of ${learningSession.parts.length}`;
    if (headingEl) headingEl.textContent = part.title;
    if (introEl) introEl.textContent = part.description || "";
  }

  function updateActions(part) {
    /* No generated quiz exists for an AI topic yet (out of scope — see
       ai/question_generator.py), so the practice link would just fall back
       to unrelated Fractions questions. Hide it rather than mislead. */
    if (practiceLink) practiceLink.hidden = true;

    const done = learningSession.completed_parts.includes(part.id);
    if (completeBtn) {
      completeBtn.textContent = done ? "Mark not complete" : "Mark complete";
      completeBtn.setAttribute("aria-pressed", String(done));
    }
    if (reviewBtn) {
      const flagged = Boolean(learningSession.flags && learningSession.flags[part.id]);
      reviewBtn.textContent = flagged ? "Remove from review" : "Mark for review";
      reviewBtn.setAttribute("aria-pressed", String(flagged));
    }
  }

  /* ------------------------------------------------------------------
     Opening a part
     ------------------------------------------------------------------ */
  async function openPart(partId, { animate = true } = {}) {
    if (!learningSession || openingPart) return;
    const part = learningSession.parts.find((p) => p.id === partId);
    if (!part) return;

    learningSession.current_part = partId;
    persistSession();
    renderSidebar();
    updateHead(part);
    updateActions(part);

    const swap = async () => {
      renderLoadingLesson();
      openingPart = true;

      const res = await api.post(
        "/learning/part",
        {
          topic: learningSession.topic,
          part_id: part.id,
          part_title: part.title,
          student_id: authSession.email() || undefined,
        },
        { timeoutMs: 30000 },
      );
      openingPart = false;

      /* The student may have already moved to a different part while this
         request was in flight — do not overwrite what they are looking at. */
      if (!learningSession || learningSession.current_part !== partId) return;

      const data = res.data;
      if (!res.ok || !data || data.success !== true || !data.part) {
        renderLessonError(
          (data && data.error && data.error.message) ||
            res.error ||
            "We couldn't prepare this lesson right now. Please try again in a moment.",
          partId,
        );
        return;
      }

      renderLessonContent(data.part);
      panel?.classList.remove("is-swapping");
      progress.recordTopicOpened({
        topicId: `ai:${learningSession.session_id}:${part.id}`,
        topicName: `${learningSession.topic} — ${part.title}`,
      });
    };

    if (animate && panel) {
      panel.classList.add("is-swapping");
      window.setTimeout(swap, 320);
    } else {
      swap();
    }
  }

  completeBtn?.addEventListener("click", () => {
    if (!learningSession) return;
    const partId = learningSession.current_part;
    const part = learningSession.parts.find((p) => p.id === partId);
    if (!part) return;

    const done = learningSession.completed_parts.includes(partId);
    learningSession.completed_parts = done
      ? learningSession.completed_parts.filter((id) => id !== partId)
      : [...learningSession.completed_parts, partId];
    persistSession();
    renderSidebar();
    updateActions(part);

    progress.markTopicCompleted({
      topicId: `ai:${learningSession.session_id}:${partId}`,
      topicName: `${learningSession.topic} — ${part.title}`,
      completed: !done,
    });
  });

  reviewBtn?.addEventListener("click", () => {
    if (!learningSession) return;
    const partId = learningSession.current_part;
    const part = learningSession.parts.find((p) => p.id === partId);
    if (!part) return;

    learningSession.flags = learningSession.flags || {};
    learningSession.flags[partId] = !learningSession.flags[partId];
    persistSession();
    updateActions(part);

    progress.setTopicFlag({
      topicId: `ai:${learningSession.session_id}:${partId}`,
      topicName: `${learningSession.topic} — ${part.title}`,
      flagged: learningSession.flags[partId],
    });
  });

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  function init() {
    const existing = readStoredSession();
    if (existing) {
      learningSession = existing;
      learningSession.flags = learningSession.flags || {};
      renderSidebar();
      openPart(learningSession.current_part, { animate: false });
      return;
    }

    /* Deep link from elsewhere in EduSpace — e.g. quiz.html's "Learn <weak
       topic>" result chips — starts a path for that topic immediately
       instead of making the student retype it into the modal. */
    const fromUrl = (new URLSearchParams(window.location.search).get("topic") || "").trim();
    if (fromUrl && fromUrl.length <= MAX_TOPIC_LENGTH) {
      window.history.replaceState(null, "", window.location.pathname);
      showModal();
      submitTopic(fromUrl);
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
