/* ---------------------------------------------------------------
   ai.js — the reading companion.

   Everything agreed on earlier is encoded here:
   - You read; it never summarizes the paper.
   - Every claim is either cited from the paper as (p. N) or marked
     [outside the paper] — never blended in one sentence.
   - Leading questions with false premises get pushed back on, not
     answered fluently.
   - "Outside this paper" is a legitimate move and answers normally,
     labelled once at the top.
   - Each mark carries its own short thread.

   The key is the user's own, stored in this browser's IndexedDB
   only. It is deliberately NEVER written to the sync folder —
   notes belong in Dropbox, credentials do not.
   --------------------------------------------------------------- */

const ai = {
  key: null,
  model: "claude-sonnet-5",
  busy: false,
  scope: "near",          // "near" = pages around the mark, "all" = whole paper
  spent: { in: 0, out: 0, cacheWrite: 0, cacheRead: 0, calls: 0 },
};

/* Rough per-million-token prices, for the running meter only.
   Cache writes cost about 1.25x input; cache reads about 0.1x. */
const PRICES = {
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-opus-5":   { in: 5, out: 25 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4 },
};

function estimateCost() {
  const p = PRICES[ai.model] || PRICES["claude-sonnet-5"];
  const s = ai.spent;
  return (s.in * p.in + s.cacheWrite * p.in * 1.25 + s.cacheRead * p.in * 0.1
          + s.out * p.out) / 1e6;
}

function recordUsage(usage) {
  ai.spent.calls++;
  ai.spent.in         += usage.input_tokens || 0;
  ai.spent.out        += usage.output_tokens || 0;
  ai.spent.cacheWrite += usage.cache_creation_input_tokens || 0;
  ai.spent.cacheRead  += usage.cache_read_input_tokens || 0;
  updateMeter();
}

function updateMeter() {
  const el = $("askMeter");
  if (!el) return;
  const s = ai.spent;
  if (!s.calls) { el.textContent = ""; return; }
  const saved = s.cacheRead ? ` · ${Math.round(s.cacheRead / 1000)}k from cache` : "";
  el.textContent = `${s.calls} ${s.calls === 1 ? "call" : "calls"} · ` +
                   `~$${estimateCost().toFixed(3)} this session${saved}`;
}


/* =============================================================
   THE STANDING PROMPT
   ============================================================= */

const AI_SYSTEM = `You are the reading companion built into a research engineer's own reading tool. He reads the paper himself, marks passages, writes his own interpretation, and then asks you about it. He works in thin-film processing, plasma, and materials characterization. Write for a peer.

You have the full text of the paper. It is there so you can be accurate, not so you can retell it.

NEVER:
- Summarize the paper, or any part of it he did not ask about.
- Comment on his interpretation unless he asked you to.
- Volunteer takeaways, overviews, or "in short" framing.
- Open with preamble, restate his question, or close by offering further help.

SOURCING — the rule that never bends.
Every claim you make comes from one of two places, and he must always be able to tell which:
- From this paper — cite the page as (p. N), using the [p. N] markers in the text.
- From your own knowledge of the field — prefix the sentence with [outside the paper] and state your confidence.
Never blend the two in one sentence. He can verify the first kind in seconds and must judge the second kind himself, which is only possible if they are separable.

If the paper does not address what he asked, say that first, then answer from field knowledge if you can, marked as above.

CHECK THE PREMISE BEFORE ANSWERING.
If his question assumes something the paper does not say — a trend in the wrong direction, a mechanism it never invokes, a condition it never tested — say so first and do not construct an explanation for it. A fluent answer to a false premise is the worst thing you can hand him.

WHEN HE EXPLICITLY STEPS OUTSIDE THE PAPER ("outside this paper", "in general", "generally"):
Answer from field knowledge as a knowledgeable colleague would. Say once at the top that the answer is not grounded in this document, then write normally without per-sentence marking. The premise check does not apply; he knows he has left the paper. If the paper does bear on his general question, say so and cite it, but do not redirect him back to it. Distinguish settled from contested: if the field disagrees, say what the disagreement is rather than picking a side.

WHEN HE ASKS WHETHER HE UNDERSTOOD CORRECTLY:
Verdict in the first sentence: correct, partly correct, or incorrect. Then the precise delta — which word, arrow, quantifier, or condition differs from the paper. Look hardest at reversed causal direction, conflated mechanisms, and generalization beyond stated conditions. Distinguish what the paper measured, what it inferred, and what it assumed; his error usually sits on one of those boundaries. No cushioning.

OTHERWISE: answer the question he asked, in the form that fits it. A "why" gets a mechanism. A "what does this mean" gets a definition. Match length to the question — usually under 250 words.`;

