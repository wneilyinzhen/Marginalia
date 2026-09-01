/* ---------------------------------------------------------------
   folder.js — keeping a real folder on disk in step with the app.

   The browser is still where the app reads and writes while you
   work. This file mirrors everything into a folder you choose:

     MarginaliaLibrary/
       Thin Film Stress Review/
         paper.pdf
         notes.json          <- your marks and interpretations
         text.json           <- extracted page text, for the AI later
         figures/
           a3f9x2.png        <- captured plots and equations

   Put that folder in OneDrive or Dropbox and it follows you
   between machines. Open notes.json in any text editor and it
   still makes sense in ten years.

   Chrome and Edge only. Firefox and Safari have not shipped this.
   --------------------------------------------------------------- */

const folderState = {
  handle: null,        // the chosen directory
  ready: false,        // permission granted this session
  saving: false,
  timer: null,
};


/* =============================================================
   PERMISSION

   The handle survives in IndexedDB, but permission does not
   survive a page reload. On startup we check: if Chrome still
   remembers the grant we reconnect silently, otherwise we show
   a button, because asking again requires a real click.
   ============================================================= */

async function folderPermission(handle, request = false) {
  const opts = { mode: "readwrite" };

  /* Chrome only honours requestPermission() while the click that
     triggered it is still "active", and that activation is spent by
     the first await. Checking queryPermission first therefore makes
     the request throw. So when we mean to ask, we ask immediately. */
  if (request) {
    try {
      return (await handle.requestPermission(opts)) === "granted";
    } catch (err) {
      console.error("permission request failed", err);
      return false;
    }
  }

  try {
    return (await handle.queryPermission(opts)) === "granted";
  } catch {
    return false;
  }
}

async function chooseFolder() {
  if (!window.showDirectoryPicker) {
    alert("This needs Chrome or Edge. Firefox and Safari can't write to folders yet.");
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    folderState.handle = handle;
    folderState.ready = true;

    // handles can be stored in IndexedDB directly — no conversion
    await dbPut("settings", { id: "folder", handle: handle });

    updateFolderBadge();
    await syncFromFolder();
    await syncAllToFolder();
  } catch (err) {
    if (err.name !== "AbortError") console.error(err);
  }
}

async function restoreFolder() {
  const saved = await dbGet("settings", "folder");
  if (!saved || !saved.handle) return;

  folderState.handle = saved.handle;
  folderState.ready = await folderPermission(saved.handle, false);
  updateFolderBadge();

  if (folderState.ready) await syncFromFolder();
}

async function reconnectFolder() {
  if (!folderState.handle) return chooseFolder();
  folderState.ready = await folderPermission(folderState.handle, true);
  updateFolderBadge();
  if (folderState.ready) {
    await syncFromFolder();
    await syncAllToFolder();
  }
}

function updateFolderBadge() {
  const btn = $("btnFolder");
  if (!folderState.handle) {
    btn.textContent = "Folder";
    btn.classList.remove("on");
    btn.title = "Choose a folder to keep your papers and notes in";
  } else if (!folderState.ready) {
    btn.textContent = "Reconnect";
    btn.classList.remove("on");
    btn.title = "Chrome needs a click to reopen " + folderState.handle.name;
  } else {
    btn.textContent = folderState.handle.name;
    btn.classList.add("on");
    btn.title = "Syncing to " + folderState.handle.name;
  }
}


/* =============================================================
   SMALL HELPERS
   ============================================================= */

// Windows forbids these characters in names, and trailing dots.
function safeName(title) {
  return (title || "Untitled")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/, "")
    .slice(0, 120)
    .trim() || "Untitled";
}

async function writeFile(dirHandle, name, contents) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

async function fileExists(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function readJson(dirHandle, name) {
  try {
    const fileHandle = await dirHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(body);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type: mime });
}


/* =============================================================
   MERGING

   Two copies of the same paper can both hold real work: you wrote
   a note on the laptop, asked a question on the desktop. Choosing
   one whole copy over the other throws half of it away.

   So marks are merged one at a time. For each mark the richer
   version wins field by field — the longer note, the longer
   thread, whichever has an image, whichever has a board position.
   Nothing is discarded because it happened to be saved second.
   ============================================================= */

