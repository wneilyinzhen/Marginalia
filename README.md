# Marginalia

A PDF reader for people who want to read the paper themselves.

**[Open it →](https://wneilyinzhen.github.io/Marginalia/)**

---

## Why it works this way

Every AI research tool on the market reads the paper for you and hands you a
summary. This one is built on the opposite premise: the reading is the point,
and a tool that does it for you has taken the valuable part.

So the AI here never summarizes, never volunteers, and never speaks until you
have written down what *you* think the passage means.

---

## What it does

**You read. You highlight.** Six colours, no assigned meanings — you decide what
each one is for, and you can change your mind halfway through. Press `C` and
drag a box to capture a plot or an equation as an image instead.

**Every highlight becomes a note.** It lands in the side panel with an empty
field underneath it: *what I think this means*. You write that yourself. An
empty one is meaningful — it's an open loop, and the tool keeps track of them.

**The notes become a board.** Every mark turns into a card you can drag around a
canvas and arrange however the argument actually fits together. Add cards of
your own for thoughts that belong to no single passage — they're tinted warm and
set in a different typeface, so your thinking never blurs into the article's.
Drag the dot on a card onto another to draw an arrow between them: *relates to,
supports, contradicts, extends.*

**Every card is a conversation.** Select a card, hit **Question**, and ask
anything about that passage. Each card keeps its own thread, so "why?" follows
on from what was just said.

---

## What the AI will and won't do

There are two ways to use it. Connect your own API key for conversations right
inside the reader, next to the passage you're looking at. Or skip the key
entirely and use **Export → Handoff**, which packages your marks, your
interpretations and your questions into one file you can hand to any chatbot.

Whichever you pick, four rules hold. They are the product rather than a
disclaimer.

**It never summarizes the paper.** It has the full text so it can be accurate,
not so it can retell it. It answers the question you asked about the passage you
marked, and nothing else. No overviews, no key takeaways.

**It never blends sources in one sentence.** Every claim is either from the paper
with a page citation, or prefixed `[outside the paper]` with a stated
confidence. Page citations render blue and jump you to the page, so you can
check one in seconds. Outside-the-paper claims render on a warm background — the
same colour as your own notes, because both are things that did not come from
the document. Only you can judge those, and only if you can see which is which.

**It refuses false premises.** If your question assumes something the paper does
not say — a trend in the wrong direction, a mechanism it never invokes — it says
so instead of constructing an explanation. A fluent answer to a wrong assumption
is the worst thing a tool like this can produce.

**You go first.** *Check my reading* stays disabled until you have written
something.

Stepping outside the paper is allowed and expected. Say "outside this paper" and
it answers as a knowledgeable colleague would, labelled once at the top.

---

## Takeaway

A separate button, running a deliberately separate prompt. It summarizes **your
notes** — not the paper — in four parts:

- what you took from this paper, in your own words
- where you landed, mark by mark
- where your interpretation and the paper actually diverge
- what you marked but never interpreted

That last one is the useful one. It's the list of things you meant to come back
to and didn't.

It quotes you rather than paraphrasing you, on purpose: polished paraphrase
makes you feel you understood something better than you did.

---

## Export

One button, three destinations.

**Annotated PDF** — your marks and interpretations in two columns with blank
space under each, for writing on in Notability or GoodNotes on an iPad.

**Markdown** — plain text for Obsidian, grep, or version control. Includes the
arrows you drew. The format most likely to still open in fifteen years.

**Handoff to a chat** — everything as one file: the rules above, your marks,
your interpretations, the links, and every exchange so far. Attach it and the
PDF to claude.ai and carry on there under your subscription instead of paying
per token.

---

## Your papers live in a folder you own

Click **Folder** in the top bar and pick a directory. From then on everything
you do is mirrored there, a few seconds after you stop typing.

```
Papers/
  Thin Film Stress Review/
    paper.pdf          the PDF itself
    notes.json         your marks, interpretations, links, conversations
    text.json          the extracted text
    figures/
      a3f9x2.png       plots and equations you captured
  Surface Acoustic Waves/
    ...
```

Nothing there is locked up. Open `notes.json` in Notepad and you can read your
own interpretations as plain text. The figures are ordinary PNGs. If this
project disappeared tomorrow, your reading would still be sitting on your disk
in formats anything can open.

**Why bother, when the app already remembers things?** Because browser storage
is not a safe place to keep years of work. A routine "clear browsing data" wipes
it without asking. The folder is the durable copy; the browser is a cache of it.

**Moving between computers.** Put the folder in OneDrive, Dropbox, or iCloud.
On the second machine, open Marginalia, click **Folder**, and choose the same
directory. Your whole library appears — papers, notes, board layouts, and past
conversations. Work on either machine and both stay in step.

**You have to do this once per computer, and once per browser profile.** Chrome
will not let a folder permission travel between machines, which is the point of
it being a permission. It takes one click and it's remembered afterwards.

**Chrome or Edge only.** Firefox and Safari haven't shipped the API this uses.
Everything else in Marginalia works everywhere; only the folder doesn't.

---

## Running it

### 1. Just use it

Open **[the link](https://wneilyinzhen.github.io/Marginalia/)** and drop a PDF
on the page. Nothing to install, nothing to sign up for.

### 2. Or keep it on your desktop

In Chrome, look at the **right-hand end of the address bar** for a small icon of
a monitor with a downward arrow. Click it → **Install**.

Marginalia gets its own window, its own icon in the Start menu, and opens
without a browser around it. It works offline too — only the AI needs a
connection.

> No install icon? Reload the page once. Chrome only offers it after the site
> has loaded cleanly.

---

## The AI is optional

Everything above — reading, highlighting, notes, the board, arrows, export —
works with no key and no account.

For the question panel, click **AI** in the top bar and paste your own Anthropic
API key from [console.anthropic.com](https://console.anthropic.com). It's stored
in your browser only and calls go straight from the page to the API.

Cost is small if you leave the context switch on **Nearby**, which sends the
marked page and its neighbours rather than the whole paper — usually a fraction
of a cent per question. A meter under the ask box shows what you've spent.

> A key held in a browser is readable by anyone with access to that computer.
> Fine on your own machine; set a spend limit in the console anyway.

---

## Your data

There is no server, no account, and no analytics. GitHub hosts the files and
sees nothing else — your PDFs are read by your own machine, your notes stay in
your browser and your own folder, and your API key never leaves your computer.

Folder sync needs Chrome or Edge. Everything else works in any modern browser.

---

## Not on the roadmap

Deliberately absent:

- **Auto-summary when you open a paper.** The one feature that would most
  undermine the premise. Every competitor has it.
- **AI suggesting what to highlight.** That makes you an editor of the machine's
  reading.
- **Flashcards generated from the paper.** Fine from your notes. From the source
  text they test whether you remember what a model found important.

---

## Licence

MIT. See [LICENSE](LICENSE).