const TAKEAWAY_SYSTEM = `You reflect a research engineer's own reading notes back to him for review. He marked these passages and wrote these interpretations himself. Your job is to organize what HE recorded, not to teach him the paper.

Write in second person: "You read X as...", "You flagged Y because...".

Use HIS words. Quote his notes directly rather than paraphrasing them into cleaner prose. Polished paraphrase makes him feel he understood something better than he did.

Structure the output as exactly these four sections:

WHAT YOU TOOK FROM THIS PAPER
The through-line across his marks — what he was actually tracking. Two or three sentences. If his marks are scattered with no through-line, say that instead of manufacturing one.

WHERE YOU LANDED
Group his marks by what he did with them. Cite each as [n] using the mark numbers given, with the page. One line per mark.

WHERE YOUR NOTE AND THE PAPER DIVERGE
Only where his written interpretation actually conflicts with the paper text. Name the mark, the specific delta, and the page. If nothing diverges, write "nothing found". Do not manufacture disagreements to fill this section.

WHAT YOU MARKED BUT NEVER INTERPRETED
List the marks with no note: number, page, a few words of the passage. Nothing else — do not interpret them for him.

Do not summarize the paper. Do not add field knowledge. Do not add anything he did not write.`;

const PRESETS = [
  { id: "check",   label: "Check my reading",
    text: "Am I reading this correctly? Judge my interpretation against what the paper actually says, and name any error precisely." },
  { id: "explain", label: "Explain this",
    text: "Explain this passage: the mechanism or method behind it, and what the terms and quantities mean." },
  { id: "context", label: "Where this sits",
    text: "Where does this passage sit in the paper's argument — what does it depend on, what does it enable, and why does it matter to the result?" },
];


/* =============================================================
   KEY MANAGEMENT
   ============================================================= */

/* Write only the fields given, keeping whatever else is stored.
   The old version replaced the whole record, so a scope change
   could write back a null key if it ran before the key loaded. */
async function patchAiSettings(fields) {
  const current = (await dbGet("settings", "ai")) || {};
  await dbPut("settings", { ...current, ...fields, id: "ai" });
}

const KEY_MIRROR = "marginalia:apikey";

async function loadAiSettings() {
  const record = await dbGet("settings", "ai");

  if (record) {
    ai.key = record.key || null;
    ai.model = record.model || "claude-sonnet-5";
    ai.scope = record.scope || "near";
  }

  // Second copy in localStorage. Belt and braces: the two are
  // evicted under different conditions, so one usually survives.
  if (!ai.key) {
    const mirrored = localStorage.getItem(KEY_MIRROR);
    if (mirrored) {
      ai.key = mirrored;
      await patchAiSettings({ key: mirrored });
    }
  }

  setScope(ai.scope);
  updateAiBadge();
  requestPersistentStorage();
}

async function saveAiSettings() {
  await patchAiSettings({ key: ai.key, model: ai.model, scope: ai.scope });
  if (ai.key) localStorage.setItem(KEY_MIRROR, ai.key);
  else localStorage.removeItem(KEY_MIRROR);
  updateAiBadge();
}

