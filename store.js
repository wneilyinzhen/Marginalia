/* ---------------------------------------------------------------
   store.js — shared state, storage, undo.
   Loaded first; everything else builds on it.
   --------------------------------------------------------------- */

/* Bump this whenever you change a file. It prints on load, so a
   stale cached script is visible immediately instead of showing up
   as a button that mysteriously does nothing. */
const BUILD = "2026-09-01c";

const COLORS = [
  { id: "yellow", css: "--c-yellow" },
  { id: "green",  css: "--c-green"  },
  { id: "blue",   css: "--c-blue"   },
  { id: "purple", css: "--c-purple" },
  { id: "pink",   css: "--c-pink"   },
  { id: "gray",   css: "--c-gray"   },
];

const LEGACY_KINDS = { claim: "yellow", mech: "blue", data: "purple", doubt: "pink" };

function colorId(kind) {
  if (LEGACY_KINDS[kind]) return LEGACY_KINDS[kind];
  return COLORS.some((c) => c.id === kind) ? kind : COLORS[0].id;
}

function kindColor(kind) {
  const color = COLORS.find((c) => c.id === colorId(kind)) || COLORS[0];
  return getComputedStyle(document.documentElement).getPropertyValue(color.css).trim();
}

function colorVar(kind) {
  const color = COLORS.find((c) => c.id === colorId(kind)) || COLORS[0];
  return color.css;
}

/* How two marks can relate. Deliberately few — the point is a
   claim about the relationship, not a taxonomy of relationships. */
const RELATIONS = [
  { id: "plain",      label: "relates to",  color: "#A1A1AA" },
  { id: "supports",   label: "supports",    color: "#4A9E6B" },
  { id: "contradicts",label: "contradicts", color: "#D4574E" },
  { id: "extends",    label: "extends",     color: "#4A82C4" },
];

function relationOf(id) {
  return RELATIONS.find((r) => r.id === id) || RELATIONS[0];
}


const state = {
  pdf: null, docId: null, title: null,
  pageCount: 0, pageNum: 1, text: [],
  viewports: [], canvases: {}, rendered: new Set(), observer: null,
  zoom: 1,
  deskOpen: false, boardOpen: false, libraryOpen: false, searchOpen: false,
  mode: "select",
  marks: [], links: [], deleted: [],
  kind: "yellow", focusId: null,
  filterColors: null,          // null = show everything
  canvasEl: null, dpr: 1, topZ: 10,
  subjectFilter: "__all__",
};

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function makeId() { return Math.random().toString(36).slice(2, 10); }

function toast(message, ms = 2600) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.innerHTML = message;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), ms);
}


/* =============================================================
   UNDO

   A snapshot of the marks and links, taken before anything
   destructive. Cheap because the data is small, and simpler than
   trying to invert each operation.
   ============================================================= */

const undoStack = [];
const UNDO_LIMIT = 40;

