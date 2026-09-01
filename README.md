# Marginalia

A PDF reader for people who want to read the paper themselves.

You open a paper, highlight as you go, and write what you think each passage
means. Only then can you ask the AI about it — and the AI is forbidden from
summarizing the paper, volunteering takeaways, or blending what the document
says with what it happens to know.

**[Open it →](https://wneilyinzhen.github.io/Marginalia/)**

---

## Why it works this way

Every AI research tool on the market reads the paper for you and hands you a
summary. This one is built on the opposite premise: the reading is the point,
and a tool that does it for you has taken the valuable part.

Four rules the AI operates under, and they are the product:

**It never summarizes.** It has the full text so it can be accurate, not so it
can retell the paper. It answers the question you asked about the passage you
marked, and nothing else.

**Sources never blend.** Every claim is either from the paper with a page
citation, or prefixed `[outside the paper]` with a stated confidence. Never
mixed in one sentence. You can verify the first kind in seconds; only you can
judge the second kind, and only if you can see which is which. Page citations
render blue and clickable; outside-the-paper spans render on the same warm
background as your own notes, because both are things that did not come from
the document.

**False premises get refused.** If your question assumes something the paper
does not say — a trend in the wrong direction, a mechanism it never invokes —
it says so instead of constructing an explanation. A fluent answer to a wrong
assumption is the worst thing a tool like this can produce.

**You go first.** *Check my reading* stays disabled until you have written
something. The tool is built around your thinking, not as a replacement for it.

---

## What it does

**Read.** Continuous scroll, zoom, remembers your page per paper. Pages render
only near the viewport, so a 49-page review doesn't hold a quarter gigabyte of
bitmaps.

**Mark.** Select text to highlight in one of six colours. The colours have no
assigned meanings — you decide, and you can change your mind mid-paper.

**Capture.** Press `C` and drag a box around a plot or an equation. PDF maths
fonts often carry no character mapping, so equations extract as junk like
`EdepeVðÞ ¼ETaþUb`. When that's detected the region is kept as an image
instead, and the image goes to the model so it can read the equation off the
page the way you do.

**Interpret.** Every mark gets a note field. An empty note is meaningful — it's
an open loop, and the takeaway function lists them back to you.

**Board.** Marks become cards you arrange spatially. Add free-standing notes of
your own — they're tinted warm and set in a different typeface, on screen and
on paper, so your thinking never blurs into the article's. Drag the dot on a
card onto another to link them: *relates to, supports, contradicts, extends*.

**Ask.** Select a card, hit **Question**. Free-form, with presets that are just
pre-typed editable text. Each mark carries its own thread.

**Take away.** A second, deliberately separate prompt that summarizes *your
notes*, not the paper — in your own words, with a section for where your
interpretation diverges from the source and a section for what you marked but
never interpreted.

**Search.** `Ctrl+F` searches the open paper and every mark and note across your
whole library at once.

**Keep.** Papers organise into subjects. Everything syncs to a real folder on
disk, one directory per paper, with `notes.json` you can read in any text editor
and figures as ordinary PNGs.

**Export.** The board as a PDF laid out for annotating on an iPad. Notes as
Markdown. And a **handoff** file that carries your whole reading — rules, marks,
interpretations, links, and every exchange — into a claude.ai conversation, so
you can keep going without spending API tokens.

---

## Running it

**Just use it:** open the link above. Nothing to install.

**Install it as an app:** in Chrome, the install icon in the address bar. It
gets its own window and works offline apart from the AI.

**Run it yourself:**

```bash
git clone https://github.com/wneilyinzhen/marginalia.git
cd marginalia
python -m http.server 8000
```

Then open `http://localhost:8000`. There is no build step and no dependencies
to install — it's HTML, CSS, and plain JavaScript.

> Opening `index.html` directly by double-clicking will **not** work. Chrome
> treats `file://` pages as unique origins and blocks the PDF worker. It has to
> be served over `http://` or `https://`.

**Requires Chrome or Edge.** Firefox and Safari have not shipped the File
System Access API, so folder sync won't work there. Everything else will.

---

## Your data

Nothing is uploaded anywhere. There is no server, no account, and no analytics.

PDFs and notes live in your browser's IndexedDB, and mirror to a folder you
choose. Put that folder in OneDrive or Dropbox and your library follows you
between machines.

The AI is optional and uses **your own** Anthropic API key, entered once and
stored in your browser only. Calls go directly from the page to
`api.anthropic.com` — nothing passes through any intermediary. The key is
deliberately **never written to the sync folder**: notes belong in Dropbox,
credentials do not.

> A key held in a browser is readable by anyone with access to that machine and
> its developer tools. Fine for your own laptop. Don't do it on a shared one,
> and set a spend limit on the key in the Anthropic console.

You have to connect the folder once per machine and per browser profile. That
permission cannot be copied — a directory grant that travelled between
computers wouldn't be a security boundary.

---

## Keyboard

| | |
|---|---|
| `1`–`6` | pick a highlight colour |
| `C` | capture mode, for figures and equations |
| `N` | notes panel |
| `B` | board |
| `L` | library |
| `Ctrl+F` | search |
| `Ctrl+Z` | undo |
| `+` `-` `0` | zoom in, out, fit |
| `↑` `↓` | previous, next page |
| `Esc` | back out of whatever is open |

---

## How it's built

No framework, no bundler, no dependencies except PDF.js from a CDN. Files load
in order and share one global scope.

| | |
|---|---|
| `store.js` | state, IndexedDB, subjects, undo |
| `viewer.js` | rendering, scrolling, selection, capture |
| `notes.js` | the side list, board, library, keyboard |
| `links.js` | arrows between cards |
| `search.js` | in-paper and cross-library search |
| `folder.js` | File System Access sync |
| `export.js` | board to PDF, notes to Markdown |
| `ai.js` | the companion, its prompts, the key |
| `handoff.js` | export a whole session for claude.ai |

The prompts in `ai.js` and `handoff.js` are the part worth reading. They're
where the four rules above actually live.

---

## Cost, if you use the AI

Sending a 49-page review costs about 70,000 input tokens per question. Two
things keep that down:

**Nearby mode** (the default) sends the marked page, its neighbours, and any
page matching a distinctive word from your question — roughly 3k tokens instead
of 70k. The model is told it's seeing only part of the paper and to say so
rather than guess.

**Whole mode** sends everything, marked cacheable. Full price once, about a
tenth for every question after within the cache window. Use it when the answer
depends on the rest of the argument.

A meter under the ask box shows calls, estimated spend, and how much came from
cache.

---

## Not on the roadmap

Some things are absent on purpose:

- **Auto-summary on open.** The one feature that would most undermine the
  premise. Every competitor has it.
- **AI suggesting what to highlight.** That makes you an editor of the
  machine's reading.
- **Flashcards generated from the paper.** Fine from your notes. From the
  source text they test whether you remember what a model found important.

---

## Licence

MIT. See [LICENSE](LICENSE).
