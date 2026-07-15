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

## 0.4 pass — Comms panel

- **Top-left Comms panel** — ✅ Replaced the 4-line bottom comms strip with
  a 12-row scrolling panel anchored to the top-left of the viewport.
- **Tabs** — ✅ `All`, `Crew`, `Ext`. `\` cycles the tab; PgUp/PgDn scroll;
  Home jumps to newest. Filter routes lines by `ChatterLine.channel`, which
  `pushChatter` infers from the speaker label (`Gunner …`, `Pilot …`, bare
  `Crew` → crew; `Sensors`/`Radio` → system; everything else → external).
- **Inter-NPC banter** — ✅ New `tickNpcBanter` scheduler picks two nearby
  non-alien speakers (ships or stations, hostile ↔ friendly and station ↔
  ship preferred) and posts a short two-line exchange into the external
  channel. Hostile taunts, friendly cover fire, and station chatter now
  read like a lived-in sector.
- **VERSION bump** — ✅ 0.3.0 → 0.4.0 and offline bundle rebuilt.

### Backlog (0.4 leftovers)

- Persist the last N comms lines in the save file (currently transient).
- Mouse wheel scroll + click-to-select tabs on the panel.
- A "System" tab for `Sensors`/`Radio` if the current 3-tab surface starts
  to feel noisy in practice.

## 0.5 pass — Ship computer, adjustable comms, sun/nebula variety, wreck salvage

- **Ship Computer voice** — ✅ New `Computer` speaker prefix routes to the
  crew channel via `CREW_BARE_LABELS`. Any crew-labeled chatter that fires
  when the position is unfilled now falls back to `Computer` (currently the
  engineer scoop line and the wormhole-slip line).
- **Guard unassigned-position chatter** — ✅ The two unguarded callsites
  ("Engineer scooping corona", "Navigator reality fold") now check
  `hasCrew()` and defer to `Computer` when no one is on-station. All other
  Gunner/Pilot chatter was already correctly gated by `if (p.gunner) …` /
  `if (pilot) …` blocks.
- **Adjustable Comms window** — ✅ `Options ▸ Gameplay` now has three new
  rows: `Comms Width` (28–120 cols, step 2), `Comms Height` (4–30 rows),
  and `Comms Word Wrap` (on/off). The renderer wraps on word boundaries
  when enabled and scrolls in rendered lines instead of raw messages so
  wrapped multi-line entries scroll intuitively.
- **Sun size variability** — ✅ New `starSizeMul(e)` combines
  `stellarClassOf(e).sizeMul` with a per-star deterministic jitter
  (~0.55×–1.75×). Applied to render world radius AND to corona
  scoop/burn ring math, so a few G-class Sol analogs are genuinely huge
  and some M-dwarfs look like pinpricks even up close.
- **Bigger, farther-visible nebulae** — ✅ `WORLD.nebulaRadius`
  27000 → 40000, `WORLD.nebulae` 88 → 140, `worldRadius.nebula`
  240 → 420, and nebulae are now exempted from `FAR_CULL` so their
  glow bleeds through at long range. Objects (stars, ships, stations,
  planets) already spawn independently across similar radii, so any
  entity can occupy a nebula's volume incidentally — nebulae layer over
  them in the renderer instead of displacing them.
- **Wreckage neutralization** — ✅ Ship/station destruction now clears
  `faction` → `"nature"`, `hostileUntil`, `weaponId`, and `state`, so a
  destroyed hostile can never keep firing, get chased, or read as a
  target of any faction. Wrecks also carry a small ore payload (1–3, +2
  for former stations) so a player who mines the corpse gets a small
  scrap tip.
- **Wormhole stations** — ✅ 5% of wormhole pairs spawn a Federation
  "Gate" station orbiting one mouth; ~30% of those also spawn a partner
  station at the other mouth. Both use the standard station AI/dock
  path so they're immediately usable.
- **VERSION bump** — ✅ 0.4.0 → 0.5.0 and offline bundle rebuilt.

### Backlog (0.5 deferred — please implement in a later pass)

Items from the 0.5 ask that did NOT land this pass. All are additive and
save-safe; the code refs are pointers for the next agent.

- **Dedicated "Chat Windows" submenu** — currently the three comms
  controls sit inline in the Gameplay list. A nested submenu would need
  a new `optionsSection = "comms"` state and its own `render/update`
  pair (mirroring `updateOptionsKeybinds`).
- **Populated planets + planet trade** — plumb a `populated: boolean`
  flag onto ~5–15% of `kind:"planet"` entities, wire them into `tryDock`
  (currently `dockR = 120` for stars only; planets need a similar orbit
  handshake), open a lightweight trade screen (reuse `renderStation`
  scaffolding), and add planet chatter lines so the player can
  eavesdrop to find which planets are inhabited.
- **Ship-shaped wreckage sprites** — wrecks currently reuse the
  `asteroid` glyph. Add a `debris` render branch that draws a small
  irregular cluster (e.g. `╱`, `╲`, `¦`, `·`) with a periodic
  `*`/`+` spark to sell the "burning parts of a ship" read.
- **Roche-limit irregular shapes** — under a certain distance from a
  planet, small bodies (asteroid/comet/meteor) should render with an
  irregular per-frame edge. Cheapest path: add a small hash-driven
  `roughness` factor in the asteroid render branch that's boosted when
  the nearest planet is within `2 × planetRadius`.
- **New crew roles**:
    - **Quartermaster** — 10% discount on modules/weapons, +2 cargo slots.
      Distinct from `merchant`; add as a new `CrewRole`.
    - **Recruiter** — reduces `CREW_ROLE_INFO[*].baseFee` at hire and
      slows morale decay (introduce a `morale` field on `CrewMember`).
    - **Navigator** — −10% fuel burn (stacks with Engineer), +25% radar
      range, and adds `wormhole` / mission target / `star` (BH) to the
      T-cycle target set.
    - **Tactical Officer** — can fire the main weapon (mutually
      exclusive with `Gunner`), +15% crit chance, +25% shield recharge.
      Enforce the exclusivity in hire menu.
  Each new role also needs `chatter.ts` template entries (`quartermaster_idle`,
  `recruiter_idle`, `navigator_idle`, `tactical_idle`) and a color in
  `CREW_ROLE_INFO`.
- **Persist comms history in saves** — Save/Load section currently
  discards `this.chatter`.
- **Lua scripting hooks** — ✅ landed in 0.5.1 as no-op dispatchers
  (`dispatchHook` / `registerScriptHook`) at every attach point below.
  See `src/game/README.md ▸ Scripting hooks`. Runtime wiring (fengari-web
  or WASM Lua 5.3) is the next milestone.

## 0.5.1 pass — Lua hook surface reservation

- **Hook module** — ✅ Added near the top of `src/game/voidwake.ts`.
  Exports `registerScriptHook`, `unregisterScriptHook`, `clearScriptHooks`,
  and the `ScriptHookName` union. All hook lists are process-global and
  survive New Game / Load cycles. Handlers run synchronously; a throwing
  handler is caught and logged, never blocks a tick. Hot-path guard
  (early-return when the hook list is empty) keeps the `onTick`
  dispatcher free at zero cost.
- **Callsite coverage** — ✅ `dispatchHook` invocations added at:
  end of `generateUniverse` (`onWorldGenerate`), top of `updatePlaying`
  post-pause (`onTick`), pilot fire path (`onPlayerFire`), both
  `tryDock` success branches (`onPlayerDock`, `kind`: `station` |
  `ship-trade`), the debris conversion block (`onEntityDestroyed`, with
  `byPlayer` sourced from the existing `playerShot` flag), end of
  `pushChatter` (`onChatter`), both save paths (autosave + manual)
  (`onSave`), and the load path (`onLoad`).
- **Browser bridge** — ✅ `window.ASCIIFrontier = { registerScriptHook,
  unregisterScriptHook, clearScriptHooks, VERSION }` for the future
  Lua-host bootstrapper (and for devtools-console tinkering today).
- **Options placeholder** — ✅ New `Options` root row **Scripting
  (soon)** renders greyed out; `renderListMenu` gained an optional
  `disabled` argument that dims a row and skips its ENTER handler. A
  future pass replaces the placeholder with a real subsection
  (load/reload script, enable/disable per hook, sandbox toggles).
- **VERSION bump** — ✅ 0.5.0 → 0.5.1 and offline bundle rebuilt.

## 0.5.2 pass — Wreckage sprites + comms persistence

- **Ship-shaped wreckage sprites** — ✅ Added `DEBRIS_FILLS`,
  `DEBRIS_TEX`, and an `isWreck(e)` helper. `fillsFor` and
  `surfaceChar` branch on wreck vs. rock; the close-body fill glyph
  switches from `%` to `¦`; a time-bucketed spark override drops
  bright `*` / `+` characters onto ~6% of wreck cells per ~140ms
  tick. Wrecks now read as "burning parts of a ship" rather than
  another asteroid, with zero change to salvage payout or AI.
- **Persist comms history in saves** — ✅ `SaveBlob.chatter?`
  (`ChatterLine[]`, capped at 250) added. Autosave + manual save
  both populate it; Load restores `this.chatter` with an
  `Array.isArray` guard so older saves without the field still load
  cleanly (backfilled to `[]`).
- **VERSION bump** — ✅ 0.5.1 → 0.5.2 and offline bundle rebuilt.

### Recommended next round (still 0.5.x)

Ranked by ROI for the current codebase. All additive and save-safe.

1. **Populated planets + planet trade** — plumb a `populated: boolean`
   flag onto ~5–15% of `kind:"planet"` entities, add a planet branch
   in `tryDock` (currently `dockR=120` for stars only), open a trimmed
   station-style trade screen, and add planet chatter so players can
   eavesdrop to find inhabited worlds.
2. **New crew roles (Quartermaster / Recruiter / Navigator /
   Tactical)** — extends `CrewRole`, `CREW_ROLE_INFO`, chatter
   templates, plus a hire-menu exclusivity check for Gunner ↔
   Tactical.
3. **Lua host wiring (fengari-web)** — hook surface is ready
   (0.5.1); this round drops in the WASM Lua 5.3 runtime, replaces
   the greyed Options ▸ Scripting placeholder with load / reload /
   edit / enable-per-hook / sandbox controls, and reads scripts from
   localStorage.
4. **Roche-limit irregular shapes for small bodies** — cheap render
   tweak in the asteroid branch; boost per-cell edge roughness when
   the nearest planet is within `2 × planetRadius`. Piggy-backs
   nicely on the 0.5.2 wreckage work.



