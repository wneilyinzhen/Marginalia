/* ---------------------------------------------------------------
   notes.js — the side list, the board, the library, the keyboard.
   Link drawing lives in links.js.
   --------------------------------------------------------------- */


/* =============================================================
   PANELS
   ============================================================= */

async function setDesk(open) {
  state.deskOpen = open;
  document.body.classList.toggle("desk-open", open);
  if (state.pdf) {
    const anchor = state.pageNum;
    await layoutPages();
    goToPage(anchor, false);
  }
}

$("btnDesk").addEventListener("click", () => setDesk(!state.deskOpen));
$("btnDeskClose").addEventListener("click", () => setDesk(false));

function setBoard(open) {
  state.boardOpen = open;
  $("board").hidden = !open;
  if (open) renderBoard();
}

$("btnBoard").addEventListener("click", () => setBoard(true));
$("btnBoardClose").addEventListener("click", () => setBoard(false));

function setLibrary(open) {
  state.libraryOpen = open;
  $("library").hidden = !open;
  if (open) renderLibrary();
}

$("btnLibrary").addEventListener("click", () => setLibrary(true));
$("btnLibraryClose").addEventListener("click", () => setLibrary(false));


/* =============================================================
   LIBRARY
   ============================================================= */

async function renderLibrary() {
  const papers = await listPapers();
  const subjects = await listSubjects();

  renderSubjects(papers, subjects);

  const filter = state.subjectFilter;
  const shown = papers.filter((p) => {
    if (filter === "__all__") return true;
    if (filter === UNFILED) return !p.subject;
    return p.subject === filter;
  });

  $("libraryCount").textContent = papers.length
    ? `${papers.length} ${papers.length === 1 ? "paper" : "papers"}` : "";

  const wrap = $("libraryList");

  if (shown.length === 0) {
    wrap.innerHTML = `<div class="empty-note">${
      papers.length
        ? "Nothing in this subject yet. Drag a paper here from All papers."
        : "Nothing saved yet. Open a PDF and it will be kept here with its notes."
    }</div>`;
    return;
  }

  wrap.innerHTML = shown.map((p) => `
    <div class="shelfrow" draggable="true" data-paper="${p.id}">
      <span class="grip">&#8942;&#8942;</span>
      <button class="shelfopen" data-open="${p.id}">${escapeHtml(p.title)}</button>
      ${p.subject ? `<span class="shelftag">${escapeHtml(p.subject)}</span>` : ""}
      <span class="shelfmeta">${p.pageCount} pp</span>
      <span class="shelfmeta">${p.markCount} marks</span>
      <span class="shelfmeta">${new Date(p.lastOpened).toLocaleDateString()}</span>
      <button class="kill" data-forget="${p.id}" title="Delete this paper and its notes">&times;</button>
    </div>`).join("");

  wrap.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => reopenPaper(b.dataset.open)));

  wrap.querySelectorAll("[data-forget]").forEach((b) =>
    b.addEventListener("click", async () => {
      const paper = papers.find((p) => p.id === b.dataset.forget);
      if (!confirm(`Delete "${paper.title}" and all its notes? This cannot be undone.`)) return;
      await deletePaper(b.dataset.forget);
      renderLibrary();
    }));

  wrap.querySelectorAll("[data-paper]").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/paper-id", row.dataset.paper);
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
  });
}

