/* ---------------------------------------------------------------
   viewer.js — the PDF side, now scrolling continuously.

   Every page gets a container sized correctly up front, so the
   scrollbar is honest from the moment the file opens. Canvases and
   text layers are only built for pages near the viewport and torn
   down when they leave, because a 49-page paper rendered all at
   once is a quarter of a gigabyte of bitmaps.
   --------------------------------------------------------------- */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
const RENDER_MARGIN = "900px 0px";   // how far ahead of the viewport to draw


/* =============================================================
   OPENING
   ============================================================= */

$("btnOpen").addEventListener("click", () => $("fileInput").click());

$("fileInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) openFile(file);
  event.target.value = "";
});

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragging");
});
document.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) document.body.classList.remove("dragging");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  const file = e.dataTransfer.files[0];
  if (file && file.type === "application/pdf") openFile(file);
});

async function openFile(file, options = {}) {
  const bytes = await file.arrayBuffer();

  // never recompute an id we already know — see the sync notes
  state.docId = options.docId || (file.name + "_" + file.size);
  state.title = options.title || file.name.replace(/\.pdf$/i, "");

  state.pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  state.pageCount = state.pdf.numPages;

  if (typeof syncPaperFromFolder === "function") {
    try { await syncPaperFromFolder(state.docId); } catch (e) { console.error(e); }
  }
  await loadMarks();

  const record = await dbGet("papers", state.docId);
  state.zoom    = (record && record.zoom)     || 1;
  state.pageNum = (record && record.lastPage) || 1;

  $("docname").textContent = state.title;
  $("dropzone").hidden = true;
  $("stage").hidden = false;

  // get out of the way — opening a paper means you want to read it,
  // and these overlays sit on top of the reader
  setLibrary(false);
  setBoard(false);
  if (typeof setSearch === "function") setSearch(false);

  if (options.fromLibrary) {
    state.text = options.text || [];
    await touchPaper();
  } else {
    await extractAllText();
    await savePaper(file);
  }

  await layoutPages();
  renderDesk();

  // put them back where they left off
  if (state.pageNum > 1) goToPage(state.pageNum, false);
}

async function extractAllText() {
  state.text = [];
  for (let n = 1; n <= state.pageCount; n++) {
    const page = await state.pdf.getPage(n);
    const content = await page.getTextContent();
    state.text.push(content.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim());
  }
  console.log(`extracted ${state.text.join("").length} characters from ${state.pageCount} pages`);
}


/* =============================================================
   LAYING OUT EVERY PAGE

   Measure all pages first, build empty containers at the right
   size, then let the observer fill them in as they come into view.
   ============================================================= */

async function layoutPages() {
  const stage = $("stage");

  // scale to fit the width of the first page
  const first = await state.pdf.getPage(1);
  const natural = first.getViewport({ scale: 1 });
  const available = Math.min($("reader").clientWidth - 34, 1000);
  const fitScale = Math.max(0.5, available / natural.width);
  const scale = fitScale * state.zoom;

  state.viewports = [];
  for (let n = 1; n <= state.pageCount; n++) {
    const page = await state.pdf.getPage(n);
    state.viewports[n] = page.getViewport({ scale });
  }

  if (state.observer) state.observer.disconnect();
  state.rendered.clear();
  state.canvases = {};

  stage.innerHTML = "";
  for (let n = 1; n <= state.pageCount; n++) {
    const vp = state.viewports[n];
    const host = document.createElement("div");
    host.className = "page";
    host.dataset.page = n;
    host.style.width = vp.width + "px";
    host.style.height = vp.height + "px";
    host.innerHTML = `<div class="pagenum">${n}</div>`;
    stage.appendChild(host);
  }

  state.observer = new IntersectionObserver(onPageVisibility, {
    root: $("reader"),
    rootMargin: RENDER_MARGIN,
  });
  stage.querySelectorAll(".page").forEach((el) => state.observer.observe(el));

  updateChrome();
}

function onPageVisibility(entries) {
  for (const entry of entries) {
    const n = Number(entry.target.dataset.page);
    if (entry.isIntersecting) drawPage(n);
    else clearPage(n);
  }
}

