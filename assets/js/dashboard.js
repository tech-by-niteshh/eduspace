/* ==========================================================================
   EduSpace — dashboard.js
   Renders the dashboard from whatever data actually exists right now.

   Data sources, in order of preference:
     1. EduSpace.insights.*  — the AI engine. Not implemented yet; every
        method returns null, which this file renders as an empty state.
     2. EduSpace.progress    — local activity recorded by quiz.js /
        learning.js. Those pages are still to be built, so this is usually
        empty too.
     3. EduSpace.session     — the logged-in student, from login.js.

   Rule: never invent a number. If data is missing, show an empty state.
   Requires assets/js/common.js to be loaded first.
   ========================================================================== */

(() => {
  "use strict";

  const EduSpace = window.EduSpace;
  if (!EduSpace) {
    console.error("EduSpace: common.js must load before dashboard.js.");
    return;
  }

  const { session, progress, insights, formatRelativeTime } = EduSpace;
  /* Optional — present on pages that load curriculum.js. Used only to say
     "3 of 5 topics", never to invent progress for topics never attempted. */
  const curriculum = EduSpace.curriculum || null;

  /* Shown wherever a metric has no data behind it. */
  const NO_VALUE = "—";

  const el = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------
     Empty states
     Replaces a list/container with a message instead of leaving a blank
     panel that reads as broken.
     ------------------------------------------------------------------ */
  function showEmptyState(container, title, body) {
    if (!container) return;
    const existing = container.parentElement?.querySelector(".dash-empty");
    if (existing) existing.remove();

    const box = document.createElement("div");
    box.className = "dash-empty";

    const heading = document.createElement("p");
    heading.className = "dash-empty-title";
    heading.textContent = title;
    box.appendChild(heading);

    if (body) {
      const text = document.createElement("p");
      text.className = "dash-empty-body";
      text.textContent = body;
      box.appendChild(text);
    }

    container.hidden = true;
    container.after(box);
  }

  function clearEmptyState(container) {
    if (!container) return;
    container.parentElement?.querySelector(".dash-empty")?.remove();
    container.hidden = false;
  }

  /* ------------------------------------------------------------------
     Student identity
     ------------------------------------------------------------------ */
  function renderStudent() {
    const nameEl = el("dash-user");
    const noticeEl = el("dash-notice");
    const name = session.displayName();

    if (name) {
      if (nameEl) nameEl.textContent = `Welcome back, ${name}`;
      if (noticeEl) noticeEl.hidden = true;
      return true;
    }

    if (nameEl) nameEl.textContent = "Welcome to EduSpace";

    /* Signed out: the page still renders, it just says so plainly. */
    if (noticeEl) {
      noticeEl.hidden = false;
      noticeEl.innerHTML = "";

      const text = document.createElement("p");
      text.textContent =
        "You're not logged in, so this dashboard has no student to load. Log in to see your own progress.";
      noticeEl.appendChild(text);

      const link = document.createElement("a");
      link.href = "login.html";
      link.className = "btn btn-primary";
      link.textContent = "Log in";
      noticeEl.appendChild(link);
    }
    return false;
  }

  /* ------------------------------------------------------------------
     Derived numbers — all computed from recorded answers, never guessed
     ------------------------------------------------------------------ */
  function topicScores(state) {
    return Object.keys(state.topics)
      .map((id) => {
        const topic = state.topics[id];
        return {
          id,
          name: topic.name,
          answered: topic.answered,
          correct: topic.correct,
          opened: topic.opened,
          completed: topic.completed,
          /* null = attempted nothing, so there is no score to show. */
          score: topic.answered > 0 ? Math.round((topic.correct / topic.answered) * 100) : null,
        };
      })
      .filter((topic) => topic.answered > 0 || topic.opened > 0 || topic.completed);
  }

  function overallUnderstanding(scores) {
    const scored = scores.filter((topic) => topic.score !== null);
    if (!scored.length) return null;
    const totalCorrect = scored.reduce((sum, topic) => sum + topic.correct, 0);
    const totalAnswered = scored.reduce((sum, topic) => sum + topic.answered, 0);
    return totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : null;
  }

  /* Consecutive days ending today or yesterday that have recorded activity. */
  function dayStreak(activity) {
    if (!activity.length) return null;

    const days = new Set();
    activity.forEach((item) => {
      const date = new Date(item.at);
      if (!Number.isNaN(date.getTime())) days.add(date.toDateString());
    });
    if (!days.size) return null;

    const dayMs = 86400000;
    const cursor = new Date();
    if (!days.has(cursor.toDateString())) {
      cursor.setTime(cursor.getTime() - dayMs);
      if (!days.has(cursor.toDateString())) return 0;
    }

    let streak = 0;
    while (days.has(cursor.toDateString())) {
      streak += 1;
      cursor.setTime(cursor.getTime() - dayMs);
    }
    return streak;
  }

  /* Individual answers only. Session summaries also have type "quiz", so
     filtering on type alone would double-count. */
  function questionsThisWeek(activity) {
    const weekAgo = Date.now() - 7 * 86400000;
    return activity.filter((item) => {
      if (item.kind !== "answer") return false;
      const date = new Date(item.at);
      return !Number.isNaN(date.getTime()) && date.getTime() >= weekAgo;
    }).length;
  }

  /* ------------------------------------------------------------------
     Stat cards
     ------------------------------------------------------------------ */
  function setStat(id, value, note) {
    const valueEl = el(id);
    if (!valueEl) return;
    valueEl.textContent = value;
    /* Quiets the placeholder so an empty metric does not read as a big
       number or a broken bar. */
    valueEl.classList.toggle("is-empty", value === NO_VALUE);
    const noteEl = valueEl.parentElement?.querySelector(".stat-note");
    if (noteEl && note !== undefined) noteEl.textContent = note;
  }

  function renderStats(state, scores) {
    const understanding = overallUnderstanding(scores);
    /* Only topics with a recorded answer contribute to the percentage, so the
       note must count those — not every topic that was merely opened. */
    const scoredCount = scores.filter((t) => t.score !== null).length;

    setStat(
      "stat-understanding",
      understanding === null ? NO_VALUE : `${understanding}%`,
      understanding === null
        ? "No answers recorded yet"
        : `Across ${scoredCount} practised topic${scoredCount === 1 ? "" : "s"}`,
    );

    const weak = weakTopics(scores);
    setStat(
      "stat-weak",
      scores.length ? String(weak.length) : NO_VALUE,
      scores.length
        ? weak.length
          ? "Need another pass"
          : "Nothing flagged yet"
        : "Not enough data yet",
    );

    const streak = dayStreak(state.activity);
    setStat(
      "stat-streak",
      streak === null ? NO_VALUE : String(streak),
      streak === null ? "Start learning to build a streak" : "Keep it going today",
    );

    const totalAnswered = scores.reduce((sum, topic) => sum + topic.answered, 0);
    const weekly = questionsThisWeek(state.activity);
    setStat(
      "stat-questions",
      totalAnswered ? String(totalAnswered) : NO_VALUE,
      totalAnswered ? `${weekly} in the last 7 days` : "No questions answered yet",
    );
  }

  /* ------------------------------------------------------------------
     Understanding by topic
     ------------------------------------------------------------------ */
  function renderTopicBars(scores) {
    const container = el("topic-bars");
    if (!container) return;

    const scored = scores.filter((topic) => topic.score !== null);

    if (!scored.length) {
      showEmptyState(
        container,
        "No topic data yet.",
        "Start your first learning session and your understanding of each topic will appear here.",
      );
      return;
    }

    clearEmptyState(container);
    container.innerHTML = "";

    scored
      .slice()
      .sort((a, b) => a.score - b.score)
      .forEach((topic) => {
        /* Markup deliberately matches the structural selectors already in
           dashboard.css: a direct-child <span> and <strong> for the label,
           and exactly one direct-child <div> (the track) whose child fill
           carries the inline width. */
        const row = document.createElement("div");
        row.className = "topic-bar";

        const name = document.createElement("span");
        name.textContent = topic.name;

        const value = document.createElement("strong");
        value.textContent = `${topic.score}%`;

        const track = document.createElement("div");
        track.className = "topic-track";

        const fill = document.createElement("div");
        fill.className = "topic-fill";
        fill.style.width = `${topic.score}%`;
        track.appendChild(fill);

        row.append(name, value, track);
        container.appendChild(row);
      });
  }

  /* Sub-heading on the topic panel: attempted and completed counts, both
     derived from recorded activity. */
  function renderTopicPanelNote(state, scores) {
    const note = el("topic-panel-note");
    if (!note) return;

    const attempted = scores.length;
    if (!attempted) {
      note.textContent = "Updated after every answer";
      return;
    }

    const completed = Object.values(state.topics).filter((t) => t.completed).length;
    const total = curriculum ? curriculum.topics.length : null;
    const completedText = total ? `${completed} of ${total} complete` : `${completed} complete`;
    note.textContent = `${attempted} topic${attempted === 1 ? "" : "s"} attempted \u00b7 ${completedText}`;
  }

  /* ------------------------------------------------------------------
     Weak topics
     Below 60% correct with at least 3 answers — a plain threshold on real
     answers, NOT misconception detection. The real analysis will come from
     EduSpace.insights.misconceptions() when misconception.py exists.
     ------------------------------------------------------------------ */
  const WEAK_THRESHOLD = 60;
  const WEAK_MIN_ANSWERS = 3;

  function weakTopics(scores) {
    return scores.filter(
      (topic) => topic.score !== null && topic.answered >= WEAK_MIN_ANSWERS && topic.score < WEAK_THRESHOLD,
    );
  }

  function renderWeakTopics(scores, aiMisconceptions) {
    const container = el("weak-list");
    if (!container) return;

    /* When the AI engine is wired up its output takes priority. */
    const items = Array.isArray(aiMisconceptions) && aiMisconceptions.length
      ? aiMisconceptions.map((item) => ({
          name: item.topic || item.name || "Topic",
          note: item.description || item.note || "",
        }))
      : weakTopics(scores).map((topic) => ({
          name: topic.name,
          note: `${topic.score}% correct across ${topic.answered} questions`,
        }));

    if (!items.length) {
      showEmptyState(
        container,
        "No weak topics identified yet.",
        "Complete a few quizzes and EduSpace will begin identifying areas that need attention.",
      );
      return;
    }

    clearEmptyState(container);
    container.innerHTML = "";

    items.forEach((item) => {
      const li = document.createElement("li");

      const name = document.createElement("strong");
      name.textContent = item.name;
      li.appendChild(name);

      if (item.note) {
        const note = document.createElement("span");
        note.textContent = item.note;
        li.appendChild(note);
      }

      container.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------
     Recent activity
     ------------------------------------------------------------------ */
  function renderActivity(state) {
    const container = el("activity-list");
    if (!container) return;

    if (!state.activity.length) {
      showEmptyState(
        container,
        "No recent activity yet.",
        "Your learning activity will appear here once you start learning.",
      );
      return;
    }

    clearEmptyState(container);
    container.innerHTML = "";

    state.activity.slice(0, 8).forEach((item) => {
      const li = document.createElement("li");

      const label = document.createElement("strong");
      label.textContent = item.topic || "Activity";
      li.appendChild(label);

      if (item.detail) {
        const detail = document.createElement("span");
        detail.className = "activity-detail";
        detail.textContent = item.detail;
        li.appendChild(detail);
      }

      const time = document.createElement("time");
      time.dateTime = item.at || "";
      time.textContent = formatRelativeTime(item.at);
      li.appendChild(time);

      container.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  async function init() {
    renderStudent();

    const state = progress.read();
    const scores = topicScores(state);

    renderStats(state, scores);
    renderTopicBars(scores);
    renderTopicPanelNote(state, scores);
    renderActivity(state);

    /* The AI engine is not built yet, so this resolves to null and the
       plain-threshold fallback above is what renders. Kept as a single
       await so wiring misconception.py in later is a one-line change. */
    let aiMisconceptions = null;
    await EduSpace.insightsReady;
    if (insights.available) {
      try {
        aiMisconceptions = await insights.misconceptions(session.email());
      } catch (err) {
        console.warn("EduSpace: misconception analysis unavailable.", err);
      }
    }
    renderWeakTopics(scores, aiMisconceptions);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
