# Publishing this to GitHub

Ten minutes, no build step, free hosting. Delete this file afterwards if you like.

## Before anything else: check for secrets

Your Anthropic key must not end up in the repository. It never lives in these
files — it's in your browser — but the Python prototype folder has a `.env`.

Search the folder for `sk-ant` before you commit. If it appears anywhere, remove
it. A key pushed to a public repo is scraped within minutes; assume it is burned
and rotate it in the console.

`.gitignore` already excludes `.env`, `.venv/`, `*.pdf`, and your library
folders, so your papers and notes stay yours.

## 1. Make the repository

On github.com: **New repository** → name it `marginalia` → **Public** → don't
add a README, licence, or .gitignore, since this folder already has them.

## 2. Push

In the app folder:

```bash
git init
git add .
git commit -m "Marginalia: a reader for people who read the paper themselves"
git branch -M main
git remote add origin https://github.com/YOURNAME/marginalia.git
git push -u origin main
```

Check what you're about to send first:

```bash
git status
```

If anything private appears in that list, stop and fix `.gitignore` before
committing. Removing a secret from history afterwards is much harder than not
committing it.

## 3. Turn on Pages

Repository → **Settings** → **Pages** → Source: *Deploy from a branch* →
Branch: `main`, folder: `/ (root)` → Save.

A minute later it's live at:

```
https://YOURNAME.github.io/marginalia/
```

Put that URL at the top of `README.md`, replacing the placeholder, and add it to
the repo's **About** panel.

## 4. Check it works

Open the URL and confirm all four:

- A PDF renders when you drop one in
- **Folder** opens a directory picker — needs HTTPS, which Pages provides
- Chrome shows an install icon in the address bar
- **AI** accepts a key and the test says `connected`

## 5. Updating

```bash
git add .
git commit -m "what changed"
git push
```

Live in about a minute.

**One thing to remember:** if you change any app file, bump `CACHE_VERSION` in
`sw.js` — `marginalia-v1` → `marginalia-v2`. Otherwise the service worker keeps
serving the old version and you'll think your change didn't work.

## Moving your existing notes over

Your library is stored per origin, so notes made on `localhost:8000` won't
appear on `github.io`. The folder is the bridge:

1. On `localhost:8000`, click **Folder** and let it finish syncing.
2. Open the new Pages URL.
3. Click **Folder**, pick the same directory.
4. Everything imports.

Same procedure on any new machine.

## Two things worth deciding before you share it

**The key warning belongs in the README, and it's there.** Anyone using this
puts their own API key in their own browser. That's the right design — no server
means no one else can see it — but a key in a browser is readable by anyone with
that machine and devtools. Tell people to set a spend limit.

**Chrome and Edge only** for folder sync. Firefox and Safari haven't shipped the
File System Access API. Everything else works everywhere, so it degrades rather
than breaks, but say so up front rather than letting people find out.
