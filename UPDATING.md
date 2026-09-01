# Updating the app

One rule: **change a file, bump the version string.**

## Every time you change any `.js` or `.css` file

Open `index.html` and find the version at the end of every script and
stylesheet link:

```html
<link rel="stylesheet" href="style.css?v=20260901a">
<script src="store.js?v=20260901a"></script>
```

Change every `?v=20260901a` to something new — the date works, add a letter if
you change something twice in a day:

```
?v=20260901b
```

Find and replace does all of them at once.

Then commit and push as usual.

## Why this works

Browsers cache aggressively and correctly — a file at the same URL is assumed
to be the same file. `style.css` and `style.css?v=20260901b` are different URLs,
so nothing anywhere can hand back the old one. Not the browser cache, not the
service worker, not GitHub's CDN.

Without it you get the worst kind of failure: the new HTML loads with the old
JavaScript, no error appears, and a button silently does nothing.

## Checking which version is live

Open the console (F12). Every load prints:

```
Marginalia build 2026-09-01a — all controls wired
```

If that line is missing, or says **missing elements**, you are running mixed
versions. Bump the query string, push, and reload.

## If it's still stale

1. `Ctrl+Shift+R` — hard reload.
2. F12 → **Application** → **Service Workers** → **Unregister** → reload.
3. F12 → **Application** → **Storage** → **Clear site data**. This also wipes
   your notes for that URL, so reconnect the Folder afterwards to get them back.
4. Check github.com that the file actually changed — open it in the repo and
   look at the code, not just the commit list.
5. Check the **Actions** tab. A yellow dot means Pages is still building; give
   it a minute. Red means the deploy failed.

## Sanity check straight from the server

Open the file directly with a nonsense query, which no cache can have seen:

```
https://wneilyinzhen.github.io/Marginalia/export.js?x=1
```

If the code there is current, GitHub has the right file and any problem is
local caching. If it isn't, the push never landed.
