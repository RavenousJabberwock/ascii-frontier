# VOIDWAKE — ASCII Space Sim

A fully playable ASCII-rendered space simulation inspired by Elite Dangerous.
Rendered to an HTML5 `<canvas>` using a monospaced glyph grid.

## Architecture

The engine is a single class `Voidwake` defined in `voidwake.ts`. It is
organized into clearly labeled sections so you can extend it without
hunting around:

```
voidwake.ts
├─ RNG                  seeded PRNG (mulberry32)
├─ Types                interfaces for entities, player, ship, options
├─ Universe             procedural generation of stars/planets/asteroids/stations/ships
├─ AI                   simple state machines (friendly/neutral/hostile/station)
├─ Player Systems       combat, mining, trading, missions, progression
├─ Input                keyboard handling
├─ Menu                 ESC menu, character creation, ship customization, options
├─ Save / Load          unencrypted JSON via localStorage + download/upload
├─ Render               ASCII grid renderer + cockpit HUD + 3D radar
└─ Loop                 fixed-timestep update + render
```

The React wrapper `src/components/VoidwakeGame.tsx` only mounts the canvas
and forwards lifecycle events.

## How to play

- `W/S` throttle up/down
- `A/D` yaw left/right
- `Q/E` pitch up/down
- `Space` fire weapons
- `M` mine targeted asteroid
- `T` cycle target
- `F` dock with targeted station (must be close & slow)
- `B` buy/sell menu at station
- `J` accept mission at station
- `[` / `]` cycle target by category (stations / rocks / hostiles / ...)
- `G` toggle hired gunner AUTO / STANDBY
- `O` toggle hired **Pilot autopilot** to current target (full auto: fly, auto-dock stations, hold orbit). Mouse steering is suppressed while engaged and does **not** disengage it — press `O` again to take back manual control. A blinking banner near screen center reminds you it's on.
- `U` open Quest Log popup
- `K` pin / unpin quest tracker
- `L` open Codex (symbols / colors / keys)
- `P` pause
- `ESC` main menu (New / Save / Load / Options / Quit)

## Universe

The play area is a cube roughly 36k units across (radius 18k). Anything past
5k from your ship renders as a single colored period; past 10k it's culled
entirely — so the deep sky is a moving field of pinpricks that only resolve
into stars, planets, stations, and traffic as you cruise toward them.

Stars are drawn by spectral class — blue supergiants, red giants, sun-like
yellows, orange dwarves, red dwarves, white dwarves — each with a matching
color, size, and halo. Planets pull from a broader palette (oceans, deserts,
gas giants, ice worlds, molten worlds, storm giants). Nebulae come in eight
color families (violet, rose, green, blue, amber, cyan, crimson, lilac),
render with irregular noise-driven outlines, drain shields, and garble the
COMMS panel while you're inside one.

Weapon shots, engine exhausts, comets, and distant suns all glow.

## Radio

Options ▸ Radio picks the in-game music source:

- **Off** — no music.
- **Chiptune • Drift / Frontier / Arcade Runner / Nebula Cradle** —
  procedurally generated 8-bit tunes; no assets, works offline.
- **SomaFM • Deep Space One / Space Station / Mission Control / DEF CON** —
  free space-themed internet streams.
- **Custom URL** — plug in your own stream (`Options ▸ Radio URL`, press
  ENTER to enter one).

Music volume is the existing `Music Volume` slider; changes take effect
immediately.

## Adding new content

- **New ship hull**: append to `SHIP_HULLS` in `voidwake.ts`.
- **New species**: append to `SPECIES` array.
- **New mission type**: extend the `MissionKind` union and handle in
  `generateMission()` and `tickMissions()`.
- **New entity type**: extend `EntityKind`, add a generator in the
  Universe section, an AI handler in the AI section, and a glyph in
  `GLYPHS`.

## Save format

Saves are plain JSON. They live in `localStorage` under
`voidwake.save.<slot>` and can also be exported/imported as `.json`
files from the menu. No encryption, no obfuscation — open them in any
text editor.