function snapshot(description) {
  undoStack.push({
    description: description,
    marks: JSON.parse(JSON.stringify(state.marks)),
    links: JSON.parse(JSON.stringify(state.links)),
    deleted: JSON.parse(JSON.stringify(state.deleted)),
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function undo() {
  const previous = undoStack.pop();
  if (!previous) { toast("Nothing to undo"); return; }

  state.marks = previous.marks;
  state.links = previous.links;
  state.deleted = previous.deleted || [];
  saveMarks();

  paintAllHighlights();
  renderDesk();
  if (state.boardOpen) renderBoard();
  toast("Undid: " + previous.description);
}


/* =============================================================
   INDEXEDDB
   ============================================================= */

const DB_NAME = "marginalia";
const DB_VERSION = 2;

let dbHandle = null;

function openDb() {
  if (dbHandle) return dbHandle;
  dbHandle = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("papers")) db.createObjectStore("papers", { keyPath: "id" });
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbHandle;
}

async function dbPut(storeName, record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet(storeName, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function dbAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(storeName, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}


/* =============================================================
   SUBJECTS
   ============================================================= */

const UNFILED = "__unfiled__";

async function listSubjects() {
  const record = await dbGet("settings", "subjects");
  return record ? record.list : [];
}
async function saveSubjects(list) { await dbPut("settings", { id: "subjects", list }); }

async function addSubject(name) {
  const clean = (name || "").trim();
  if (!clean) return;
  const list = await listSubjects();
  if (list.includes(clean)) return;
  list.push(clean);
  await saveSubjects(list);
}

async function removeSubject(name) {
  await saveSubjects((await listSubjects()).filter((s) => s !== name));
  for (const paper of await dbAll("papers")) {
    if (paper.subject === name) { paper.subject = null; await dbPut("papers", paper); }
  }
}

async function setPaperSubject(paperId, subject) {
  const paper = await dbGet("papers", paperId);
  if (!paper) return;
  paper.subject = subject === UNFILED ? null : subject;
  await dbPut("papers", paper);
}


/* =============================================================
   PAPERS AND NOTES
   ============================================================= */

async function savePaper(file) {
  const existing = await dbGet("papers", state.docId);
  await dbPut("papers", {
    id: state.docId,
    title: state.title,
    filename: file.name,
    size: file.size,
    pageCount: state.pageCount,
    text: state.text,
    file: file,
    subject: existing ? existing.subject || null : null,
    lastPage: existing ? existing.lastPage || 1 : 1,
    zoom: existing ? existing.zoom || 1 : 1,
    addedAt: existing ? existing.addedAt : Date.now(),
    lastOpened: Date.now(),
  });
}

async function touchPaper() {
  const record = await dbGet("papers", state.docId);
  if (!record) return;
  record.lastOpened = Date.now();
  await dbPut("papers", record);
}

/* Where you were, remembered per paper. Written on a lazy timer
   because it changes on every scroll tick. */
let placeTimer = null;
function rememberPlace() {
  if (!state.docId) return;
  clearTimeout(placeTimer);
  placeTimer = setTimeout(async () => {
    const record = await dbGet("papers", state.docId);
    if (!record) return;
    record.lastPage = state.pageNum;
    record.zoom = state.zoom;
    await dbPut("papers", record);
  }, 900);
}

let saveTimer = null;

function saveMarks() {
  if (!state.docId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await dbPut("notes", {
        id: state.docId,
        marks: state.marks,
        links: state.links,
        deleted: state.deleted,
        savedAt: Date.now(),
      });
      if (typeof scheduleFolderSave === "function") scheduleFolderSave();
    } catch (err) {
      console.error("save failed", err);
    }
  }, 300);
}

async function loadMarks() {
  const record = await dbGet("notes", state.docId);
  state.marks = record ? record.marks || [] : [];
  state.links = record ? record.links || [] : [];
  state.deleted = record ? record.deleted || [] : [];
  undoStack.length = 0;
}

/* A deletion has to be recorded, not just acted on.

   Two copies of a paper are reconciled by combining their marks. A
   mark you removed here still exists in the other copy, so a plain
   combine puts it straight back. Keeping a list of what was
   deliberately removed is what lets a deletion win over a copy that
   simply hasn't heard about it yet. */
function tombstone(id) {
  if (!state.deleted.some((d) => d.id === id)) {
    state.deleted.push({ id, at: Date.now() });
  }
}

function isDeleted(id, list) {
  return (list || []).some((d) => d.id === id);
}

function mergeDeleted(a, b) {
  const byId = new Map();
  for (const d of a || []) byId.set(d.id, d);
  for (const d of b || []) byId.set(d.id, d);
  return [...byId.values()];
}

async function listPapers() {
  const papers = await dbAll("papers");
  const notes = await dbAll("notes");
  const counts = {};
  for (const n of notes) counts[n.id] = (n.marks || []).length;
  return papers
    .map((p) => ({ ...p, markCount: counts[p.id] || 0 }))
    .sort((a, b) => b.lastOpened - a.lastOpened);
}

async function deletePaper(id) {
  await dbDelete("papers", id);
  await dbDelete("notes", id);
}
