/* ---------------------------------------------------------------
   handoff.js — leave the API, keep the session.

   Writes one Markdown file that carries everything the reading
   built: the rules the companion works under, your marks, your
   interpretations, the links you drew, and every exchange so far.
   Paste it into claude.ai (or any chat), attach the PDF, and carry
   on under a flat subscription instead of per-token billing.

   The paper's text is deliberately NOT included. Attaching the
   original PDF is better on every axis — figures, equations,
   layout, and page numbers that actually match.
   --------------------------------------------------------------- */

function handoffText() {
  const L = [];
  const marks = orderedMarks();
  const index = new Map(marks.map((m, i) => [m.id, i + 1]));

  const fromPaper = marks.filter((m) => m.page != null);
  const mine = marks.filter((m) => m.page == null);
  const threads = marks.filter((m) => (m.thread || []).length);

  /* ---- how to use it ---- */
  L.push(`# Reading handoff — ${state.title || "Untitled"}`, "");
  L.push(`> Attach the PDF of this paper alongside this file, then send both.`,
         `> Everything below is my own reading of it: what I marked, what I think`,
         `> each piece means, how I connected them, and what I've already asked.`, "");
  L.push(`${fromPaper.length} marks from the paper · ${mine.length} notes of my own · ` +
         `${state.links.length} links · ${threads.length} threads · ` +
         `exported ${new Date().toLocaleString()}`, "");
  L.push("---", "");

  /* ---- the rules ---- */
  L.push("## How I want you to work", "");
  L.push("These are the rules the tool I read in operates under. Please keep to them here.", "");
  L.push("- **I read the paper myself. You don't summarize it.** No overviews, no key takeaways, no \"the paper argues that…\" openers. Answer only what I ask, about only the passage I point at.");
  L.push("- **Never blend sources in one sentence.** Anything from the paper gets a page cite as `(p. N)`. Anything from your own knowledge of the field gets prefixed `[outside the paper]` with your confidence. I can check the first kind in seconds; the second kind only I can judge, and only if I can see which is which.");
  L.push("- **Check my premise before answering.** If my question assumes something the paper doesn't say — a trend in the wrong direction, a mechanism it never invokes, a condition it never tested — say so first and don't construct an explanation for it. A fluent answer to a false premise is the worst thing you can hand me.");
  L.push("- **If I say \"outside this paper\"**, answer from field knowledge as a colleague would. Say once at the top that it isn't grounded in the document, then write normally. The premise check doesn't apply — I know I've left the paper. Distinguish settled from contested rather than picking a side.");
  L.push("- **When I ask whether I understood correctly**: verdict in the first sentence — correct, partly correct, or incorrect — then the precise delta. Which word, arrow, quantifier, or condition differs. Watch for reversed causal direction, conflated mechanisms, and generalization beyond stated conditions. Distinguish what the paper measured, what it inferred, and what it assumed. No cushioning.");
  L.push("- I work in thin-film processing, plasma, and materials characterization. Write for a peer. No preamble, no restating my question, no offers of further help.", "");
  L.push("---", "");

  /* ---- the notebook ---- */
  L.push("## What I marked", "");

  for (const m of fromPaper) {
    const n = index.get(m.id);
    L.push(`### [${n}] p.${m.page}${m.body === "figure" ? " · figure" : ""} · ${colorId(m.kind)}`, "");

    if (m.image) {
      L.push(`*(I captured this region as an image. Text near it: ${
        (m.text || "none").slice(0, 300)})*`, "");
    } else if (m.text) {
      L.push("> " + m.text.replace(/\n/g, " "), "");
    }

    if (m.note && m.note.trim()) {
      L.push(`**My reading:** ${m.note.trim().replace(/\n/g, " ")}`, "");
    } else {
      L.push(`**My reading:** *(I marked this but never wrote anything — still an open loop.)*`, "");
    }
  }

  if (mine.length) {
    L.push("## My own notes, not tied to a passage", "");
    for (const m of mine) {
      L.push(`- **[${index.get(m.id)}]** ${(m.note || "(empty)").trim().replace(/\n/g, " ")}`);
    }
    L.push("");
  }

  /* ---- the links ---- */
  if (state.links.length) {
    L.push("## How I connected them", "");
    for (const link of state.links) {
      const a = state.marks.find((m) => m.id === link.from);
      const b = state.marks.find((m) => m.id === link.to);
      if (!a || !b) continue;
      const where = (m) => m.page != null ? `p.${m.page}` : "my note";
      L.push(`- **[${index.get(a.id)}]** (${where(a)}) ${relationOf(link.relation).label} ` +
             `**[${index.get(b.id)}]** (${where(b)})`);
    }
    L.push("");
  }

  /* ---- what has already been asked ---- */
  if (threads.length) {
    L.push("---", "", "## What I've already asked", "");
    for (const m of threads) {
      const n = index.get(m.id);
      L.push(`### About [${n}] — ${m.page != null ? "p." + m.page : "my own note"}`, "");
      for (const turn of m.thread) {
        L.push(`**Q:** ${turn.q.replace(/\n/g, " ")}`, "");
        L.push(turn.a.split("\n").map((line) => "> " + line).join("\n"), "");
      }
    }
  }

  /* ---- where I stopped ---- */
  L.push("---", "", "## Where I left off", "");
  L.push(`I was on page ${state.pageNum} of ${state.pageCount}.`);
  const loose = fromPaper.filter((m) => !(m.note || "").trim());
  if (loose.length) {
    L.push("", `Still uninterpreted: ${loose.map((m) => `[${index.get(m.id)}] p.${m.page}`).join(", ")}.`);
  }
  L.push("");

  return L.join("\n");
}

function downloadHandoff() {
  if (!state.marks.length) { toast("Nothing to hand off yet"); return; }
  const blob = new Blob([handoffText()], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (state.title || "handoff").replace(/[^\w\-]+/g, "_") + "_handoff.md";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Handoff saved — attach it and the PDF to a new chat");
}

async function copyHandoff() {
  if (!state.marks.length) { toast("Nothing to hand off yet"); return; }
  try {
    await navigator.clipboard.writeText(handoffText());
    toast("Copied — paste into claude.ai with the PDF attached");
  } catch {
    downloadHandoff();
  }
}

/* The buttons for these live in the export panel, wired in export.js. */