function renderSubjects(papers, subjects) {
  const counts = { __all__: papers.length, [UNFILED]: 0 };
  for (const s of subjects) counts[s] = 0;
  for (const p of papers) {
    if (p.subject && counts[p.subject] !== undefined) counts[p.subject]++;
    else if (!p.subject) counts[UNFILED]++;
  }

  const row = (id, label, removable) => `
    <button class="subject ${state.subjectFilter === id ? "on" : ""}" data-subject="${escapeHtml(id)}">
      <span>${escapeHtml(label)}</span>
      <span class="count">${counts[id] || 0}</span>
      ${removable ? `<span class="remove" data-remove="${escapeHtml(id)}" title="Delete subject">&times;</span>` : ""}
    </button>`;

  $("subjects").innerHTML = `
    <div class="subjhead">Subjects</div>
    ${row("__all__", "All papers", false)}
    ${row(UNFILED, "Unfiled", false)}
    ${subjects.map((s) => row(s, s, true)).join("")}
    <div class="newsubject"><input id="newSubject" placeholder="New subject" maxlength="40"></div>`;

  $("subjects").querySelectorAll("[data-subject]").forEach((btn) => {
    const id = btn.dataset.subject;

    btn.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]")) return;
      state.subjectFilter = id;
      renderLibrary();
    });

    btn.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      btn.classList.add("drop");
    });
    btn.addEventListener("dragleave", () => btn.classList.remove("drop"));
    btn.addEventListener("drop", async (e) => {
      e.preventDefault();
      btn.classList.remove("drop");
      const paperId = e.dataTransfer.getData("text/paper-id");
      if (!paperId || id === "__all__") return;
      await setPaperSubject(paperId, id);
      renderLibrary();
    });
  });

  $("subjects").querySelectorAll("[data-remove]").forEach((x) => {
    x.addEventListener("click", async (e) => {
      e.stopPropagation();
      const name = x.dataset.remove;
      if (!confirm(`Delete the subject "${name}"? Its papers become unfiled.`)) return;
      await removeSubject(name);
      if (state.subjectFilter === name) state.subjectFilter = "__all__";
      renderLibrary();
    });
  });

  const input = $("newSubject");
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    await addSubject(input.value);
    input.value = "";
    renderLibrary();
  });
}

async function reopenPaper(id) {
  const record = await dbGet("papers", id);
  if (!record) return;
  if (!record.file) {
    alert("This machine has the notes for that paper but not the PDF. " +
          "Drop the PDF in once and they'll join up.");
    return;
  }
  await openFile(record.file, {
    fromLibrary: true, text: record.text, docId: record.id, title: record.title,
  });
}


/* =============================================================
   ORDERING AND FILTERING
   ============================================================= */

function orderedMarks() {
  const fromPaper = state.marks.filter((m) => m.page != null);
  const ideas     = state.marks.filter((m) => m.page == null);
  fromPaper.sort((a, b) => a.page - b.page || (a.rects[0]?.y || 0) - (b.rects[0]?.y || 0));
  ideas.sort((a, b) => a.createdAt - b.createdAt);
  return [...fromPaper, ...ideas];
}

function visibleMarks() { return orderedMarks().filter(passesFilter); }

function toggleFilter(colorKey) {
  if (!state.filterColors) state.filterColors = new Set(COLORS.map((c) => c.id));
  if (state.filterColors.has(colorKey)) state.filterColors.delete(colorKey);
  else state.filterColors.add(colorKey);

  // all on is the same as no filter, and simpler to reason about
  if (state.filterColors.size === COLORS.length) state.filterColors = null;

  renderDesk();
  paintAllHighlights();
  if (state.boardOpen) renderBoard();
}

function clearFilter() {
  state.filterColors = null;
  renderDesk();
  paintAllHighlights();
  if (state.boardOpen) renderBoard();
}


/* =============================================================
   THE SIDE LIST
   ============================================================= */

function markBody(mark) {
  if (mark.image) {
    const warn = mark.garbled
      ? `<div class="garbled">text extracted as junk &mdash; keeping the image</div>` : "";
    const near = mark.text && !mark.garbled
      ? `<div class="nearby">${escapeHtml(mark.text.slice(0, 200))}</div>` : "";
    return warn + `<img class="snap" src="${mark.image}" alt="captured region">` + near;
  }
  return `<div class="quote">${escapeHtml(mark.text)}</div>`;
}