async function drawPage(n) {
  if (state.rendered.has(n)) return;
  state.rendered.add(n);

  const host = $("stage").querySelector(`.page[data-page="${n}"]`);
  if (!host) return;

  const page = await state.pdf.getPage(n);
  const viewport = state.viewports[n];

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = viewport.width + "px";
  canvas.style.height = viewport.height + "px";
  ctx.scale(dpr, dpr);

  // the page may have scrolled away again while we were awaiting
  if (!state.rendered.has(n)) return;

  host.insertBefore(canvas, host.firstChild);
  await page.render({ canvasContext: ctx, viewport }).promise;

  state.canvases[n] = { canvas, dpr };

  const hl = document.createElement("div");
  hl.className = "highlightlayer";
  host.appendChild(hl);

  await buildTextLayer(page, viewport, host);
  buildCaptureLayer(host, n);

  paintHighlights(n);
  applyMode();
}

function clearPage(n) {
  if (!state.rendered.has(n)) return;
  state.rendered.delete(n);
  delete state.canvases[n];

  const host = $("stage").querySelector(`.page[data-page="${n}"]`);
  if (!host) return;
  host.querySelectorAll("canvas, .textlayer, .highlightlayer, .capturelayer")
      .forEach((el) => el.remove());
}

async function buildTextLayer(page, viewport, host) {
  const layer = document.createElement("div");
  layer.className = "textlayer";

  const content = await page.getTextContent();
  const pending = [];

  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);

    const span = document.createElement("span");
    span.textContent = item.str;
    span.style.left = tx[4] + "px";
    span.style.top = (tx[5] - fontHeight) + "px";
    span.style.fontSize = fontHeight + "px";
    span.style.fontFamily = "sans-serif";
    layer.appendChild(span);
    pending.push([span, item.width * viewport.scale]);
  }

  host.appendChild(layer);

  for (const [span, targetWidth] of pending) {
    const actual = span.getBoundingClientRect().width;
    if (actual > 0 && targetWidth > 0) span.style.transform = `scaleX(${targetWidth / actual})`;
  }
}


/* =============================================================
   WHICH PAGE AM I LOOKING AT
   ============================================================= */

let scrollTimer = null;

$("reader").addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const reader = $("reader");
    const middle = reader.scrollTop + reader.clientHeight / 2;
    let current = 1;
    for (const host of $("stage").querySelectorAll(".page")) {
      if (host.offsetTop <= middle) current = Number(host.dataset.page);
      else break;
    }
    if (current !== state.pageNum) {
      state.pageNum = current;
      updateChrome();
      rememberPlace();
    }
  }, 90);
});

function goToPage(n, smooth = true) {
  const host = $("stage").querySelector(`.page[data-page="${n}"]`);
  if (!host) return;
  $("reader").scrollTo({ top: host.offsetTop - 16, behavior: smooth ? "smooth" : "auto" });
  state.pageNum = n;
  updateChrome();
}

function updateChrome() {
  $("pageno").textContent = state.pageNum + " / " + state.pageCount;
  $("btnPrev").disabled = state.pageNum <= 1;
  $("btnNext").disabled = state.pageNum >= state.pageCount;
  $("btnZoomFit").textContent = Math.round(state.zoom * 100) + "%";
  $("btnZoomFit").classList.toggle("on", Math.abs(state.zoom - 1) < 0.001);
}

$("btnPrev").addEventListener("click", () => goToPage(Math.max(1, state.pageNum - 1)));
$("btnNext").addEventListener("click", () => goToPage(Math.min(state.pageCount, state.pageNum + 1)));


/* =============================================================
   ZOOM
   ============================================================= */

async function setZoom(next) {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (!state.pdf || Math.abs(clamped - state.zoom) < 0.001) return;

  const anchor = state.pageNum;
  state.zoom = clamped;
  await layoutPages();
  goToPage(anchor, false);
  rememberPlace();
}

$("btnZoomIn").addEventListener("click",  () => setZoom(state.zoom * 1.25));
$("btnZoomOut").addEventListener("click", () => setZoom(state.zoom / 1.25));
$("btnZoomFit").addEventListener("click", () => setZoom(1));

$("reader").addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom(state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
}, { passive: false });

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    if (!state.pdf) return;
    const anchor = state.pageNum;
    await layoutPages();
    goToPage(anchor, false);
  }, 250);
});


/* =============================================================
   HIGHLIGHTS
   ============================================================= */

