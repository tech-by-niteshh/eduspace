/* ==========================================================================
   EduSpace — curriculum.js
   The lesson and question content for the Fractions unit.

   This is authored teaching content, NOT generated output. It is kept in one
   file so learning.html, quiz.html and dashboard.html all refer to the same
   topic ids — that shared id is what makes progress recorded on the quiz page
   show up against the right topic on the dashboard.

   When question_generator.py is finished, EduSpace.insights.generatedQuestions()
   can supply extra questions per topic; quiz.js already asks for them and
   falls back to this list when none are available.

   Requires common.js.
   ========================================================================== */

(() => {
  "use strict";

  const EduSpace = (window.EduSpace = window.EduSpace || {});

  const topics = [
    {
      id: "frac-what",
      name: "What is a fraction",
      summary:
        "A fraction is a way of describing part of a whole. The bottom number says how many equal pieces the whole was cut into; the top number says how many of those pieces you have.",
      steps: [
        {
          title: "Step 1 — The denominator sets the piece size",
          body: "In <strong>3/4</strong>, the denominator <strong>4</strong> means the whole was divided into 4 equal parts. Bigger denominator, smaller pieces.",
        },
        {
          title: "Step 2 — The numerator counts the pieces",
          body: "The numerator <strong>3</strong> means you have 3 of those quarter-sized pieces.",
        },
        {
          title: "Step 3 — Equal parts matter",
          body: "Cutting a cake into 4 pieces only gives quarters if the pieces are the <strong>same size</strong>. Unequal pieces are not fractions of the whole.",
        },
      ],
      questions: [
        {
          id: "q-what-1",
          prompt: "In the fraction 5/8, what does the 8 tell you?",
          options: [
            { key: "A", value: "how many pieces you have" },
            { key: "B", value: "how many equal parts the whole was split into" },
            { key: "C", value: "the total number of wholes" },
            { key: "D", value: "how many pieces are left over" },
          ],
          answer: "B",
          why: "The denominator names the size of each piece by saying how many equal parts make one whole.",
        },
        {
          id: "q-what-2",
          prompt: "Which fraction is larger: 1/3 or 1/5?",
          options: [
            { key: "A", value: "1/3" },
            { key: "B", value: "1/5" },
            { key: "C", value: "they are equal" },
            { key: "D", value: "cannot be compared" },
          ],
          answer: "A",
          why: "Splitting a whole into 3 parts makes bigger pieces than splitting it into 5, so one third is larger than one fifth.",
        },
        {
          id: "q-what-3",
          prompt: "A pizza is cut into 6 equal slices and you eat 2. What fraction did you eat?",
          options: [
            { key: "A", value: "6/2" },
            { key: "B", value: "2/6" },
            { key: "C", value: "2/4" },
            { key: "D", value: "4/6" },
          ],
          answer: "B",
          why: "Pieces you have go on top, total equal pieces go on the bottom: 2 out of 6, written 2/6.",
        },
        {
          id: "q-what-4",
          prompt: "Which of these is equal to one whole?",
          options: [
            { key: "A", value: "7/8" },
            { key: "B", value: "8/7" },
            { key: "C", value: "7/7" },
            { key: "D", value: "0/7" },
          ],
          answer: "C",
          why: "When the numerator and denominator match, you have every piece of the whole — that is exactly 1.",
        },
      ],
    },

    {
      id: "frac-equiv",
      name: "Equivalent fractions",
      summary:
        "Two fractions are equivalent when they describe the same amount, even though the numbers look different. You get one from the other by multiplying or dividing top and bottom by the same number.",
      steps: [
        {
          title: "Step 1 — Scale top and bottom together",
          body: "Multiply <strong>1/2</strong> top and bottom by 3 and you get <strong>3/6</strong>. The amount has not changed, only the number of pieces it is described in.",
        },
        {
          title: "Step 2 — Simplify by dividing",
          body: "Going the other way, <strong>6/8</strong> divided top and bottom by 2 gives <strong>3/4</strong>. That is the same amount in its simplest form.",
        },
        {
          title: "Step 3 — Only whole-number factors work",
          body: "You must use the <strong>same</strong> number on top and bottom. Adding to both — 1/2 becoming 2/3 — changes the value and is the most common slip here.",
        },
      ],
      questions: [
        {
          id: "q-equiv-1",
          prompt: "Which fraction is equivalent to 2/3?",
          options: [
            { key: "A", value: "3/4" },
            { key: "B", value: "4/6" },
            { key: "C", value: "2/6" },
            { key: "D", value: "4/3" },
          ],
          answer: "B",
          why: "Multiplying both 2 and 3 by 2 gives 4/6, which is the same amount written in sixths.",
        },
        {
          id: "q-equiv-2",
          prompt: "Simplify 9/12 to its lowest terms.",
          options: [
            { key: "A", value: "3/4" },
            { key: "B", value: "4/3" },
            { key: "C", value: "9/4" },
            { key: "D", value: "1/3" },
          ],
          answer: "A",
          why: "3 divides into both 9 and 12, giving 3/4. Nothing divides into 3 and 4, so that is lowest terms.",
        },
        {
          id: "q-equiv-3",
          prompt: "Fill the gap: 3/5 = ?/20",
          options: [
            { key: "A", value: "6" },
            { key: "B", value: "9" },
            { key: "C", value: "12" },
            { key: "D", value: "15" },
          ],
          answer: "C",
          why: "5 was multiplied by 4 to reach 20, so the top must be multiplied by 4 too: 3 x 4 = 12.",
        },
        {
          id: "q-equiv-4",
          prompt: "Why is 1/2 NOT equivalent to 2/3?",
          options: [
            { key: "A", value: "because 1 was added to top and bottom instead of multiplying" },
            { key: "B", value: "because 2/3 has a bigger denominator" },
            { key: "C", value: "because you cannot compare halves and thirds" },
            { key: "D", value: "they actually are equivalent" },
          ],
          answer: "A",
          why: "Equivalent fractions come from multiplying or dividing top and bottom by the same number. Adding 1 to each changes the value.",
        },
      ],
    },

    {
      id: "frac-add",
      name: "Adding unlike denominators",
      summary:
        "Before you can add two fractions, they need to share the same denominator. Here's the idea, in the order EduSpace thinks will make it click for you.",
      steps: [
        {
          title: "Step 1 — Find a common denominator",
          body: "To add <strong>3/4</strong> and <strong>1/2</strong>, find a number both 4 and 2 divide into evenly. That number is 4.",
        },
        {
          title: "Step 2 — Convert each fraction",
          body: "<strong>3/4</strong> already has a denominator of 4. <strong>1/2</strong> becomes <strong>2/4</strong> by multiplying the top and bottom by 2.",
        },
        {
          title: "Step 3 — Add the numerators only",
          body: "<strong>3/4 + 2/4 = 5/4</strong>, which simplifies to <strong>1 1/4</strong>.",
        },
      ],
      questions: [
        {
          id: "q-add-1",
          prompt: "3/4 + 1/2 = ?",
          options: [
            { key: "A", value: "4/6" },
            { key: "B", value: "5/4" },
            { key: "C", value: "3/6" },
            { key: "D", value: "1/2" },
          ],
          answer: "B",
          why: "Rewrite 1/2 as 2/4, then add the numerators only: 3/4 + 2/4 = 5/4.",
        },
        {
          id: "q-add-2",
          prompt: "1/3 + 1/6 = ?",
          options: [
            { key: "A", value: "2/9" },
            { key: "B", value: "1/2" },
            { key: "C", value: "2/6" },
            { key: "D", value: "1/9" },
          ],
          answer: "B",
          why: "1/3 is 2/6, so 2/6 + 1/6 = 3/6, which simplifies to 1/2.",
        },
        {
          id: "q-add-3",
          prompt: "What is the first thing to do with 2/5 + 1/3?",
          options: [
            { key: "A", value: "add the numerators and the denominators" },
            { key: "B", value: "rewrite both over a common denominator of 15" },
            { key: "C", value: "simplify 2/5 first" },
            { key: "D", value: "multiply the two fractions" },
          ],
          answer: "B",
          why: "Fifths and thirds are different-sized pieces. 15 is the smallest number both 5 and 3 divide into.",
        },
        {
          id: "q-add-4",
          prompt: "1/2 + 1/4 = ?",
          options: [
            { key: "A", value: "2/6" },
            { key: "B", value: "1/6" },
            { key: "C", value: "3/4" },
            { key: "D", value: "2/4" },
          ],
          answer: "C",
          why: "1/2 is 2/4, so 2/4 + 1/4 = 3/4. The denominator stays 4 — only the numerators combine.",
        },
      ],
    },

    {
      id: "frac-sub",
      name: "Subtracting fractions",
      summary:
        "Subtraction works exactly like addition: match the denominators first, then take one numerator from the other.",
      steps: [
        {
          title: "Step 1 — Match the denominators",
          body: "For <strong>5/6 - 1/3</strong>, rewrite <strong>1/3</strong> as <strong>2/6</strong> so both are in sixths.",
        },
        {
          title: "Step 2 — Subtract the numerators only",
          body: "<strong>5/6 - 2/6 = 3/6</strong>. The denominator does not change.",
        },
        {
          title: "Step 3 — Simplify the result",
          body: "<strong>3/6</strong> divides down to <strong>1/2</strong>.",
        },
      ],
      questions: [
        {
          id: "q-sub-1",
          prompt: "5/6 - 1/3 = ?",
          options: [
            { key: "A", value: "4/3" },
            { key: "B", value: "1/2" },
            { key: "C", value: "4/6" },
            { key: "D", value: "2/3" },
          ],
          answer: "B",
          why: "1/3 becomes 2/6, so 5/6 - 2/6 = 3/6, which simplifies to 1/2.",
        },
        {
          id: "q-sub-2",
          prompt: "3/4 - 1/4 = ?",
          options: [
            { key: "A", value: "2/0" },
            { key: "B", value: "1/2" },
            { key: "C", value: "2/8" },
            { key: "D", value: "4/4" },
          ],
          answer: "B",
          why: "The denominators already match, so 3 - 1 = 2 gives 2/4, which simplifies to 1/2.",
        },
        {
          id: "q-sub-3",
          prompt: "When subtracting fractions with the same denominator, what happens to the denominator?",
          options: [
            { key: "A", value: "it is subtracted too" },
            { key: "B", value: "it stays the same" },
            { key: "C", value: "it is added" },
            { key: "D", value: "it doubles" },
          ],
          answer: "B",
          why: "The denominator names the piece size. Taking pieces away does not change how big each piece is.",
        },
        {
          id: "q-sub-4",
          prompt: "1 - 2/5 = ?",
          options: [
            { key: "A", value: "3/5" },
            { key: "B", value: "2/5" },
            { key: "C", value: "1/5" },
            { key: "D", value: "5/2" },
          ],
          answer: "A",
          why: "Write 1 as 5/5, then 5/5 - 2/5 = 3/5.",
        },
      ],
    },

    {
      id: "frac-mult",
      name: "Multiplying fractions",
      summary:
        "Multiplying is the one case where you do not need a common denominator. Multiply straight across, then simplify.",
      steps: [
        {
          title: "Step 1 — Multiply the numerators",
          body: "For <strong>2/3 x 3/4</strong>, multiply the tops: <strong>2 x 3 = 6</strong>.",
        },
        {
          title: "Step 2 — Multiply the denominators",
          body: "Multiply the bottoms: <strong>3 x 4 = 12</strong>, giving <strong>6/12</strong>.",
        },
        {
          title: "Step 3 — Simplify",
          body: "<strong>6/12</strong> reduces to <strong>1/2</strong>. Multiplying by a fraction less than 1 always makes the result smaller.",
        },
      ],
      questions: [
        {
          id: "q-mult-1",
          prompt: "2/3 x 3/4 = ?",
          options: [
            { key: "A", value: "5/7" },
            { key: "B", value: "1/2" },
            { key: "C", value: "6/7" },
            { key: "D", value: "8/9" },
          ],
          answer: "B",
          why: "Multiply straight across for 6/12, which simplifies to 1/2.",
        },
        {
          id: "q-mult-2",
          prompt: "1/2 x 1/2 = ?",
          options: [
            { key: "A", value: "1" },
            { key: "B", value: "2/4" },
            { key: "C", value: "1/4" },
            { key: "D", value: "2/2" },
          ],
          answer: "C",
          why: "Half of a half is a quarter: 1 x 1 = 1 on top, 2 x 2 = 4 on the bottom.",
        },
        {
          id: "q-mult-3",
          prompt: "Do you need a common denominator to multiply fractions?",
          options: [
            { key: "A", value: "yes, always" },
            { key: "B", value: "no, multiply straight across" },
            { key: "C", value: "only when the denominators are different" },
            { key: "D", value: "only when the numerators are equal" },
          ],
          answer: "B",
          why: "Common denominators are needed for adding and subtracting. Multiplication works straight across.",
        },
        {
          id: "q-mult-4",
          prompt: "3/5 x 10 = ?",
          options: [
            { key: "A", value: "6" },
            { key: "B", value: "30/5" },
            { key: "C", value: "3/50" },
            { key: "D", value: "13/5" },
          ],
          answer: "A",
          why: "Write 10 as 10/1, multiply across for 30/5, which is 6.",
        },
      ],
    },
  ];

  EduSpace.curriculum = {
    unit: { id: "fractions", name: "Fractions unit" },
    topics,

    /** @returns {object|undefined} */
    getTopic(id) {
      return topics.find((t) => t.id === id);
    },

    /** Index of a topic id, or -1. */
    indexOf(id) {
      return topics.findIndex((t) => t.id === id);
    },

    /** All questions across the unit, each tagged with its topic. */
    allQuestions() {
      return topics.flatMap((t) =>
        t.questions.map((q) => ({ ...q, topicId: t.id, topicName: t.name })),
      );
    },

    /** Questions for one topic, tagged. Empty array for an unknown id. */
    questionsFor(topicId) {
      const topic = this.getTopic(topicId);
      if (!topic) return [];
      return topic.questions.map((q) => ({ ...q, topicId: topic.id, topicName: topic.name }));
    },
  };
})();