/* Ask Chrome not to evict this site's storage.

   By default a browser may clear IndexedDB when disk gets tight,
   and it does that without asking. That would take your papers and
   notes with it, not just the key. Granted automatically once the
   site looks used — bookmarked, installed, or visited often. */
async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return;
  try {
    if (await navigator.storage.persisted()) return;
    const granted = await navigator.storage.persist();
    console.log(granted
      ? "storage marked persistent — Chrome won't evict your notes"
      : "storage not yet persistent; bookmark or install the app and it will be");
  } catch (err) {
    console.log("persistence request failed", err.message);
  }
}

function updateAiBadge() {
  const btn = $("btnAi");
  btn.classList.toggle("on", !!ai.key);
  btn.title = ai.key ? `Connected · ${ai.model}` : "Connect your Anthropic API key";
}

function openAiModal() {
  $("aiKeyInput").value = ai.key || "";
  $("aiModelInput").value = ai.model;

  const status = $("aiStatus");
  if (ai.key) {
    const tail = ai.key.slice(-6);
    status.innerHTML = `<span class="ok">Saved in this browser</span> &middot; ` +
                       `key ending <code>${escapeHtml(tail)}</code>`;
    $("btnAiForget").hidden = false;
  } else {
    status.innerHTML = `No key stored yet.`;
    $("btnAiForget").hidden = true;
  }

  $("aiModal").hidden = false;
  $("aiKeyInput").focus();
}

$("btnAiForget").addEventListener("click", async () => {
  if (!confirm("Remove the stored API key from this browser?")) return;
  ai.key = null;
  await saveAiSettings();
  $("aiKeyInput").value = "";
  $("aiModal").hidden = true;
  toast("Key removed");
});

$("btnAi").addEventListener("click", openAiModal);
$("btnAiCancel").addEventListener("click", () => { $("aiModal").hidden = true; });

$("btnAiSave").addEventListener("click", async () => {
  ai.key = $("aiKeyInput").value.trim() || null;
  ai.model = $("aiModelInput").value.trim() || "claude-sonnet-5";
  await saveAiSettings();
  $("aiModal").hidden = true;

  if (ai.key) {
    toast("Testing the connection…");
    try {
      const reply = await callModel([{ role: "user", content: "Reply with exactly: connected" }],
                                    "Reply with exactly the word: connected", 24);
      toast(reply.text.includes("connected") ? "AI connected" : "Connected, unexpected reply");
    } catch (err) {
      toast("Key saved, but the test failed: " + err.message, 5200);
    }
  } else {
    toast("Key removed");
  }
});


/* =============================================================
   THE CLIENT

   One function; the provider is one file. The paper text goes
   first and carries a cache marker, so fifteen questions about
   one paper cost like two.
   ============================================================= */

async function callModel(messages, system, maxTokens = 4000) {
  if (!ai.key) throw new Error("No API key — click AI in the top bar.");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ai.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, system, messages }),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data.error?.message || response.statusText;
    if (response.status === 401) throw new Error("Key rejected — check it in the AI settings.");
    if (response.status === 429) throw new Error("Rate limited — wait a moment.");
    throw new Error(message);
  }

  recordUsage(data.usage || {});

  return {
    text: (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
    usage: data.usage || {},
    // "end_turn" means it finished; "max_tokens" means we cut it off
    stop: data.stop_reason || "end_turn",
  };
}

/* The whole paper is the accurate context and the expensive one.
   A 49-page review is ~70k tokens on every question.

   Two ways out, both used here:

   "all"  — send everything, but mark it cacheable. The block is
            byte-identical across questions about the same paper, so
            after the first call it costs about a tenth. Best when
            you're asking many questions in one sitting.

   "near" — send the marked page and its neighbours, plus any page
            whose text contains a distinctive word from the question.
            Roughly 3k tokens instead of 70k. Cheap, and enough for
            "what does this mean" or "is my reading right", but it
            cannot see the rest of the argument, so "where does this
            sit" will be worse. */