function paintHighlights(n) {
  const host = $("stage").querySelector(`.page[data-page="${n}"]`);
  if (!host) return;
  const layer = host.querySelector(".highlightlayer");
  if (!layer) return;

  const vp = state.viewports[n];
  layer.innerHTML = "";

  for (const mark of state.marks) {
    if (mark.page !== n) continue;
    if (!mark.rects || !mark.rects.length) continue;
    if (!passesFilter(mark)) continue;

    for (const r of mark.rects) {
      const box = document.createElement("div");
      box.className = "hbox"
        + (mark.id === state.focusId ? " focused" : "")
        + (mark.body === "figure" ? " region" : "");
      box.style.left   = (r.x * vp.width) + "px";
      box.style.top    = (r.y * vp.height) + "px";
      box.style.width  = (r.w * vp.width) + "px";
      box.style.height = (r.h * vp.height) + "px";
      box.style.background = kindColor(mark.kind);
      layer.appendChild(box);
    }
  }
}

function paintAllHighlights() {
  for (const n of state.rendered) paintHighlights(n);
}

function passesFilter(mark) {
  if (!state.filterColors) return true;
  return state.filterColors.has(colorId(mark.kind));
}


/* =============================================================
   SELECTION -> MARK
   ============================================================= */

function textFromRange(range) {
  const fragment = range.cloneContents();
  const spans = fragment.querySelectorAll("span");
  let text = spans.length
    ? Array.from(spans).map((s) => s.textContent).join(" ")
    : fragment.textContent;
  text = text.replace(/\s+/g, " ").trim();
  return text.replace(/([a-z])-\s+([a-z])/g, "$1$2");
}

const SUSPECT = /[\u00A1-\u00BF\u00C0-\u00FF\u0132-\u0233\u25A0-\u25FF\uFFFD\uF000-\uF8FF]/g;

function looksGarbled(text) {
  if (!text || text.length < 12) return false;
  return (text.match(SUSPECT) || []).length / text.length > 0.08;
}

document.addEventListener("mouseup", handleSelection);

async function handleSelection() {
  if (!state.pdf || state.boardOpen || state.mode === "capture") return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  // which page is this selection in?
  const anchorEl = selection.anchorNode &&
    (selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement);
  const layer = anchorEl && anchorEl.closest(".textlayer");
  if (!layer) return;

  const host = layer.closest(".page");
  const pageNum = Number(host.dataset.page);

  const range = selection.getRangeAt(0);
  const text = textFromRange(range);
  if (text.length < 3) return;

  const pageBox = host.getBoundingClientRect();
  const vp = state.viewports[pageNum];

  const rects = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    rects.push({
      x: (r.left - pageBox.left) / vp.width,
      y: (r.top  - pageBox.top)  / vp.height,
      w: r.width  / vp.width,
      h: r.height / vp.height,
    });
  }
  if (!rects.length) return;

  selection.removeAllRanges();

  const garbled = looksGarbled(text);
  await addMark({
    page: pageNum,
    body: garbled ? "figure" : "text",
    text,
    rects,
    image: garbled ? snapshotOfRects(pageNum, rects) : null,
    garbled,
  });
}


/* =============================================================
   CROPPING
   ============================================================= */

function cropRegion(pageNum, x0, y0, w, h) {
  const entry = state.canvases[pageNum];
  if (!entry || w < 4 || h < 4) return null;

  const out = document.createElement("canvas");
  out.width = Math.floor(w * entry.dpr);
  out.height = Math.floor(h * entry.dpr);
  out.getContext("2d").drawImage(
    entry.canvas,
    x0 * entry.dpr, y0 * entry.dpr, w * entry.dpr, h * entry.dpr,
    0, 0, out.width, out.height
  );
  return out.toDataURL("image/png");
}

function snapshotOfRects(pageNum, rects, padding = 6) {
  const vp = state.viewports[pageNum];
  if (!vp) return null;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x * vp.width);
    y0 = Math.min(y0, r.y * vp.height);
    x1 = Math.max(x1, (r.x + r.w) * vp.width);
    y1 = Math.max(y1, (r.y + r.h) * vp.height);
  }
  x0 = Math.max(0, x0 - padding); y0 = Math.max(0, y0 - padding);
  x1 = Math.min(vp.width, x1 + padding); y1 = Math.min(vp.height, y1 + padding);

  return cropRegion(pageNum, x0, y0, x1 - x0, y1 - y0);
}