function renderDesk(scrollToFocus) {
  // colour picker
  $("kinds").innerHTML = COLORS.map((c) => `
    <button class="swatch ${colorId(state.kind) === c.id ? "on" : ""}"
            data-kind="${c.id}" style="--sw: var(${c.css})" title="${c.id}"></button>`).join("");

  $("kinds").querySelectorAll("[data-kind]").forEach((btn) => {
    btn.addEventListener("click", () => { state.kind = btn.dataset.kind; renderDesk(); });
  });

  // colour filter — a separate row, so picking and filtering never blur
  const active = state.filterColors;
  $("filters").innerHTML =
    `<span class="filterlabel">Show</span>` +
    COLORS.map((c) => {
      const on = !active || active.has(c.id);
      const count = state.marks.filter((m) => colorId(m.kind) === c.id).length;
      return `<button class="fdot ${on ? "on" : ""}" data-filter="${c.id}"
                style="--sw: var(${c.css})" title="${count} marks"></button>`;
    }).join("") +
    (active ? `<button class="fclear" id="btnClearFilter">all</button>` : "");

  $("filters").querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => toggleFilter(b.dataset.filter)));
  if ($("btnClearFilter")) $("btnClearFilter").addEventListener("click", clearFilter);

  const total = state.marks.length;
  const shown = visibleMarks();
  $("deskcount").textContent = total
    ? (shown.length === total
        ? `${total} ${total === 1 ? "mark" : "marks"}`
        : `${shown.length} of ${total} marks`)
    : "Nothing marked yet";
  $("btnDesk").textContent = total ? `Notes ${total}` : "Notes";

  const wrap = $("marks");

  if (total === 0) {
    wrap.innerHTML = `<div class="empty-note">
      Pick a colour, then select a sentence in the paper.
      Or press <b>C</b> and drag a box around a plot.</div>`;
    return;
  }
  if (shown.length === 0) {
    wrap.innerHTML = `<div class="empty-note">No marks in the colours you're showing.</div>`;
    return;
  }

  wrap.innerHTML = shown.map((m) => {
    const isIdea = m.page == null;
    const linked = state.links.filter((l) => l.from === m.id || l.to === m.id).length;

    const head = isIdea
      ? `<span>My note</span>`
      : `<button class="goto" data-goto="${m.id}">p.${m.page}</button>
         ${m.body === "figure" ? "<span>figure</span>" : ""}`;

    return `
    <div class="mark ${isIdea ? "idea " : ""}${m.id === state.focusId ? "focused" : ""}"
         data-card="${m.id}" style="--stripe: var(${colorVar(m.kind)})">
      <div class="markhead">
        ${head}
        ${linked ? `<span class="linkcount" title="${linked} links">&#8734; ${linked}</span>` : ""}
        <button class="kill" data-kill="${m.id}" title="Remove">&times;</button>
      </div>
      ${isIdea ? "" : markBody(m)}
      <div class="notelabel">${isIdea ? "My thinking" : "What I think this means"}</div>
      <textarea data-note="${m.id}"
        placeholder="${isIdea ? "Your idea, connection, or question."
                              : "Write it in your own words."}">${escapeHtml(m.note)}</textarea>
    </div>`;
  }).join("");

  wireNotes(wrap);
  wrap.querySelectorAll("[data-kill]").forEach((b) =>
    b.addEventListener("click", () => deleteMark(b.dataset.kill)));
  wrap.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => goToMark(b.dataset.goto)));

  if (scrollToFocus) {
    const card = wrap.querySelector(`[data-card="${state.focusId}"]`);
    if (card) {
      card.scrollIntoView({ block: "center", behavior: "smooth" });
      card.querySelector("textarea").focus();
    }
  }
}

function wireNotes(root) {
  root.querySelectorAll("[data-note]").forEach((area) => {
    area.addEventListener("input", () => {
      const mark = state.marks.find((m) => m.id === area.dataset.note);
      if (!mark) return;
      mark.note = area.value;
      saveMarks();
    });
    area.addEventListener("focus", () => {
      state.focusId = area.dataset.note;
      paintAllHighlights();
    });
  });
}


/* =============================================================
   THE BOARD
   ============================================================= */

function tidyLayout() {
  snapshot("tidy board");
  const COLS = 4, W = 310, H = 268, PAD = 34;
  orderedMarks().forEach((m, i) => {
    m.x = PAD + (i % COLS) * W;
    m.y = PAD + Math.floor(i / COLS) * H;
  });
  saveMarks();
}

function renderBoard() {
  const surface = $("boardsurface");
  const shown = visibleMarks();

  $("boardcount").textContent = state.marks.length
    ? `${shown.length} marks · ${state.links.length} links` : "";

  if (state.marks.length === 0) {
    surface.innerHTML = `<div class="boardempty">Nothing marked yet.</div>`;
    return;
  }

  const unplaced = state.marks.filter((m) => m.x === null || m.x === undefined);
  if (unplaced.length === state.marks.length) {
    tidyLayout();
  } else if (unplaced.length) {
    const placed = state.marks.filter((m) => m.y != null).map((m) => m.y);
    const maxY = placed.length ? Math.max(...placed) : 0;
    unplaced.forEach((m, i) => { m.x = 34 + i * 310; m.y = maxY + 268; });
    saveMarks();
  }

  surface.innerHTML = `
    <div class="boardinner" id="boardinner">
      <svg class="linklayer" id="linklayer" width="4000" height="3000"></svg>
      <div class="boardhint">double-click to add a note &middot; drag the &#9679; on a card onto another to link them</div>
    </div>`;
  const inner = $("boardinner");

  inner.insertAdjacentHTML("beforeend", shown.map((m) => {
    const isIdea = m.page == null;
    const talks = (m.thread || []).length;
    const head = (isIdea
      ? `<span>My note</span>`
      : `<span>p.${m.page}</span><button class="jump" data-goto="${m.id}">open</button>`)
      + (talks ? `<span class="threadbadge" title="${talks} exchanges">&#9993; ${talks}</span>` : "");
    const body = isIdea ? "" :
      `<div class="notequote">${
        m.image ? `<img src="${m.image}" alt="captured region">` : escapeHtml(m.text)
      }</div>`;

    return `
    <div class="note ${isIdea ? "idea" : ""}" data-board="${m.id}"
         style="left:${m.x}px; top:${m.y}px; --stripe: var(${colorVar(m.kind)})">
      <div class="notehead">
        ${head}
        <button class="kill" data-kill="${m.id}" title="Remove">&times;</button>
      </div>
      ${body}
      <textarea data-note="${m.id}"
        placeholder="${isIdea ? "Your idea, connection, or question."
                              : "Write it in your own words."}">${escapeHtml(m.note)}</textarea>
      <button class="linkknob" data-knob="${m.id}" title="Drag onto another card to link"></button>
    </div>`;
  }).join(""));

  wireNotes(inner);
  inner.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => goToMark(b.dataset.goto)));
  inner.querySelectorAll("[data-kill]").forEach((b) =>
    b.addEventListener("click", () => deleteMark(b.dataset.kill)));
  inner.querySelectorAll("[data-board]").forEach((card) => {
    makeDraggable(card);
    // clicking a card selects it as the thing you're asking about
    card.addEventListener("pointerdown", () => {
      state.focusId = card.dataset.board;
      inner.querySelectorAll("[data-board]").forEach((c) =>
        c.classList.toggle("focused", c === card));
      if (typeof refreshAskTarget === "function" &&
          document.body.classList.contains("ask-open")) refreshAskTarget();
    });
  });

  wireLinking(inner);      // links.js
  drawLinks();             // links.js

  inner.addEventListener("dblclick", (e) => {
    if (e.target !== inner && !e.target.classList.contains("boardhint")) return;
    const bounds = inner.getBoundingClientRect();
    addIdeaNote(e.clientX - bounds.left, e.clientY - bounds.top);
  });
}