function paperBlock(mark, question) {
  const header = `PAPER — "${state.title}" (reference only; never summarize it)`;

  if (ai.scope === "all" || !mark || mark.page == null) {
    const pages = state.text.map((t, i) => `[p. ${i + 1}]\n${t}`).join("\n\n");
    return {
      type: "text",
      text: `FULL ${header}:\n\n${pages}`.slice(0, 600000),
      cache_control: { type: "ephemeral" },
    };
  }

  const wanted = new Set([mark.page - 1, mark.page, mark.page + 1]);

  // pull in any page that mentions an unusual word from the question
  const terms = (question || "")
    .toLowerCase()
    .split(/[^a-z0-9µσκΩ\-]+/)
    .filter((w) => w.length > 5);

  if (terms.length) {
    state.text.forEach((pageText, i) => {
      if (wanted.size > 10) return;
      const lower = (pageText || "").toLowerCase();
      if (terms.some((t) => lower.includes(t))) wanted.add(i + 1);
    });
  }

  const pages = [...wanted]
    .filter((n) => n >= 1 && n <= state.pageCount)
    .sort((a, b) => a - b)
    .map((n) => `[p. ${n}]\n${state.text[n - 1] || ""}`)
    .join("\n\n");

  return {
    type: "text",
    text: `PARTIAL ${header}.\nOnly these pages are included; the rest of the ` +
          `paper is NOT in front of you. If answering properly needs a part you ` +
          `cannot see, say so plainly rather than guessing.\n\n${pages}`,
  };
}

function markContext(mark) {
  const parts = [];
  if (mark.page != null) {
    parts.push(`THE PASSAGE I MARKED — page ${mark.page}:\n"""${mark.text}"""`);
  } else {
    parts.push(`MY OWN NOTE (my thinking, not from the paper):\n"""${mark.note || "(empty)"}"""`);
    const digest = state.marks
      .filter((m) => m.page != null)
      .slice(0, 40)
      .map((m) => `- (p.${m.page}) ${m.text.slice(0, 200)}${m.note ? `\n  MY READING: ${m.note.slice(0, 200)}` : ""}`)
      .join("\n");
    if (digest) parts.push(`MY MARKS IN THIS PAPER, FOR CONTEXT:\n${digest}`);
  }
  if (mark.page != null && mark.note && mark.note.trim()) {
    parts.push(`MY READING OF IT:\n"""${mark.note.trim()}"""`);
  }
  return parts.join("\n\n———\n\n");
}

async function askAboutMark(mark, question) {
  const thread = mark.thread || [];

  const firstContent = [paperBlock(mark, thread.length ? thread[0].q : question)];
  if (mark.image && mark.image.startsWith("data:image/png")) {
    firstContent.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: mark.image.split(",")[1] },
    });
  }

  const firstQuestion = thread.length ? thread[0].q : question;
  firstContent.push({ type: "text", text: markContext(mark) + `\n\n———\n\nMY QUESTION:\n${firstQuestion}` });

  const messages = [{ role: "user", content: firstContent }];

  /* Replay the thread so a "why?" lands on what was already said —
     but only the last few turns. A long thread otherwise re-sends
     every previous answer on every question, and the cost of that
     grows quadratically. */
  const REPLAY = 4;
  const replayed = thread.slice(-REPLAY);
  replayed.forEach((turn, index) => {
    messages.push({ role: "assistant", content: turn.a });
    if (index < replayed.length - 1) {
      messages.push({ role: "user", content: replayed[index + 1].q });
    }
  });
  if (thread.length) messages.push({ role: "user", content: question });

  return callModel(messages, AI_SYSTEM);
}


/* =============================================================
   THE QUESTION PANEL, ON THE BOARD
   ============================================================= */

function setAskPanel(open) {
  document.body.classList.toggle("ask-open", open);
  $("btnQuestion").classList.toggle("on", open);
  if (open) refreshAskTarget();
}

$("btnQuestion").addEventListener("click", () =>
  setAskPanel(!document.body.classList.contains("ask-open")));
