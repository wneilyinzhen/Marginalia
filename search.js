/* ---------------------------------------------------------------
   search.js — two searches in one panel.

   Top: the text of the paper you have open, so Ctrl+F works the
   way it does in any reader.
   Bottom: every mark and note across the whole library, which is
   the one that gets more useful every week.
   --------------------------------------------------------------- */

function setSearch(open) {
  state.searchOpen = open;
  $("searchPanel").hidden = !open;
  if (open) {
    $("searchInput").focus();
    $("searchInput").select();
    runSearch();
  }
}

$("btnSearch").addEventListener("click", () => setSearch(true));
$("btnSearchClose").addEventListener("click", () => setSearch(false));

let searchTimer = null;
$("searchInput").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 160);
});

$("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Escape") setSearch(false);
});


/* Highlight the matched term inside a snippet without letting the
   surrounding text inject markup. Escape first, then wrap. */
function markUp(text, query) {
  const escaped = escapeHtml(text);
  const needle = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(new RegExp(needle, "gi"), (hit) => `<mark>${hit}</mark>`);
}

function snippets(text, query, maxHits = 3) {
  const out = [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;

  while (out.length < maxHits) {
    const at = lower.indexOf(needle, from);
    if (at === -1) break;
    const start = Math.max(0, at - 70);
    const end = Math.min(text.length, at + needle.length + 90);
    out.push((start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : ""));
    from = at + needle.length;
  }
  return out;
}

async function runSearch() {
  const query = $("searchInput").value.trim();
  const inPaper = $("searchPaper");
  const inNotes = $("searchNotes");

  if (query.length < 2) {
    inPaper.innerHTML = `<div class="empty-note">Type at least two characters.</div>`;
    inNotes.innerHTML = "";
    $("searchPaperHead").textContent = "In this paper";
    $("searchNotesHead").textContent = "In my notes";
    return;
  }

  /* ---- this paper ---- */
  let pageHits = 0;
  const pageRows = [];

  state.text.forEach((pageText, index) => {
    if (!pageText) return;
    const found = snippets(pageText, query);
    if (!found.length) return;
    pageHits += found.length;
    const n = index + 1;
    pageRows.push(`
      <div class="sresult" data-page="${n}">
        <div class="smeta">page ${n}</div>
        ${found.map((s) => `<div class="ssnip">${markUp(s, query)}</div>`).join("")}
      </div>`);
  });

  $("searchPaperHead").textContent =
    `In this paper — ${pageHits} ${pageHits === 1 ? "hit" : "hits"}`;
  inPaper.innerHTML = pageRows.length
    ? pageRows.join("")
    : `<div class="empty-note">Nothing in the open paper.</div>`;

  inPaper.querySelectorAll("[data-page]").forEach((row) =>
    row.addEventListener("click", () => {
      goToPage(Number(row.dataset.page));
      setSearch(false);
    }));

  /* ---- every mark and note in the library ---- */
  const papers = await dbAll("papers");
  const titles = {};
  for (const p of papers) titles[p.id] = p.title;

  const noteRows = [];
  let noteHits = 0;

  for (const record of await dbAll("notes")) {
    for (const mark of record.marks || []) {
      const haystack = ((mark.text || "") + " " + (mark.note || "")).toLowerCase();
      if (!haystack.includes(query.toLowerCase())) continue;

      noteHits++;
      const here = record.id === state.docId;
      const where = mark.page != null ? `p.${mark.page}` : "my note";

      noteRows.push(`
        <div class="sresult" ${here && mark.page != null ? `data-mark="${mark.id}"` : ""}
             style="--stripe: var(${colorVar(mark.kind)})">
          <div class="smeta">
            ${escapeHtml(titles[record.id] || "Unknown paper")} &middot; ${where}
            ${here ? "" : `<span class="selsewhere">other paper</span>`}
          </div>
          ${mark.text ? `<div class="ssnip">${markUp(mark.text.slice(0, 260), query)}</div>` : ""}
          ${mark.note ? `<div class="ssnip mine">${markUp(mark.note.slice(0, 260), query)}</div>` : ""}
        </div>`);

      if (noteRows.length >= 60) break;
    }
  }

  $("searchNotesHead").textContent =
    `In my notes — ${noteHits} ${noteHits === 1 ? "hit" : "hits"}`;
  inNotes.innerHTML = noteRows.length
    ? noteRows.join("")
    : `<div class="empty-note">Nothing in your marks or notes.</div>`;

  inNotes.querySelectorAll("[data-mark]").forEach((row) =>
    row.addEventListener("click", () => {
      goToMark(row.dataset.mark);
      setSearch(false);
    }));
}