function addIdeaNote(x, y) {
  snapshot("add note");
  const mark = {
    id: makeId(), page: null, kind: state.kind, body: "idea",
    text: "", rects: [], image: null, garbled: false, note: "",
    x: Math.max(0, Math.round(x - 140)),
    y: Math.max(0, Math.round(y - 20)),
    createdAt: Date.now(),
  };

  state.marks.push(mark);
  state.focusId = mark.id;
  saveMarks();
  renderDesk();

  if (state.boardOpen) {
    renderBoard();
    const card = $("boardinner").querySelector(`[data-board="${mark.id}"]`);
    if (card) card.querySelector("textarea").focus();
  }
}

$("btnAddNote").addEventListener("click", () => {
  const surface = $("boardsurface");
  addIdeaNote(surface.scrollLeft + surface.clientWidth / 2, surface.scrollTop + 120);
});

function makeDraggable(card) {
  const handle = card.querySelector(".notehead");
  let startX, startY, originX, originY, dragging = false;

  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true;
    card.classList.add("dragging");
    card.style.zIndex = ++state.topZ;
    startX = e.clientX; startY = e.clientY;
    originX = parseFloat(card.style.left);
    originY = parseFloat(card.style.top);
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    card.style.left = Math.max(0, originX + (e.clientX - startX)) + "px";
    card.style.top  = Math.max(0, originY + (e.clientY - startY)) + "px";
    drawLinks();                       // keep the lines attached while dragging
  });

  handle.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    const mark = state.marks.find((m) => m.id === card.dataset.board);
    if (mark) {
      mark.x = parseFloat(card.style.left);
      mark.y = parseFloat(card.style.top);
      saveMarks();
    }
    drawLinks();
  });
}