$("btnAskClose").addEventListener("click", () => setAskPanel(false));

function focusedMark() {
  return state.marks.find((m) => m.id === state.focusId) || null;
}

function refreshAskTarget() {
  const mark = focusedMark();
  const target = $("askTarget");
  const thread = $("askThread");

  if (!mark) {
    target.innerHTML = `<div class="asknone">Click a card on the board to ask about it.</div>`;
    thread.innerHTML = "";
    return;
  }

  const where = mark.page != null ? `p.${mark.page}` : "My note";
  const body = mark.page == null
    ? escapeHtml((mark.note || "(empty note)").slice(0, 180))
    : (mark.image
        ? `<img src="${mark.image}" alt="">`
        : escapeHtml(mark.text.slice(0, 220)));

  target.innerHTML = `
    <div class="asktcard" style="--stripe: var(${colorVar(mark.kind)})">
      <div class="asktmeta">${where}${mark.body === "figure" ? " · figure" : ""}</div>
      <div class="asktbody">${body}</div>
    </div>`;

  renderThread(mark);
}

function renderThread(mark) {
  const thread = $("askThread");
  const turns = mark.thread || [];

  if (!turns.length) {
    thread.innerHTML = `<div class="asknone">No questions asked about this one yet.</div>`;
    return;
  }

  thread.innerHTML = turns.map((turn, index) => `
    <div class="turn">
      <div class="turnq">${escapeHtml(turn.q)}</div>
      <div class="turna">${renderReply(turn.a)}</div>
      ${turn.truncated ? `
        <div class="truncated">
          Cut off at the length limit.
          <button class="continuebtn" data-continue="${index}">Continue</button>
        </div>` : ""}
      ${turn.usage ? `<div class="turnmeta">${turn.usage}</div>` : ""}
    </div>`).join("");

  thread.querySelectorAll("[data-continue]").forEach((el) =>
    el.addEventListener("click", () => continueTurn(mark, Number(el.dataset.continue))));

  thread.querySelectorAll("[data-jump]").forEach((el) =>
    el.addEventListener("click", () => {
      setBoard(false);
      setAskPanel(false);
      goToPage(Number(el.dataset.jump));
    }));

  thread.scrollTop = thread.scrollHeight;
}

/* Render a reply: escape it, then give the two kinds of claim
   their own look — page cites become jumpable, and everything
   flagged [outside the paper] shows in the "mine/ungrounded"
   amber so the boundary survives into the UI. */
function renderReply(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[outside the paper\]([^\n]*)/g,
    `<span class="outside"><span class="outsidetag">outside the paper</span>$1</span>`);
  html = html.replace(/\(p\.\s*(\d+)\)/g,
    `<button class="pcite" data-jump="$1">(p. $1)</button>`);
  return html.replace(/\n/g, "<br>");
}

async function submitQuestion(question) {
  const mark = focusedMark();
  if (!mark) { toast("Click a card first"); return; }
  if (!ai.key) { openAiModal(); return; }
  if (ai.busy) return;
  if (!question.trim()) return;

  if (!state.text.length && mark.page != null) {
    toast("No paper text loaded — open the paper first"); return;
  }

  ai.busy = true;
  $("askSend").disabled = true;
  $("askInput").value = "";

  // show the pending question immediately
  mark.thread = mark.thread || [];
  const pending = { q: question.trim(), a: "…", at: Date.now() };
  mark.thread.push(pending);
  renderThread(mark);

  try {
    const reply = await askAboutMark(mark, question.trim());
    pending.a = reply.text;
    pending.truncated = reply.stop === "max_tokens";
    const u = reply.usage;
    pending.usage = `${u.input_tokens || 0} in · ${u.output_tokens || 0} out` +
      (u.cache_read_input_tokens ? ` · ${u.cache_read_input_tokens} cached` : "");
    saveMarks();
  } catch (err) {
    mark.thread.pop();
    toast("Failed: " + err.message, 5200);
  } finally {
    ai.busy = false;
    $("askSend").disabled = false;
    renderThread(mark);
    if (state.boardOpen) renderBoard();   // refresh thread badges
  }
}