function mergeMark(a, b) {
  const out = { ...a };

  if ((b.note || "").length > (a.note || "").length) out.note = b.note;

  const threadA = a.thread || [];
  const threadB = b.thread || [];
  out.thread = threadB.length > threadA.length ? threadB : threadA;

  out.image = a.image || b.image || null;
  if (a.garbled || b.garbled) out.garbled = true;

  if (out.x == null && b.x != null) { out.x = b.x; out.y = b.y; }
  if (!out.text && b.text) out.text = b.text;

  return out;
}

function mergeMarkLists(mine, theirs) {
  const byId = new Map();
  for (const m of theirs || []) byId.set(m.id, m);
  for (const m of mine || []) {
    const other = byId.get(m.id);
    byId.set(m.id, other ? mergeMark(m, other) : m);
  }
  return [...byId.values()];
}

function mergeLinkLists(mine, theirs) {
  const byId = new Map();
  for (const l of theirs || []) byId.set(l.id, l);
  for (const l of mine || []) byId.set(l.id, l);
  return [...byId.values()];
}

/* How much real work a set of marks represents. Used only to log
   a warning when a write would shrink what's on disk. */
function weigh(marks) {
  let n = 0;
  for (const m of marks || []) {
    n += (m.note || "").length;
    n += (m.thread || []).reduce((sum, t) => sum + (t.a || "").length, 0);
  }
  return n;
}


/* =============================================================
   WRITING OUT

   Images are written as real PNG files rather than base64 inside
   the JSON. That keeps notes.json readable and keeps the figures
   openable in any image viewer.
   ============================================================= */

async function writePaperFolder(paper, marks) {
  const root = folderState.handle;
  const dir = await root.getDirectoryHandle(safeName(paper.title), { create: true });

  /* Never overwrite blind. Read what's already there and fold it
     in, so a copy of this paper that was edited elsewhere keeps its
     notes and its conversations. */
  const onDisk = await readJson(dir, "notes.json");

  if (onDisk && onDisk.marks) {
    const before = weigh(onDisk.marks);
    marks = mergeMarkLists(marks, onDisk.marks);
    const after = weigh(marks);

    if (after < before) {
      console.warn(
        `Refusing to shrink "${paper.title}" on disk ` +
        `(${before} → ${after} characters of your writing). Nothing written.`);
      return;
    }

    // keep the merged version in the browser too, so the two agree
    if (paper.id === state.docId) {
      state.marks = marks;
      state.links = mergeLinkLists(state.links, onDisk.links);
      if (typeof renderDesk === "function") renderDesk();
      if (typeof paintAllHighlights === "function") paintAllHighlights();
    }
  }

  // the PDF, written once — no point rewriting megabytes every save
  if (paper.file && !(await fileExists(dir, "paper.pdf"))) {
    await writeFile(dir, "paper.pdf", paper.file);
  }

  // extracted text, also written once
  if (paper.text && paper.text.length && !(await fileExists(dir, "text.json"))) {
    await writeFile(dir, "text.json", JSON.stringify({
      pageCount: paper.pageCount,
      pages: paper.text,
    }));
  }

  // figures, and a copy of each mark with the image swapped for a path
  const forDisk = [];
  let figuresDir = null;

  for (const mark of marks) {
    const copy = { ...mark };
    if (mark.image && mark.image.startsWith("data:")) {
      if (!figuresDir) {
        figuresDir = await dir.getDirectoryHandle("figures", { create: true });
      }
      const name = mark.id + ".png";
      if (!(await fileExists(figuresDir, name))) {
        await writeFile(figuresDir, name, dataUrlToBlob(mark.image));
      }
      copy.image = "figures/" + name;
    }
    forDisk.push(copy);
  }

  await writeFile(dir, "notes.json", JSON.stringify({
    id: paper.id,
    title: paper.title,
    filename: paper.filename,
    size: paper.size,
    pageCount: paper.pageCount,
    savedAt: Date.now(),
    marks: forDisk,
    links: (paper.id === state.docId ? state.links : (paper.links || [])),
  }, null, 2));
}

