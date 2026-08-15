/* ==========================================================================
   EduSpace — index.js
   Home page only. Nav toggle, header scroll state and the scroll-reveal
   observer now live in common.js, which every page loads first. The verbatim
   copy of that code that used to sit at the top of this file has been removed
   so the reveal observer is no longer created twice on the home page.
   ========================================================================== */

(() => {
  "use strict";

  /* Flip cards respond to click and keyboard, as the copy promises. */
  function initFlipCards() {
    document.querySelectorAll(".flip-card").forEach((card) => {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-pressed", "false");

      const flip = () => {
        const on = card.classList.toggle("is-flipped");
        card.setAttribute("aria-pressed", String(on));
      };

      card.addEventListener("click", flip);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          flip();
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFlipCards);
  } else {
    initFlipCards();
  }
})();