/* Continue a reply that hit the length ceiling. The partial text
   goes back as the assistant's turn, so the model picks up exactly
   where it stopped instead of starting over. */
async function continueTurn(mark, index) {
  const turn = (mark.thread || [])[index];
  if (!turn || ai.busy) return;

  ai.busy = true;
  $("askSend").disabled = true;

  try {
    const content = [paperBlock(mark, turn.q)];
    if (mark.image && mark.image.startsWith("data:image/png")) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: mark.image.split(",")[1] },
      });
    }
    content.push({ type: "text", text: markContext(mark) + `\n\n———\n\nMY QUESTION:\n${turn.q}` });

    const reply = await callModel([
      { role: "user", content },
      { role: "assistant", content: turn.a },
      { role: "user", content: "Continue from exactly where you stopped. Do not repeat anything you already wrote and do not restate the question." },
    ], AI_SYSTEM);

    turn.a = turn.a + (turn.a.endsWith(" ") ? "" : " ") + reply.text;
    turn.truncated = reply.stop === "max_tokens";
    saveMarks();
  } catch (err) {
    toast("Failed: " + err.message, 5200);
  } finally {
    ai.busy = false;
    $("askSend").disabled = false;
    renderThread(mark);
  }
}

$("askSend").addEventListener("click", () => submitQuestion($("askInput").value));
$("askInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitQuestion($("askInput").value);
  }
});

// presets are pre-typed text, not separate code paths
$("askPresets").innerHTML = PRESETS.map((p) =>
  `<button class="preset" data-preset="${p.id}">${p.label}</button>`).join("");
$("askPresets").querySelectorAll("[data-preset]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const preset = PRESETS.find((p) => p.id === btn.dataset.preset);
    $("askInput").value = preset.text;
    $("askInput").focus();
  }));


/* =============================================================
   THE TAKEAWAY — the second prompt, kept deliberately separate
   ============================================================= */

$("btnTakeaway").addEventListener("click", async () => {
  if (!ai.key) { openAiModal(); return; }
  if (!state.marks.length) { toast("Nothing marked yet"); return; }
  if (ai.busy) return;

  ai.busy = true;
  setAskPanel(true);
  $("askTarget").innerHTML = `<div class="asknone">Reading your notes…</div>`;
  $("askThread").innerHTML = "";

  const lines = [];
  orderedMarks().forEach((m, i) => {
    lines.push(`[${i + 1}] ${m.page != null ? "p." + m.page : "my own note"}`);
    if (m.text) lines.push(`    PASSAGE: ${m.text.slice(0, 400)}`);
    lines.push(`    MY NOTE: ${(m.note || "").trim() || "(none written)"}`);
    lines.push("");
  });

  const messages = [{
    role: "user",
    content: [
      paperBlock(null, null),
      { type: "text",
        text: `MY MARKS AND NOTES (${state.marks.length} total):\n\n${lines.join("\n")}` },
    ],
  }];

  try {
    const reply = await callModel(messages, TAKEAWAY_SYSTEM, 5000);
    $("askTarget").innerHTML = `<div class="asktcard"><div class="asktmeta">Takeaway — from your notes only</div></div>`;
    $("askThread").innerHTML = `<div class="turn"><div class="turna">${renderReply(reply.text)}</div></div>`;
  } catch (err) {
    toast("Failed: " + err.message, 5200);
    setAskPanel(false);
  } finally {
    ai.busy = false;
  }
});


$("scopeNear").addEventListener("click", () => setScope("near"));
$("scopeAll").addEventListener("click", () => setScope("all"));

function setScope(scope) {
  ai.scope = scope;
  $("scopeNear").classList.toggle("on", scope === "near");
  $("scopeAll").classList.toggle("on", scope === "all");
  patchAiSettings({ scope });
}

loadAiSettings();