async function syncCurrentToFolder() {
  if (!folderState.ready || !state.docId || folderState.saving) return;
  folderState.saving = true;
  try {
    const paper = await dbGet("papers", state.docId);
    if (paper) await writePaperFolder(paper, state.marks);
  } catch (err) {
    console.error("folder save failed", err);
  } finally {
    folderState.saving = false;
  }
}

// called from saveMarks(), so writing to disk follows your typing
function scheduleFolderSave() {
  if (!folderState.ready) return;
  clearTimeout(folderState.timer);
  folderState.timer = setTimeout(syncCurrentToFolder, 2500);
}

async function syncAllToFolder() {
  if (!folderState.ready) return;
  const papers = await listPapers();
  for (const paper of papers) {
    const record = await dbGet("notes", paper.id);
    paper.links = record ? record.links || [] : [];
    await writePaperFolder(paper, record ? record.marks : []);
  }
  console.log(`wrote ${papers.length} papers to ${folderState.handle.name}`);
}


/* =============================================================
   READING BACK IN

   Walk the folder, and for anything newer on disk than in the
   browser, pull it in. Last write wins. That's enough for one
   person moving between machines; it is not enough for two
   people editing at once, and it isn't trying to be.
   ============================================================= */

/* Pull one paper's notes in from the folder, if the folder has a
   newer copy. Called when a PDF is opened, so that opening a paper
   on a second machine picks up what the first machine wrote. */
async function syncPaperFromFolder(docId) {
  if (!folderState.ready || !docId) return false;

  for await (const [name, handle] of folderState.handle.entries()) {
    if (handle.kind !== "directory") continue;

    const notes = await readJson(handle, "notes.json");
    if (!notes || notes.id !== docId) continue;

    let figuresDir = null;
    for (const mark of notes.marks) {
      if (typeof mark.image === "string" && mark.image.startsWith("figures/")) {
        try {
          if (!figuresDir) figuresDir = await handle.getDirectoryHandle("figures");
          const fileHandle = await figuresDir.getFileHandle(mark.image.slice(8));
          mark.image = await blobToDataUrl(await fileHandle.getFile());
        } catch { mark.image = null; }
      }
    }

    // fold the folder copy into whatever this browser already has
    const local = await dbGet("notes", docId);
    const merged = mergeMarkLists(local ? local.marks : [], notes.marks);
    const mergedLinks = mergeLinkLists(local ? local.links : [], notes.links);

    await dbPut("notes", {
      id: docId, marks: merged, links: mergedLinks, savedAt: Date.now() });

    console.log(`merged folder copy: ${(local ? local.marks.length : 0)} local + ` +
                `${notes.marks.length} on disk = ${merged.length} marks, ` +
                `${weigh(merged)} characters of writing`);
    return true;
  }
  return false;
}

async function syncFromFolder() {
  if (!folderState.ready) return;

  let imported = 0;

  for await (const [name, handle] of folderState.handle.entries()) {
    if (handle.kind !== "directory") continue;

    const notes = await readJson(handle, "notes.json");
    if (!notes || !notes.id) continue;

    // turn figure paths back into images the app can render
    let figuresDir = null;
    for (const mark of notes.marks) {
      if (typeof mark.image === "string" && mark.image.startsWith("figures/")) {
        try {
          if (!figuresDir) figuresDir = await handle.getDirectoryHandle("figures");
          const fileHandle = await figuresDir.getFileHandle(mark.image.slice(8));
          mark.image = await blobToDataUrl(await fileHandle.getFile());
        } catch {
          mark.image = null;
        }
      }
    }

    const localNotes = await dbGet("notes", notes.id);
    await dbPut("notes", {
      id: notes.id,
      marks: mergeMarkLists(localNotes ? localNotes.marks : [], notes.marks),
      links: mergeLinkLists(localNotes ? localNotes.links : [], notes.links),
      savedAt: Date.now(),
    });

    // bring the PDF itself across if this machine has never seen it
    if (!(await dbGet("papers", notes.id))) {
      let file = null;
      try {
        const blob = await (await handle.getFileHandle("paper.pdf")).getFile();
        // rename it back, so anything deriving an id from the
        // filename gets the same answer it did originally
        file = new File([blob], notes.filename || "paper.pdf",
                        { type: "application/pdf" });
      } catch { /* folder has notes but no PDF */ }

      const text = await readJson(handle, "text.json");

      await dbPut("papers", {
        id: notes.id,
        title: notes.title,
        filename: notes.filename,
        size: notes.size,
        pageCount: notes.pageCount,
        text: text ? text.pages : [],
        file: file,
        addedAt: Date.now(),
        lastOpened: 0,
      });
    }

    imported++;
  }

  if (imported) {
    console.log(`imported ${imported} papers from ${folderState.handle.name}`);
    if (state.libraryOpen) renderLibrary();
    if (state.docId) {
      await loadMarks();
      paintHighlights();
      renderDesk();
    }
  }

  const papers = await listPapers();
  if (papers.length) $("btnLibrary").textContent = `Library ${papers.length}`;
}


