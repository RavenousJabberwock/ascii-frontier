# ASCII Frontier — Offline Build

A single, self-contained HTML file containing the entire game engine. No
server, no installer, no internet connection required after download.

## Building it

From the project root:

```bash
npm run build:offline
```

This bundles `src/game/voidwake.ts` (minified) and inlines it into
`dist-offline/ascii-frontier-offline.html`. Re-run the script any time the
engine changes to refresh the offline copy.

## Running it

Double-click `ascii-frontier-offline.html`, or open it in any modern
desktop browser (Chrome, Firefox, Safari, Edge). The game grabs keyboard
focus automatically.

You can also drop the file onto a USB stick, email it to yourself, or host
it on any plain static file server — it has zero dependencies.

Want to just click a link? It's here: https://ravenousjabberwock.github.io/ascii-frontier/

## Pros

- **Truly offline.** No fetches, no CDN, no analytics. Works on a plane,
  in a faraday cage, or on an air-gapped machine.
- **Single file.** ~140 KB of HTML. Easy to archive, share, or sideload.
- **No install.** No Node, no `npm install`, no build tools needed to play.
- **Portable.** Same file runs on Windows, macOS, Linux, ChromeOS, even
  many tablets, as long as the browser supports ES2020 + `<canvas>`.
- **Stable.** Once you have a copy, it can't break from a bad deploy or
  a stale service worker — the bytes on disk are the bytes that run.
- **Save data still works** via `localStorage`, scoped to the file's
  origin in your browser.

## Cons / caveats

- **Frozen at build time.** New features, balance tweaks, and bug fixes
  in the live web build do **not** reach the offline file until you
  rebuild it. Treat it like a snapshot.
- **Save data is browser-scoped.** Progress saved while running the
  offline file lives in *that browser's* storage for the local file
  origin. It does not sync to the hosted version at
  `ascii-frontier.lovable.app`, and clearing site data wipes it.
- **Some browsers sandbox `file://` storage.** Firefox and Safari may
  treat each opened HTML file as a separate origin or restrict
  `localStorage` under `file://`. If saves don't persist, serve the file
  through a tiny local server (`python3 -m http.server` in the folder)
  and open `http://localhost:8000/ascii-frontier-offline.html` instead.
- **No automatic updates.** There's no "check for new version" — you
  have to re-download or re-build.
- **No multiplayer / cloud features.** Anything that would require a
  backend simply doesn't exist in this build (today the game is
  single-player, so this is mostly future-proofing).
- **Larger than a URL.** Sharing the live URL is lighter weight if the
  other person has internet.

## When to use which

| You want to…                                  | Use                                     |
| --------------------------------------------- | --------------------------------------- |
| Show a friend quickly                         | The hosted URL                          |
| Play on a flight / no Wi-Fi                   | The offline HTML                        |
| Always get the newest version                 | The hosted URL                          |
| Archive a specific version of the game       | The offline HTML                        |
| Run on a locked-down / air-gapped machine    | The offline HTML                        |
