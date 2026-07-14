# ASCII Frontier — Enhancement Pass

A focused upgrade to readability, immersion, and depth. All changes stay in the existing single-file engine (`src/game/voidwake.ts`) plus the React wrapper, then re-bundled into the offline HTML.

## 1. Targeting & Situational Awareness (highest impact for readability)

- **Reticle**: a small animated crosshair drawn at screen-center (`-+-` / `| |`) that pulses subtly when weapons are ready and turns red on a valid lock.
- **Targeting brackets**: when the current target is on-screen, draw four corner brackets `[ ]` around its glyph that tighten on acquisition. Color-coded by faction (green friendly / amber neutral / red hostile / cyan station).
- **Edge pointer**: when the target is off-screen, draw a chevron/arrow glyph (`▲ ▼ ◄ ► ◢ ◣ ◤ ◥`) on the nearest viewport edge with a small distance readout (`HOSTILE ◣ 4.2k`).
- **Lead indicator** (small): a `+` showing where to fire to hit a moving target with current bullet speed.

## 2. HUD Legend / Codex

- Press `L` (or menu item "Legend") to open a Codex overlay listing every glyph in `GLYPHS`, every HUD color, and key bindings — generated from the same constants the renderer uses so it can never drift.
- Two tabs: **Symbols** (glyph + name + one-line description) and **Colors** (swatch row + meaning: friendly, neutral, hostile, station, mineable, mission objective, etc.).
- Also reachable from the main ESC menu.

## 3. Quest Tracker

- Persistent top-right panel showing up to 3 active missions: title, objective, progress (e.g. `2/5 ore` or `1.4k to JEDDAH STATION`), and a small directional arrow toward the objective.
- Auto-highlights the active mission's target with a `◇` marker in space and on radar.
- Toggle with `K`. Stored in existing save schema (additive, backward-compatible).

## 4. Additional Hireling Positions

Add three roles alongside the existing Gunner with distinct passive perks and chatter pools:

| Role | Effect | Sample chatter |
|---|---|---|
| **Navigator** | +15% radar range, plots nearest station on demand | "Got a clean line to Jeddah, two clicks port-side." |
| **Engineer** | Slow hull regen while throttle ≤ 25%, faster shield recharge | "Patching the starboard coupler — give me ten seconds." |
| **Quartermaster** | +1 cargo slot, better buy/sell spreads at stations | "I can shave 8% off that ore if you let me haggle." |

Hire/fire from the station menu (`B` → Crew tab). Wages tick down credits per in-game day.

## 5. Vehicle Upgrades

Extend the existing ship system with installable modules (slots already in save format; just add module list and apply step):

- **Engine Tune** — +20% top speed
- **Reinforced Plating** — +25% hull, −5% turn rate
- **Targeting Computer** — auto-leads shots, sharper brackets
- **Mining Laser Mk II** — 2× mining yield, longer range
- **Long-Range Scanner** — doubles target-cycle range, reveals cargo of scanned ships
- **Cargo Expander** — +50% cargo capacity

Bought at stations under a new "Outfitting" tab. Each module shows price, effect, and a one-line tradeoff.

## 6. Animation Pass (cheap, high-impact)

- **Weapon flash**: 2-frame muzzle bloom (`*` → `+`) at the player's nose on fire.
- **Hit sparks**: 3-frame `*`/`x`/`·` burst at impact point.
- **Explosion**: 6-frame expanding ring when a ship/asteroid dies (already partially there — formalize).
- **Engine trail**: throttle-proportional fading `.` trail behind the player (1–4 chars).
- **Shield ripple**: faint hex outline that flashes when shields absorb a hit.
- **Reticle/bracket easing**: brackets snap-in over 4 frames when a new target is acquired.

All driven by a tiny FX queue (`{x,y,glyph,color,ttl}[]`) drained each render — no per-entity allocation churn.

## 7. Sound