/* =============================================================
   START
   ============================================================= */

/* =============================================================
   DIAGNOSTIC

   Type  diagnose()  in the console. Reports what the app can
   actually see, folder side and browser side, so a sync failure
   points at one place instead of three.
   ============================================================= */

async function diagnose() {
  console.log("=== MARGINALIA ===");
  console.log("folder chosen :", folderState.handle ? folderState.handle.name : "(none)");
  console.log("permission    :", folderState.ready ? "granted" : "NOT granted");
  console.log("open paper id :", state.docId || "(none open)");

  if (folderState.handle && !folderState.ready) {
    console.log(">> Click the Folder button to re-grant access, then run diagnose() again.");
  }

  if (folderState.ready) {
    console.log("--- what is inside the chosen folder ---");
    let entries = 0, withNotes = 0;
    for await (const [name, handle] of folderState.handle.entries()) {
      entries++;
      if (handle.kind !== "directory") {
        console.log("   [file] " + name);
        continue;
      }
      const notes = await readJson(handle, "notes.json");
      if (notes) {
        withNotes++;
        console.log(`   [dir ] ${name}  ->  id="${notes.id}"  marks=${(notes.marks||[]).length}` +
                    `  saved=${new Date(notes.savedAt).toLocaleString()}`);
      } else {
        console.log(`   [dir ] ${name}  ->  no notes.json directly inside`);
      }
    }
    console.log(`   ${entries} entries, ${withNotes} with notes.json`);
    if (entries && !withNotes) {
      console.log(">> You probably picked the folder ABOVE the library. " +
                  "Click Folder again and choose the folder that CONTAINS the paper folders.");
    }
  }

  console.log("--- what this browser has stored ---");
  const papers = await dbAll("papers");
  const notes  = await dbAll("notes");
  papers.forEach((p) => console.log(`   paper  id="${p.id}"  "${p.title}"  pdf=${p.file ? "yes" : "NO"}`));
  notes.forEach((n)  => console.log(`   notes  id="${n.id}"  marks=${(n.marks||[]).length}`));
  if (!papers.length && !notes.length) console.log("   (nothing stored)");

  console.log("marks loaded in this session:", state.marks.length);
  console.log("==================");
}
window.diagnose = diagnose;


$("btnFolder").addEventListener("click", async () => {
  if (!folderState.handle) return chooseFolder();

  if (!folderState.ready) {
    // ask straight away — no await before this one
    folderState.ready = await folderPermission(folderState.handle, true);
    updateFolderBadge();
    if (folderState.ready) {
      await syncFromFolder();
      await syncAllToFolder();
    } else {
      // the remembered handle is no longer usable; let them re-pick
      if (confirm("Couldn't reopen that folder. Choose it again?")) chooseFolder();
    }
    return;
  }

  if (confirm(`Connected to "${folderState.handle.name}".\n\n` +
              `OK to choose a different folder, or Cancel to sync now.`)) {
    chooseFolder();
  } else {
    await syncAllToFolder();
    console.log("manual sync done");
  }
});

restoreFolder();