function textNearRegion(host, x0, y0, w, h) {
  const layer = host.querySelector(".textlayer");
  if (!layer) return "";
  const pageBox = host.getBoundingClientRect();
  const out = [];
  for (const span of layer.children) {
    const r = span.getBoundingClientRect();
    const top = r.top - pageBox.top;
    const left = r.left - pageBox.left;
    if (top > y0 - 10 && top < y0 + h + 70 && left > x0 - 60 && left < x0 + w + 60) {
      out.push(span.textContent);
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim().slice(0, 700);
}


/* =============================================================
   CAPTURE MODE
   ============================================================= */

function buildCaptureLayer(host, pageNum) {
  const layer = document.createElement("div");
  layer.className = "capturelayer";
  layer.hidden = state.mode !== "capture";
  host.appendChild(layer);

  let startX = 0, startY = 0, box = null;

  layer.addEventListener("pointerdown", (e) => {
    const bounds = layer.getBoundingClientRect();
    startX = e.clientX - bounds.left;
    startY = e.clientY - bounds.top;
    box = document.createElement("div");
    box.className = "capturebox";
    layer.appendChild(box);
    layer.setPointerCapture(e.pointerId);
  });

  layer.addEventListener("pointermove", (e) => {
    if (!box) return;
    const bounds = layer.getBoundingClientRect();
    const x = e.clientX - bounds.left, y = e.clientY - bounds.top;
    box.style.left = Math.min(x, startX) + "px";
    box.style.top = Math.min(y, startY) + "px";
    box.style.width = Math.abs(x - startX) + "px";
    box.style.height = Math.abs(y - startY) + "px";
  });

  layer.addEventListener("pointerup", async (e) => {
    if (!box) return;
    const bounds = layer.getBoundingClientRect();
    const x = e.clientX - bounds.left, y = e.clientY - bounds.top;
    const x0 = Math.min(x, startX), y0 = Math.min(y, startY);
    const w = Math.abs(x - startX), h = Math.abs(y - startY);
    box.remove(); box = null;
    if (w < 20 || h < 20) return;

    const vp = state.viewports[pageNum];
    await addMark({
      page: pageNum,
      body: "figure",
      text: textNearRegion(host, x0, y0, w, h),
      image: cropRegion(pageNum, x0, y0, w, h),
      rects: [{ x: x0 / vp.width, y: y0 / vp.height, w: w / vp.width, h: h / vp.height }],
    });
  });
}

function applyMode() {
  const capturing = state.mode === "capture";
  document.querySelectorAll(".capturelayer").forEach((el) => { el.hidden = !capturing; });
  document.querySelectorAll(".textlayer").forEach((el) => {
    el.style.pointerEvents = capturing ? "none" : "auto";
  });
  $("btnCapture").classList.toggle("on", capturing);
  $("btnSelect").classList.toggle("on", !capturing);
}

function setMode(mode) { state.mode = mode; applyMode(); }

$("btnSelect").addEventListener("click", () => setMode("select"));
$("btnCapture").addEventListener("click", () => setMode("capture"));


/* =============================================================
   MARKS
   ============================================================= */

async function addMark({ page, body, text, rects, image, garbled }) {
  snapshot("add mark");

  const mark = {
    id: makeId(),
    page, kind: state.kind, body, text, rects,
    image: image || null,
    garbled: !!garbled,
    note: "",
    x: null, y: null,
    createdAt: Date.now(),
  };

  state.marks.push(mark);
  state.focusId = mark.id;
  saveMarks();

  if (!state.deskOpen) await setDesk(true);
  paintHighlights(page);
  renderDesk(true);
}

function deleteMark(id) {
  snapshot("delete mark");
  state.marks = state.marks.filter((m) => m.id !== id);
  state.links = state.links.filter((l) => l.from !== id && l.to !== id);
  saveMarks();
  paintAllHighlights();
  renderDesk();
  if (state.boardOpen) renderBoard();
}

async function goToMark(id) {
  const mark = state.marks.find((m) => m.id === id);
  if (!mark) return;
  state.focusId = id;
  setBoard(false);
  if (!state.deskOpen) await setDesk(true);

  if (mark.page != null) {
    const host = $("stage").querySelector(`.page[data-page="${mark.page}"]`);
    if (host) {
      const offset = (mark.rects[0]?.y || 0) * state.viewports[mark.page].height;
      $("reader").scrollTo({ top: host.offsetTop + offset - 120, behavior: "smooth" });
      state.pageNum = mark.page;
      updateChrome();
    }
  }
  paintAllHighlights();
  renderDesk(true);
}