$("btnTidy").addEventListener("click", () => { tidyLayout(); renderBoard(); });


/* =============================================================
   KEYBOARD
   ============================================================= */

document.addEventListener("keydown", (e) => {
  const typing = e.target.matches("textarea, input");

  // undo works everywhere, including mid-typing
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
    e.preventDefault();
    undo();
    return;
  }

  // find works everywhere too
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    setSearch(true);
    return;
  }

  if (typing) {
    if (e.key === "Escape") e.target.blur();
    return;
  }

  if (state.searchOpen)  { if (e.key === "Escape") setSearch(false); return; }
  if (state.libraryOpen) { if (e.key === "Escape") setLibrary(false); return; }
  if (state.boardOpen) {
    // Escape closes the export panel first, then the board
    if (e.key === "Escape" && !$("exportModal").hidden) {
      $("exportModal").hidden = true;
      return;
    }
    if (e.key === "Escape" || e.key === "b" || e.key === "B") setBoard(false);
    return;
  }

  if (e.key === "ArrowLeft")  $("btnPrev").click();
  if (e.key === "ArrowRight") $("btnNext").click();

  if (e.key === "+" || e.key === "=") setZoom(state.zoom * 1.25);
  if (e.key === "-" || e.key === "_") setZoom(state.zoom / 1.25);
  if (e.key === "0") setZoom(1);

  if (e.key === "n" || e.key === "N") setDesk(!state.deskOpen);
  if (e.key === "b" || e.key === "B") setBoard(true);
  if (e.key === "l" || e.key === "L") setLibrary(true);
  if (e.key === "c" || e.key === "C") setMode(state.mode === "capture" ? "select" : "capture");

  if (e.key === "Escape") {
    if (state.mode === "capture") setMode("select");
    else if (state.deskOpen) setDesk(false);
  }

  const n = Number(e.key);
  if (n >= 1 && n <= COLORS.length) { state.kind = COLORS[n - 1].id; renderDesk(); }
});


/* =============================================================
   START
   ============================================================= */

/* If the HTML and the scripts are different versions — usually a
   stale service worker cache — buttons silently do nothing. Say so
   instead. */
(function checkWiring() {
  const required = ["btnExport", "btnExportPdf", "btnExportMd", "btnHandoff",
                    "btnHandoffCopy", "btnQuestion", "btnAi", "btnSearch"];
  const missing = required.filter((id) => !document.getElementById(id));
  if (missing.length) {
    console.error("missing elements — index.html is out of step with the scripts:", missing);
    console.error("Fix: F12 → Application → Service Workers → Unregister, then reload.");
  } else {
    console.log("Marginalia build " + BUILD + " — all controls wired");
  }
})();

renderDesk();
listPapers().then((papers) => {
  if (papers.length) $("btnLibrary").textContent = `Library ${papers.length}`;
});
