/* ==========================================================================
   EduSpace — learning.js
   Drives the lesson page: topic selection, lesson rendering, and recording
   what the student actually did.

   Every recorded event goes through EduSpace.progress, which is the same
   store the quiz page writes to and the dashboard reads from. There is no
   second progress system.

   Requires common.js and curriculum.js.
   ========================================================================== */

(() => {
  "use strict";

  const EduSpace = window.EduSpace;
  if (!EduSpace || !EduSpace.curriculum) {
    console.error("EduSpace: common.js and curriculum.js must load before learning.js.");
    return;
  }

  const { curriculum, progress, session, insights } = EduSpace;
  const STORAGE_LAST_TOPIC = "eduspace_last_topic";

  const el = (id) => document.getElementById(id);

  /* Panel elements. The lesson markup already exists in learning.html;
     this script swaps its contents rather than rebuilding the page. */
  const panel = document.querySelector(".lesson-panel");
  const topicListEl = el("topic-list");
  const progressBar = el("unit-progress-bar");
  const progressLabel = el("unit-progress-label");
  const reviewBtn = el("mark-review");
  const completeBtn = el("mark-complete");

  let currentTopicId = null;

  /* ------------------------------------------------------------------
     Which topic should be open?
     ------------------------------------------------------------------ */
  function initialTopicId() {
    /* 1. Explicit choice in the URL — this is how the quiz page links back. */
    const fromUrl = new URLSearchParams(window.location.search).get("topic");
    if (fromUrl && curriculum.getTopic(fromUrl)) return fromUrl;

    /* 2. Whatever they had open last time. */
    try {
      const last = window.localStorage.getItem(STORAGE_LAST_TOPIC);
      if (last && curriculum.getTopic(last)) return last;
    } catch (err) {
      /* storage unavailable — fall through */
    }

    /* 3. The first topic they have not completed. */
    const state = progress.read();
    const next = curriculum.topics.find((t) => !state.topics[t.id]?.completed);
    return (next || curriculum.topics[0]).id;
  }

  function rememberTopic(topicId) {
    try {
      window.localStorage.setItem(STORAGE_LAST_TOPIC, topicId);
    } catch (err) {
      /* non-fatal */
    }
  }

  /* ------------------------------------------------------------------
     Sidebar
     ------------------------------------------------------------------ */
  function renderTopicList() {
    if (!topicListEl) return;
    const state = progress.read();
    topicListEl.innerHTML = "";

    curriculum.topics.forEach((topic) => {
      const record = state.topics[topic.id];
      const isDone = Boolean(record?.completed);
      const isActive = topic.id === currentTopicId;

      const li = document.createElement("li");
      li.className = "topic-item";
      if (isDone) li.classList.add("done");
      if (isActive) li.classList.add("active");
      if (record?.flagged) li.classList.add("flagged");
      li.dataset.topic = topic.id;
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-current", isActive ? "true" : "false");

      const status = document.createElement("span");
      status.className = "topic-status";
      status.textContent = isDone ? "✓" : isActive ? "●" : "○";
      status.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "topic-name";
      name.textContent = topic.name;

      li.append(status, name);
      topicListEl.appendChild(li);
    });
  }

  function renderUnitProgress() {
    const state = progress.read();
    const total = curriculum.topics.length;
    const done = curriculum.topics.filter((t) => state.topics[t.id]?.completed).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressLabel) {
      progressLabel.textContent = `${done} of ${total} topics complete`;
    }
  }

  /* ------------------------------------------------------------------
     Lesson body
     ------------------------------------------------------------------ */
  function renderLesson(topic) {
    if (!panel) return;

    const pill = panel.querySelector(".pill");
    const heading = panel.querySelector(".lesson-head h1");
    const intro = panel.querySelector(".lesson-head > p");
    const body = panel.querySelector(".lesson-body");

    const index = curriculum.indexOf(topic.id);
    if (pill) pill.textContent = `Topic ${index + 1} of ${curriculum.topics.length}`;
    if (heading) heading.textContent = topic.name;
    if (intro) intro.textContent = topic.summary;

    if (body) {
      body.innerHTML = "";
      topic.steps.forEach((step) => {
        const h3 = document.createElement("h3");
        h3.textContent = step.title;
        const p = document.createElement("p");
        p.innerHTML = step.body; /* authored content from curriculum.js only */
        body.append(h3, p);
      });
      body.appendChild(buildTutorNote());
    }

    updateActionLinks(topic);
  }

  /* The tutor note is an empty state until tutor.py exists. It must never
     show a fabricated diagnosis. */
  function buildTutorNote() {
    const note = document.createElement("div");
    note.className = "tutor-note is-empty";

    const tag = document.createElement("span");
    tag.className = "tutor-tag";
    tag.textContent = "Tutor note";

    const text = document.createElement("p");
    text.textContent =
      "Once you have answered a few questions on this topic, EduSpace will explain the specific mistakes it sees here.";

    note.append(tag, text);
    return note;
  }

  /** Replace the tutor note with real analysis, when a backend provides it. */
  function applyTutorNote(analysis) {
    const note = panel?.querySelector(".tutor-note");
    if (!note || !analysis || !analysis.text) return;
    note.classList.remove("is-empty");
    note.querySelector(".tutor-tag").textContent = "Tutor note";
    note.querySelector("p").textContent = analysis.text;
  }

  function updateActionLinks(topic) {
    const practice = panel?.querySelector('a[href^="quiz.html"]');
    if (practice) practice.href = `quiz.html?topic=${encodeURIComponent(topic.id)}`;

    const record = progress.read().topics[topic.id];

    if (reviewBtn) {
      const flagged = Boolean(record?.flagged);
      reviewBtn.textContent = flagged ? "Remove from review" : "Mark for review";
      reviewBtn.setAttribute("aria-pressed", String(flagged));
    }

    if (completeBtn) {
      const done = Boolean(record?.completed);
      completeBtn.textContent = done ? "Mark not complete" : "Mark complete";
      completeBtn.setAttribute("aria-pressed", String(done));
    }
  }

  /* ------------------------------------------------------------------
     Opening a topic
     ------------------------------------------------------------------ */
  async function openTopic(topicId, { record = true, animate = true } = {}) {
    const topic = curriculum.getTopic(topicId);
    if (!topic) return;

    const swap = () => {
      currentTopicId = topic.id;
      rememberTopic(topic.id);
      renderLesson(topic);
      renderTopicList();
      renderUnitProgress();
      panel?.classList.remove("is-swapping");
    };

    if (animate && panel) {
      /* One low-velocity slide out, then in. Matches --t-mid in learning.css. */
      panel.classList.add("is-swapping");
      window.setTimeout(swap, 320);
    } else {
      swap();
    }

    if (record) {
      progress.recordTopicOpened({ topicId: topic.id, topicName: topic.name });
    }

    /* tutor.py is not implemented, so this resolves to null and the empty
       state stays. One await keeps the wiring to a single line later. */
    await EduSpace.insightsReady;
    if (insights.available) {
      try {
        const note = await insights.tutorNote(topic.id, session.email());
        applyTutorNote(note);
      } catch (err) {
        console.warn("EduSpace: tutor note unavailable.", err);
      }
    }
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */
  topicListEl?.addEventListener("click", (e) => {
    const item = e.target.closest(".topic-item");
    if (item?.dataset.topic) openTopic(item.dataset.topic);
  });

  topicListEl?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target.closest(".topic-item");
    if (!item?.dataset.topic) return;
    e.preventDefault();
    openTopic(item.dataset.topic);
  });

  completeBtn?.addEventListener("click", () => {
    if (!currentTopicId) return;
    const topic = curriculum.getTopic(currentTopicId);
    const done = Boolean(progress.read().topics[currentTopicId]?.completed);
    progress.markTopicCompleted({
      topicId: currentTopicId,
      topicName: topic.name,
      completed: !done,
    });
    renderTopicList();
    renderUnitProgress();
    updateActionLinks(topic);
  });

  reviewBtn?.addEventListener("click", () => {
    if (!currentTopicId) return;
    const topic = curriculum.getTopic(currentTopicId);
    const state = progress.read();
    const flagged = Boolean(state.topics[currentTopicId]?.flagged);
    progress.setTopicFlag({
      topicId: currentTopicId,
      topicName: topic.name,
      flagged: !flagged,
    });
    renderTopicList();
    updateActionLinks(topic);
  });

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  function init() {
    if (!panel) return;
    /* ai-learning.js owns the page when the student is on (or starting) an
       AI-generated learning path — set synchronously, before this listener
       runs, since ai-learning.js loads first. Static Fractions content is
       the fallback experience, not a second thing running alongside it. */
    if (EduSpace.aiLearningActive) return;
    openTopic(initialTopicId(), { record: true, animate: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
