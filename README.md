# ASCII FRONTIER — ASCII Space Simulation

A fully playable, browser-based ASCII space sim inspired by Elite Dangerous.
Pilot a procedurally-generated starship through a procedural universe: trade
cargo between stations, mine asteroids, fight raiders, accept missions, and
level up — all rendered as glyphs on an HTML5 `<canvas>`.

Built with [TanStack Start](https://tanstack.com/start) + React 19 + Vite 7
and styled with Tailwind v4.

Play it live at https://ascii-frontier.lovable.app/

Q: Wait, why isn't it on github.lo like the rest of your stuff?

A: This is a TanStack Start app, which is built for SSR (server-side rendering) and serverless functions. GitHub Pages only serves static files — it can't run the server code that TanStack Start needs. So a standard github.io deploy won't work without restructuring the build.

---

## Quick start

```bash
bun install        # or: npm install
bun run dev        # start the dev server
bun run build      # production build
bun run preview    # preview the production build
bun run lint       # eslint
bun run format     # prettier
```

Open the URL printed by Vite (typically `http://localhost:5173`) and click
the canvas to give it focus before pressing keys.

> Requirements: [Bun](https://bun.sh) ≥ 1.1 (recommended) or Node ≥ 20.

---

## Controls

| Key       | Action                                               |
| --------- | ---------------------------------------------------- |
| `W` / `S` | Throttle up / down                                   |
| `A` / `D` | Yaw left / right                                     |
| `Q` / `E` | Pitch up / down                                      |
| `Space`   | Fire selected weapon                                 |
| `T`       | Cycle target                                         |
| `M`       | Mine targeted asteroid                               |
| `F`       | Dock with targeted station (must be close and slow)  |
| `B`       | Buy / sell menu at station                           |
| `J`       | Accept mission at station                            |
| `ESC`     | Main menu (New / Save / Load / Options / Quit)       |

Mouse-steer can be toggled in **Options**. A control reminder is rendered in
the lower-right HUD pane.

---

## Project structure

```
src/
├─ components/
│  ├─ VoidwakeGame.tsx   Thin React wrapper that mounts the engine on a <canvas>
│  └─ ui/                shadcn/ui primitives (unused by the sim but available)
├─ game/
│  ├─ voidwake.ts        The entire game engine — see in-file section banners
│  └─ README.md          Engine-internals guide and extension recipes
├─ routes/
│  ├─ __root.tsx         Root layout, head tags, error/not-found boundaries
│  └─ index.tsx          Home route — mounts <VoidwakeGame />
├─ hooks/                React hooks (UI utilities)
├─ lib/                  Generic utilities
├─ router.tsx            TanStack Router bootstrap
├─ server.ts             SSR entry
├─ start.ts              Global middleware registration
└─ styles.css            Tailwind v4 entry + theme tokens
```

The game engine is intentionally **one self-contained file** (`src/game/voidwake.ts`)
so it stays portable and easy to read top-to-bottom. It is divided into
clearly labeled sections:

```
1. RNG                seeded mulberry32 (reproducible universes)
2. Constants/Glyphs   tunables, glyph table, ship/weapon catalogs
3. Types              entities, player, ship, options
4. Universe           procedural star/planet/asteroid/station/ship generation
5. AI                 friendly / neutral / hostile / station state machines
6. Player systems     combat, mining, trading, missions, progression
7. Input              keyboard + optional mouse-steer
8. Menus              main, character creation, ship customization, options
9. Save / Load        unencrypted JSON in localStorage + import/export
10. Renderer          ASCII grid, cockpit HUD, 3D radar, starfield layers
11. Main loop         fixed-timestep update + render
```

See [`src/game/README.md`](src/game/README.md) for extension recipes.

---

## Adding content

| Want to add…          | Where                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| New ship hull         | Append to `SHIP_HULLS` in `voidwake.ts`                                  |
| New species           | Append to `SPECIES`                                                      |
| New weapon            | Append to `WEAPONS`                                                      |
| New entity kind       | Extend `EntityKind`, add generator + AI handler + entry in `GLYPHS`      |
| New mission type      | Extend `MissionKind`, handle in `generateMission()` and `tickMissions()` |
| New HUD element       | Add a draw call in the Renderer section's `renderPlaying()`              |

---

## Save format

Saves are plain JSON. They live in `localStorage` under
`voidwake.save.<slot>` and can be exported / imported as `.json` files from
the in-game menu. No encryption — open them in any text editor.

The save shape is versioned (`VERSION` constant). When you make a
backwards-incompatible change, bump `VERSION` and add a migration step in
the Save/Load section.

---

## Engineering notes

- **TanStack Start** uses file-based routing under `src/routes/`. Do not
  edit `src/routeTree.gen.ts` — it is regenerated by the Vite plugin.
- The root layout file is **always** `src/routes/__root.tsx`. The `<Outlet />`
  it renders must remain in place or child routes will render blank.
- The game is client-only. The engine reads `window`, `document`, and
  `localStorage`, so it must not run during SSR. `VoidwakeGame.tsx` ensures
  this by constructing `Voidwake` inside a `useEffect`.
- Tailwind v4 is configured via `src/styles.css` (`@import "tailwindcss"`
  + `@theme`). There is no `tailwind.config.js`.
- The engine deliberately avoids external game-engine dependencies. Keep
  it that way — it should remain ≤ a few thousand lines of TypeScript.

---

## Built with Lovable

This project is developed on [Lovable](https://lovable.dev). Edits in
Lovable auto-push to GitHub; pushes to GitHub auto-sync back into Lovable.

To work locally:

```bash
git clone https://github.com/RavenousJabberwock/ascii-frontier/
cd ascii-frontier
bun install
bun run dev
```

Any commit you push to the default branch will appear in Lovable within
seconds.

---

## Playing offline

A fully self-contained offline build is included in the repository and can be
regenerated at any time:

```bash
bun run build:offline
```

This produces `dist-offline/ascii-frontier-offline.html` — a single HTML file
with no server, no build step, and no internet required. Open it directly in
any modern browser to play.

> **Tip:** Some browsers block `localStorage` when opening a file from disk,
> which prevents saves from persisting. If that happens, serve the file
> locally:
>
> ```bash
> python3 -m http.server 8000
> ```
>
> Then visit `http://localhost:8000/dist-offline/ascii-frontier-offline.html`.

---

## License

MIT — do what you want; attribution appreciated.
