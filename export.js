/* ---------------------------------------------------------------
   export.js — turning the board into a PDF.

   Rather than drawing a PDF ourselves with a library, we build a
   page laid out for paper and hand it to Chrome's own print
   engine. Two reasons that's better here:

     - Unicode. PDF libraries ship with fonts that have no Greek,
       so sigma, kappa, angstrom and micro all come out blank or
       wrong. Your papers are full of them.
     - Text stays real text, not a picture of text, so it's sharp
       at any zoom and still searchable.

   The cost is one extra click: Chrome's print dialog opens and
   you choose "Save as PDF".
   --------------------------------------------------------------- */


/* The board is a 2-D arrangement and paper is a 1-D sequence, so
   we read the board the way you'd read a page: in horizontal
   bands, left to right. Cards you placed side by side stay
   together; cards you placed lower come later. */
function boardOrder() {
  const BAND = 220;
  return [...state.marks].sort((a, b) => {
    const ay = a.y ?? 0, by = b.y ?? 0;
    const bandA = Math.floor(ay / BAND);
    const bandB = Math.floor(by / BAND);
    if (bandA !== bandB) return bandA - bandB;
    return (a.x ?? 0) - (b.x ?? 0);
  });
}

function buildPrintView() {
  const cards = boardOrder().map((m) => {
    const isIdea = m.page == null;

    // Your own notes print as a different object: sans-serif on a
    // tinted ground with a dashed rule, versus serif on white with
    // a solid coloured rule for anything taken from the article.
    // At arm's length on an iPad you can tell them apart without
    // reading a word.
    if (isIdea) {
      return `
      <section class="p-card mine">
        <div class="p-label">My note</div>
        <div class="p-note">${escapeHtml((m.note || "").trim())}</div>
        <div class="p-space"></div>
      </section>`;
    }

    const source = m.image
      ? `<img class="p-img" src="${m.image}" alt="">`
      : `<div class="p-quote">${escapeHtml(m.text)}</div>`;

    const note = m.note && m.note.trim()
      ? `<div class="p-note">${escapeHtml(m.note.trim())}</div>`
      : "";

    return `
    <section class="p-card" style="--stripe: var(${colorVar(m.kind)})">
      <div class="p-label">p.${m.page}${m.body === "figure" ? " &middot; figure" : ""}</div>
      ${source}
      ${note}
      <div class="p-space"></div>
    </section>`;
  }).join("");

  const fromPaper = state.marks.filter((m) => m.page != null).length;
  const mine = state.marks.length - fromPaper;

  return `
    <header class="p-head">
      <h1>${escapeHtml(state.title || "Untitled")}</h1>
      <div class="p-meta">
        ${fromPaper} from the paper${mine ? ` &middot; ${mine} of my own` : ""}<br>
        ${new Date().toLocaleDateString()}
      </div>
    </header>
    <div class="p-cards">${cards}</div>`;
}

function exportBoardPdf() {
  if (!state.marks.length) {
    alert("Nothing on the board yet.");
    return;
  }

  let view = $("printview");
  if (!view) {
    view = document.createElement("div");
    view.id = "printview";
    document.body.appendChild(view);
  }
  view.innerHTML = buildPrintView();

  // The document title becomes the suggested filename in the
  // print dialog, so set it and put it back afterwards.
  const originalTitle = document.title;
  document.title = (state.title || "board") + " — notes";

  document.body.classList.add("printing");

  const restore = () => {
    document.body.classList.remove("printing");
    document.title = originalTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);

  // give the browser a moment to lay out the images before printing
  setTimeout(() => window.print(), 120);
}

/* ---------------------------------------------------------------
   One panel, three destinations. They exist for different places:
   the PDF goes to an iPad to be written on, the Markdown goes to a
   notes app or a repository, the handoff goes to a chat window.
   --------------------------------------------------------------- */

console.log("export.js loaded, build " + BUILD);

function openExportPanel() {
  if (!state.marks.length) { toast("Nothing to export yet"); return; }

  const fromPaper = state.marks.filter((m) => m.page != null).length;
  const mine = state.marks.length - fromPaper;
  const threads = state.marks.filter((m) => (m.thread || []).length).length;

  $("exportSummary").textContent =
    `${state.title || "Untitled"} — ${fromPaper} marks from the paper, ` +
    `${mine} of my own, ${state.links.length} links, ${threads} threads.`;

  $("exportModal").hidden = false;
}

function closeExportPanel() { $("exportModal").hidden = true; }

$("btnExport").addEventListener("click", openExportPanel);
$("btnExportClose").addEventListener("click", closeExportPanel);

$("exportModal").addEventListener("click", (e) => {
  if (e.target === $("exportModal")) closeExportPanel();
});

$("btnExportPdf").addEventListener("click", () => {
  closeExportPanel();
  // let the panel disappear before the print dialog takes over
  setTimeout(exportBoardPdf, 60);
});


/* ---------------------------------------------------------------
   Markdown export.

   PDF is for annotating on the iPad. Markdown is for everything
   else: Obsidian, grep, version control, and the reasonable
   expectation that a plain text file still opens in fifteen years.
   --------------------------------------------------------------- */

function exportMarkdown() {
  if (!state.marks.length) { alert("Nothing to export yet."); return; }

  const lines = [];
  lines.push("# " + (state.title || "Untitled"), "");

  const fromPaper = state.marks.filter((m) => m.page != null);
  const mine = state.marks.filter((m) => m.page == null);
  lines.push(`*${fromPaper.length} from the paper, ${mine.length} of my own, ` +
             `${state.links.length} links · ${new Date().toLocaleDateString()}*`, "");

  const label = (m) => m.page != null ? `p.${m.page}` : "my note";

  lines.push("## From the paper", "");
  for (const m of boardOrder().filter((m) => m.page != null)) {
    lines.push(`### p.${m.page}${m.body === "figure" ? " · figure" : ""} · ${colorId(m.kind)}`, "");
    if (m.image) lines.push("_(captured figure — see the PNG in the paper's folder)_", "");
    if (m.text) lines.push("> " + m.text.replace(/\n/g, " "), "");
    if (m.note && m.note.trim()) lines.push("**My reading.** " + m.note.trim(), "");

    const related = state.links.filter((l) => l.from === m.id || l.to === m.id);
    for (const link of related) {
      const otherId = link.from === m.id ? link.to : link.from;
      const other = state.marks.find((x) => x.id === otherId);
      if (!other) continue;
      const direction = link.from === m.id ? relationOf(link.relation).label : "is " + relationOf(link.relation).label + " by";
      lines.push(`- ${direction} → ${label(other)}: ${(other.text || other.note || "").slice(0, 90)}…`);
    }
    if (related.length) lines.push("");
  }

  if (mine.length) {
    lines.push("## My own notes", "");
    for (const m of mine) {
      lines.push("- " + (m.note || "").trim().replace(/\n/g, " "));
    }
    lines.push("");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (state.title || "notes").replace(/[^\w\-]+/g, "_") + ".md";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Markdown saved");
}

$("btnExportMd").addEventListener("click", () => { closeExportPanel(); exportMarkdown(); });

// these two live in handoff.js, which loads after this file.
// Wrapping them means the name is resolved at click time, not now.
$("btnHandoff").addEventListener("click", () => { closeExportPanel(); downloadHandoff(); });
$("btnHandoffCopy").addEventListener("click", () => { closeExportPanel(); copyHandoff(); });