- Tiny WebAudio synth (no asset files, keeps the offline bundle self-contained) producing short procedural blips:
  - laser fire (descending square), hit (noise burst), explosion (noise + low pulse), UI click, mission complete (two-tone chime), low-hull alarm (slow pulse), docking confirm.
- Master volume + on/off in Options menu, persisted in save.
- Lazily created on first user interaction (browser autoplay policy).

## 8. Legend/UX polish

- Color swatches in legend use the same CSS color tokens the renderer uses, so dark-mode and offline-mode look identical.
- All new keybinds (`L` legend, `K` quest tracker) shown in the in-game help and the README.

## Technical Notes

- **Single-file discipline**: all engine changes stay in `src/game/voidwake.ts`. New sections appended with clear banners (`// 12. FX Queue`, `// 13. Audio`, `// 14. Codex`).
- **Save compatibility**: new fields (`modules`, `crew`, `audio`, `questsPinned`) are optional; existing saves load and default them.
- **Performance**: FX queue is a fixed-cap ring buffer (max 128 entries); audio nodes are pooled. No new per-frame allocations on the hot path.
- **Offline bundle**: rerun `npm run build:offline` after changes; README in `dist-offline/` updated with the new keybinds and feature list.
- **README**: top-level `src/game/README.md` updated with new sections, keybinds table, and module list.

## Out of Scope (call out so we agree)

- No multiplayer / networking.
- No external audio assets (keeps bundle small and offline-pure).
- No new art pipeline — everything remains ASCII-rendered to canvas.

Approve and I'll implement in one pass, verify the build, and refresh the offline bundle.

---

## 0.3 pass — Patrols, chatter, glitch FX, HUD themes

- **Space Patrol ships** — ✅ 5-7 heavily-armed SPD Patrol ships spawn per
  universe (`kind:"friendly"`, `faction:"patrol"`, hull 140/shield 90). AI
  priorities: engage nearest hostile within 1500u, arrest the player when
  any lawful ship within 1000u has active `hostileUntil` retaliation, and
  tractor-tow the newly-added `stranded` friendly/neutral ships to the
  nearest non-hostile station. ~2% of non-hostile ships spawn stranded.
- **Universal chatter** — ✅ New `patrol` chatter kind plus ambient picker
  now skips any faction starting with `alien` (UFOs, thargoids, motherships,
  swarms) so those stay wordless. Stranded ships also suppress ambient
  lines. Bases, planets, and every non-alien ship type speak.
- **Screen glitch** — ✅ New render pass draws horizontal band-shifts and
  a chroma tick when hull damage or a non-dormant thargoid is within
  2000u / EMP is active. Respects reduced-motion and `Options ▸ Gameplay
  ▸ Glitch FX`.
- **Scanlines toggle** — ✅ Optional even-row darkening overlay.
- **HUD color scheme** — ✅ 5 themes (green / amber / cyan / white / red).
  Applied as a low-alpha multiply pass so every HUD element retints in
  one draw call.
- **Reticle color + shape** — ✅ 6 colors × 5 shapes (cross / dot /
  brackets / circle / diamond). Combat feedback (amber = aligned, red =
  in-range) still overrides the base tint so lock cues stay readable.
- **VERSION bump** — ✅ 0.2.0 → 0.3.0 and offline bundle rebuilt.

## Backlog / To-Do (0.3 leftovers)

- Per-element HUD retinting (currently a single multiply overlay tints
  everything at once; a proper theme would recolor `#7CFC00` headers,
  target brackets, and status bars individually).
- Distinct patrol ship silhouettes (they still render as generic green
  friendlies; a cyan tint + unique 3x3 sprite would sell the "police
  cruiser" read).
- Patrol comms when actually towing / arresting — right now those are
  ambient patrol lines, not event-triggered lines keyed to the action.
- Options for scanline density / glitch intensity — currently both are
  fixed to conservative defaults.
- Stranded ships should broadcast a "mayday" chatter line while waiting
  for a tow.

