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

## 0.5.3 pass — Populated planets + colony trade

- **Colonies** — ✅ `Entity.populated?: boolean` added. Universe
  generation rolls ~12% of `kind: "planet"` entities as colonies with
  a `◈` name prefix so scanner labels, target panels, and chatter tags
  all read as inhabited without per-panel branches.
- **Landing** — ✅ `tryDock` now accepts a targeted populated planet at
  ≤300u and throttle ≤5%. Opens the station screen directly on the
  Market page; the existing `isMini` branch in `buildStationLines`
  restricts the menu to `[Market, Undock]`. NO free repair or
  automatic refuel — colonies are trade posts, not shipyards. Wages
  still tick per dock.
- **Colony chatter** — ✅ New `planet_populated` `ChatterKind` with
  7 tradehouse / bazaar / militia lines. Ambient chatter routes
  populated planets through it with a `Colony {name}` speaker tag and
  amber `#ffd28a` color that matches the market UI palette.
- **Scripting** — ✅ Added `onPlanetLand` hook (`{ entity }`) and
  extended `onPlayerDock` payload to include `kind: "planet"`. Both
  fire from the colony landing path; runtime remains no-op until the
  Lua host lands. Hook table in `src/game/README.md` updated.
- **VERSION bump** — ✅ 0.5.2 → 0.5.3 and offline bundle rebuilt.

## 0.5.4 pass — New crew roles

- **CrewRole extended** — ✅ Added `navigator`, `quartermaster`,
  `recruiter`, `tactical` to the `CrewRole` union, `CREW_ROLE_INFO` (title /
  baseFee / blurb / color), and `generateCrewMember` wage table. Existing
  saves keep loading since the `crew[]` array is optional and untyped roles
  are ignored by the hire menu.
- **Passive perks** —
  - **Navigator**: +400u radar range (stacks with Pilot/Engineer/Sensor
    Array/Long-Range Scanner) and a 10% fuel-burn discount (stacks
    multiplicatively with Engineer's 20% discount).
  - **Quartermaster**: adds a 5% ore-sell bonus and a 5% station-buy
    discount on top of Merchant (both multiply through `merchantSellMult` /
    `merchantBuyMult`, so all module/weapon/fuel prices benefit).
  - **Recruiter**: multiplies every hire fee (including Xeno tier) by
    0.85. Menu previews and the hire handler both apply the same mul.
  - **Tactical**: multiplies shield regen by 1.25 (stacks on top of the
    Engineer bonus). Full weapon-mount takeover is deferred — see backlog.
- **Gunner ↔ Tactical exclusivity** — ✅ The station Crew page hides the
  hire row and shows a `locked (Gunner aboard)` / `locked (Tactical Officer
  aboard)` line when the counterpart is on the crew. The hire handler
  double-checks and refuses the swap with a `pushLog` explaining which
  role to dismiss first. Applies to Xeno hires too.
- **Chatter templates** — ✅ 8 new `ChatterKind` entries per new role
  (`navigator_idle` / `_greet` / `_farewell_good` / `_farewell_bad`, etc.)
  plus a `tactical_hostile` line. All wired through the existing
  `pushChatter` / `tickCrewIdle` / hire-menu greet path — the crew page's
  `roles` array is the only registration point.
- **VERSION bump** — ✅ 0.5.3 → 0.5.4 and offline bundle rebuilt.

### Backlog (0.5.4 deferred)

- **Tactical firing weapon** — plan called out "can fire the main weapon,
  +15% crit chance". This pass only shipped the shield-recharge and
  exclusivity halves. Firing needs a new `p.tactical` auto-fire hook (or a
  refactor to make `p.gunner`'s fire loop role-agnostic) plus a crit-roll
  extension in the shot damage calc.
- **Morale field on CrewMember** — the Recruiter plan mentions slowing
  morale decay. Morale doesn't exist yet as a field; add it once the
  wage-shortfall system moves past cosmetic grumbling.
- **Navigator T-cycle expansion** — plan called for the navigator to add
  `wormhole` / mission targets / stars (BH) to the T-cycle target set.
  Landed as radar range + fuel burn only; the target-cycle predicate lives
  in `cycleTarget` and can pick these up in a later pass.

## 0.5.5 pass — Lua host + crew backlog

- **Lua runtime landed** — ✅ `src/game/lua-host.ts` bundles `fengari-web`
  (WASM-less pure-JS Lua 5.3) into the offline build. Sandbox strips
  `io`, `package`, `debug`, `require`, `dofile`, `loadfile`, `load`,
  `loadstring`, `collectgarbage`, and replaces `os` with a timing-only
  stub (`os.time` / `os.clock`). Errors from load, top-level run, and
  per-hook invocation are trapped and echoed to the pushLog bridge — a
  bad script cannot take down an engine tick.
- **`frontier.*` API** — ✅ Three bindings for M1:
  - `frontier.version` — engine `VERSION` string.
  - `frontier.log(msg)` — pushes a system log line.
  - `frontier.chat(who, msg, color?)` — pushes a Comms line.
  - `frontier.on(hook, fn)` — registers a Lua callback on any
    `ScriptHookName`. Payloads arrive as depth-capped Lua tables with
    primitive leaves; nested JS objects deeper than depth 2 are
    stringified so scripts never see live entity handles.
- **Options ▸ Scripting submenu (real)** — ✅ The greyed-out "Scripting
  (soon)" placeholder is replaced by a live subsection with
  `Scripting: ON/OFF`, `Edit Script...` (browser `prompt()` editor —
  drag-drop `.lua` loading is M3), `Reload Script`, `Clear Script`,
  and a `Status:` row that surfaces the last load/hook error. Source
  and enable flag persist in `localStorage` under `voidwake.script.*`.
  Runtime is lazy-imported so users who never enable scripting don't
  pay the ~200KB fengari-web bundle cost — the offline HTML grew from
  ~197KB → ~397KB, entirely inside the on-demand chunk in dev.
- **Tactical firing** — ✅ New `updateTactical(dt, fwd)` runs alongside
  `updateGunner`. Same alignment cone / range check but only engages
  hostiles (never rocks or stations). Fires the pilot's mounted weapon
  with a 10% cadence penalty (vs. 15% for Gunner), posts an occasional
  `tactical_hostile` bark. Because Gunner ↔ Tactical are mutually
  exclusive, the two firing loops can never both engage.
- **Morale field** — ✅ `CrewMember.morale?: number` (0..100, defaults
  to 100 on new hires, backfills to 100 for legacy saves). Wage
  shortfalls decay morale by 15/dock (halved to 8/dock when a
  Recruiter is aboard). Full pay heals +2/dock. A crewmember below 30
  gets a distinct "morale's underwater — fix this or we walk" grumble
  line. Walk-out / perk-loss behaviour is still deferred (see backlog).
- **Navigator T-cycle expansion** — ✅ Three new `[/]` categories —
  `WORMHOLE`, `MISSION`, `EXOTIC` (BH / PSR) — appended to
  `_targetCategories` with a `navigator: true` flag. Cycle logic skips
  them unless a Navigator is on the crew.
- **VERSION bump** — ✅ 0.5.4 → 0.5.5 and offline bundle rebuilt.

### Backlog (0.5.5 deferred — pick up next pass)

- **Tactical crit chance** — plan called for +15% crit on Tactical shots.
  Not landed: the damage path is spread across several bullet-resolution
  branches and needs a `critMul` helper before the bump can drop in one
  edit. Aiming for a small refactor pass.
- **Morale consequences** — decay + display works; walk-outs, perk
  attenuation below 30, and morale-modulated chatter frequency are still
  cosmetic. Wire once the wage-shortfall/hostility loop is fleshed out.
- **Roche-limit irregular shapes** — cheap render tweak still on deck.
  Small bodies (asteroid/comet/meteor) within `2 × planetRadius` of a
  planet should render with an irregular per-frame edge; hash the entity
  id + tick to seed roughness so it's stable per cell.
- **Colony flavor polish** — colonies still look identical to stations
  outside the `◈` prefix. Add a colony glyph or ring in the renderer
  plus a colony-specific stock jitter so they're not market-identical.
- **Dedicated "Chat Windows" submenu** — the three comms controls still
  sit inline under Gameplay. Nested submenu deferred.
- **Distinct patrol silhouettes** and **event-triggered patrol comms** —
  0.3 backlog, still open.
- **Options for scanline density / glitch intensity** — 0.3 backlog.
- **Stranded ships mayday chatter** — 0.3 backlog.
- **Mouse-wheel scroll + click-to-select tabs** on Comms panel — 0.4
  backlog.
- **`System` tab for Sensors/Radio** — 0.4 backlog if the noise
  threshold rises.
- **In-canvas Lua editor** — the current `prompt()` editor works but
  truncates at ~2KB in some browsers. Drag-drop `.lua` file loading
  arrives with M3 of the modding roadmap.
- **Lua mutation API** — M2 below. Today's `frontier.*` is read-only
  (log / chat / hook subscribe). Writes will land next.

## Modding roadmap (Lua + content packs)

Modding is a first-class feature target. The hook surface (0.5.1) and
the Lua host (0.5.5) are the foundation; the milestones below turn the
runtime into a real mod platform users can extend without editing the
engine.

**M1 — Lua host** — ✅ shipped in 0.5.5. Sandbox, `frontier.log/chat/on`,
Options ▸ Scripting submenu, localStorage persistence, lazy runtime
import. Payloads are read-only depth-capped tables.

**M2 — Mutation API**

- Add `frontier.entities.spawn(kind, opts)`, `frontier.entities.despawn(id)`,
  `frontier.entities.get(id)`, `frontier.entities.list(filter)`.
- Add `frontier.player.grant({ credits, xp, ore, ... })` for guarded
  reward payouts (server-side clamps prevent unbounded exploits).
- Add `frontier.world.seed`, `frontier.world.time`, and a small event
  emit helper so scripts can trigger `pushLog`-style broadcasts.
- Every write goes through a validation layer that clamps values and
  refuses invalid entity kinds. A misbehaving script crashes itself,
  never the engine.

**M3 — Mod bundles**

- Define a `mod.json` manifest: `{ id, name, version, entry, hooks,
  permissions, gameVersion }`.
- Accept a folder or zipped bundle drag-dropped onto the title screen.
  Persist installed mods in **IndexedDB** — localStorage is too small
  for multi-file bundles.
- Options ▸ Mods submenu (new) with per-mod enable/disable, a load-
  order list (deterministic alphabetical by id, overridable via
  `priority`), and a "Reveal load errors" pane.
- Save files record the active mod set so a save loaded without its
  mods warns rather than silently missing content.
- Introduce an in-canvas file picker (reuses the existing save/load
  file-picker plumbing) so mods can be added without opening devtools.

**M4 — Content packs (data-only mods)**

- JSON packs extend existing tables without any Lua:
  - `WEAPONS` — new weapon ids, damage/range/cooldown tuning.
  - `SHIP_HULLS` — new hulls with unlock conditions.
  - `CREW_ROLE_INFO` — new roles + wage tiers + chatter templates.
  - `TEMPLATES` (`chatter.ts`) — new speaker kinds and line pools.
  - `SPECIES` — new species with bonus/drawback/affinity.
  - `MODULES` — new outfitting modules.
  - Station stock tables, planet name fragments, mission text pools.
- Reserved namespace `mod:<id>/…` for all new ids so packs can never
  collide with core content or each other.
- Data-only mods pass through the same manifest and load-order system
  as Lua bundles; the loader is a schema validator + merger, no VM.

**M5 — Debug / authoring**

- **In-game console** — backtick opens a one-line Lua REPL that evals
  against the sandbox and prints results with a `Script` speaker tag.
- `frontier.debug.dumpEntity(id)`, `frontier.debug.time()`,
  `frontier.debug.trace(on)`.
- **Per-hook timing overlay** under Options ▸ Scripting so authors can
  spot heavy handlers (>1ms).
- **Mod docs bundle** — generate an offline HTML reference of every
  hook payload, `frontier.*` binding, and moddable table by
  introspecting the same TS types used at build time.

**What's needed to open the engine to modders without touching JS**

Concretely, the pieces still to build before a non-programmer can ship
content are:

1. **Data-driven tables** — a small set of exported "extension points"
   (`WEAPONS`, `SHIP_HULLS`, `CREW_ROLE_INFO`, `TEMPLATES`,
   `SPECIES`, `MODULES`, station stock, planet name fragments). Each
   needs a JSON schema and a merge helper that folds mod entries in
   after the core tables load. Design bias: **new rows only**; core
   rows are frozen so mods can't silently break the vanilla balance.
2. **Manifest + loader** — `mod.json` parser, ordered mod list in
   IndexedDB, Options ▸ Mods UI. M3 above.
3. **File picker + drag-drop surface** — reuse the save/load file
   picker so mods land without devtools. Zip support via `fflate`
   (~10KB) — WASM-free, works offline.
4. **Save compatibility** — persist active mod ids in the save blob
   and warn on load when a mod is missing. Already partially in place
   via the version field; extend with a `mods: string[]`.
5. **Public API docs** — the M5 doc bundle. Without it, only script
   authors who read TS can find every hook payload.
6. **Sandbox permission model** — per-mod permission gates (e.g.
   `network`, `storage`, `mutate:entities`) surfaced in the enable
   prompt. Prevents a drag-drop bundle from silently doing things the
   player didn't consent to.

Hook payload shapes remain frozen. Any new hook must land as a no-op
dispatcher first (like `onPlanetLand` did in 0.5.3) so scripts written
against a newer build don't crash on an older one — see the "Payload
shapes are stable" note in `src/game/README.md`.

### Recommended next round (0.5.7+)

Ranked by ROI:

1. **M2 mutation API** — `frontier.entities.spawn/despawn`,
   `frontier.player.grant`. Unlocks meaningful gameplay mods on top of
   the Lua host that shipped in 0.5.5.
2. **Dedicated "Chat Windows" submenu** — the three comms controls
   still sit inline under Gameplay.
3. **Distinct patrol silhouettes** — patrol ships still render as
   generic green friendlies. Cyan tint + unique 3×3 sprite.
4. **Morale perk attenuation** — role passives should soften as morale
   dips below 30 (Engineer's fuel discount fades, Recruiter's hire cut
   halves) so low morale bites before the walk-out step.
5. **NPC crits** — a mirror of the 0.5.6 player crit path so hostile
   fire lands the occasional big hit and the combat loop reads as
   symmetric rather than player-favored.
6. **M3 mod bundles** — the moment M2 lands, ship the manifest and
   IndexedDB loader so authors can distribute multi-file mods.

## 0.5.6 pass — Crits, walk-outs, Roche shapes, colony polish, chatter

- **Critical hits** — ✅ Every player shot rolls for a crit in the
  bullet-hit path. Base 8%, +5% with a Gunner aboard; Tactical
  auto-fire uses a 23% floor (the "+15% Tactical crit" from the crew
  backlog). Crits apply a 2× damage multiplier and post a `★ CRIT`
  chatter line tagged `Weapons` / `Gunner` / `Tactical`. NPC fire does
  not crit (deliberate — this is a player-side feedback loop, not a
  two-way lottery).
- **Morale walk-outs** — ✅ Wage decay path now supports walk-outs.
  - **Cheat Mode**: wages + morale entirely skipped (already gated).
  - **Easy difficulty**: morale floors at 5. Crew gripe on short pay
    but never walk. Softer grumble line posted.
  - **Normal / Hard / Brutal / Nightmare**: morale can hit 0. At 0 the
    crewmember is spliced from `player.crew` and posts a role-specific
    `*_farewell_bad` line (falling back to a generic `walkout` template
    if the role has none).
- **Roche-limit shapes** — ✅ Small bodies (asteroid/comet) inside 3×
  the nearest planet's world radius render with hash-driven per-cell
  roughness perturbing the ellipse threshold. Ramps from 0 at 3×R to
  ~0.28 at 1×R so drifters look intact and rocks pressed against a
  planet look shredded. Seeded by `id * 1301 + dx * 613 + dy * 419 +
  tBucket * 11` for a slow shimmer without allocating per frame.
- **Colony polish** — ✅ Populated planets now render a faint dotted
  orbital ring (`·`, amber) around the sprite plus a top-center `◈`
  beacon glyph so colonies read as inhabited without waiting for the
  name label. `getStock` post-processes colony stocks to charge +25%
  on ore (colonies always want feedstock), +10% on fuel (no atmosphere
  refinery), zero out the weapons list (militia-only supply), and
  swap in colony-specific rumor lines.
- **Patrol event chatter** — ✅ New module-level `_aiEvents` queue.
  `tickAI` pushes on `patrol_tow_start` and `patrol_arrest_start`
  transitions; the engine drains it after the AI loop and posts a
  `patrol_tow` or `patrol_arrest` chatter line keyed to the actual
  event instead of ambient patrol filler. Ambient patrol chatter still
  runs alongside.
- **Stranded mayday** — ✅ Ambient chatter picker no longer filters out
  stranded ships. When a stranded lawful ship is picked, the engine
  short-circuits to a `stranded_mayday` line in the amber warning
  color so the mayday reads distinctly from ordinary chatter.
- **Scanline density** — ✅ New Options ▸ Gameplay row
  `Scanline Density: dense / normal / sparse` maps to a 1/2/3 step
  and 0.20/0.14/0.10 alpha. Defaults to `normal` (matches previous
  visual). Persists in save.
- **Chatter expansion** — ✅ Six new `ChatterKind` entries
  (`patrol_tow`, `patrol_arrest`, `stranded_mayday`, `crit_hit`,
  `walkout`, plus extended `planet_populated` / `hostile` / `friendly`
  / `neutral` / `station` / `planet` / `patrol` / `gunner_*` pools).
  15+ hostile lines, 10+ neutrals, 12 colony lines, 5 stranded
  maydays. Also stretched `gunner_idle` / `gunner_hostile` /
  `gunner_hit` / `gunner_mine` / `gunner_dock` / `gunner_kill` and
  `gunner_farewell_bad`.
- **VERSION bump** — ✅ 0.5.5 → 0.5.6 and offline bundle rebuilt.

### Backlog (0.5.6 deferred)

- **NPC crit path** — mirror the player crit logic for hostile shots so
  combat feels symmetric. Kept off intentionally in 0.5.6 to prove
  crits read as a player-side reward first.
- **Morale perk attenuation** — role passives don't yet soften as
  morale dips below 30. Add per-role effect multipliers keyed on
  `c.morale` (Engineer fuel discount fades, Merchant sell bonus
  shrinks, Recruiter hire cut halves).
- **Chat Windows submenu** — the three comms controls still sit inline
  under Gameplay. Nested submenu deferred.
- **Distinct patrol silhouettes** — 0.3 backlog, still open.
- **In-canvas Lua editor** — the current `prompt()` editor works but
  truncates at ~2KB in some browsers. Drag-drop `.lua` file loading
  arrives with M3 of the modding roadmap.
- **Lua mutation API (M2)** — `frontier.entities.spawn/despawn`,
  `frontier.player.grant`. Read-only surface remains.
- **Mouse-wheel scroll + click-to-select tabs** on Comms panel — 0.4
  backlog, still open.
- **`System` tab for Sensors/Radio** — 0.4 backlog if noise rises.

## 0.5.7 pass — How To Play, M2 mutation API, morale perks, NPC crit, rescue

Menu / onboarding

- **How To Play** menu item, wired on both the title menu and the pause
  menu between `Load Game` and `Legend (Codex)`. Six pages: Premise,
  Survive Your First Quest, Controls, HUD & Display, **Mouse-Steer
  Safety** (bold red panel explaining recovery from a spinning
  cockpit), Tips & Tricks. Controls page reads live from
  `options.keybinds` so rebinds render correctly. ESC returns to the
  screen that opened it via `_howtoReturn`.

Combat

- **NPC crit symmetry.** Hostile bullet hits now roll a crit at 6%
  (10% for named "boss" pirates): 2× damage, quick screen shake, and a
  red `‼`-tagged line from the new `npc_crit` chatter pool. Cheat Mode
  keeps the invulnerability short-circuit.

Crew

- **Morale perk attenuation.** Wage-shortfall decay now stacks role
  reductions: Recruiter −7, Quartermaster −3, Merchant −2, floor 3.
  Wages always matter, but a support crew can keep morale sustainable.
- **Friendly rescue interaction.** Hailing a `stranded` friendly /
  neutral (F within 50u, throttle ≤ 5%) donates 15% of your fuel bar,
  clears the mayday, pays `+120cr / +40 XP / +3 rep`, and posts a
  `stranded_thanks` chatter line. Requires ≥ 20% own fuel so it can't
  strand the player. Complements the existing SPD-Patrol auto-tow.

Scripting

- **M2 mutation API.** `LuaHostBridge` gains optional `addCredits`,
  `addFuel`, and `getPlayerSnapshot` writers. Lua surface adds
  `frontier.addCredits`, `frontier.addFuel`, and a read-only
  `frontier.player()` snapshot. Entities, missions, and world state
  stay read-only until M3.

Chatter

- Expanded `hostile`, `friendly`, `neutral`, `station`, `patrol`,
  `stranded_mayday`, `banter`, `crit_hit`, and `walkout` pools; added
  `npc_crit` and `stranded_thanks` pools.

Backlog rolled forward to 0.5.8+

- **M3 modding:** entity spawn/despawn API, mod bundle loader, content
  packs for hulls / weapons / missions, in-game script editor overlay
  (multi-line, syntax hints), drag-drop `.lua` load.
- **Rebindable rescue prompt** at station menus (currently only via
  hail proximity + F).
- **Crew banter matrix expansion** — role-pair-specific banter lines
  (Engineer × Merchant, Navigator × Tactical, etc.).
- **Boss chatter** — dedicated pool for named captains distinct from
  generic hostile chatter.

## 0.5.8 pass — Targeting bugfix, same-type cycle, low-hanging fruit

Targeting

- **Bugfix: T no longer ping-pongs.** The previous `cycleTarget` filtered
  out the current target and picked the nearest survivor, which meant
  repeated presses bounced between the two closest entities — reproducible
  after hiring the Navigator (+400u radar) and Pilot because the extra
  in-range blips (stations, asteroids) crowded hostiles out of the "two
  nearest" ping-pong. Now `cycleTarget` sorts every non-bullet entity in
  radar range by distance, finds the current selection, and advances one
  index (wrapping at the end). Every visible entity is reachable in a
  finite number of presses regardless of crew loadout.
- **`{` / `}` — same-type cycle.** New keybinds (`cycleTypePrev` /
  `cycleTypeNext`) walk in-range targets matching the current target's
  category (STATION / ASTEROID / HOSTILE / FRIENDLY / NEUTRAL / BEACON /
  PLANET / DERELICT / WORMHOLE / MISSION / EXOTIC). Useful for "give me
  the *next* hostile" without leaving combat via `[`/`]`. Falls through
  to plain nearest-cycle when nothing is targeted.
- **Radar-range clamp on `T`.** Cycling now respects `effectiveRadarRange`
  so entities beyond sensor reach can't hijack the selection. Distant
  stars and out-of-scope planets no longer sit in the cycle when a bare
  loadout starts targeting nearby traffic.

Docs & UI

- How To Play controls page and Codex bindings updated with the new
  `{`/`}` cycle-by-type keys.
- Options ▸ Controls ▸ Keybinds gains two new rebindable rows
  (`Prev/Next Target (Same Type)`), placed alongside the existing
  category-cycle rows.

VERSION bump

- 0.5.7 → 0.5.8, offline bundle rebuilt.

## 0.5.9 pass — Boss chatter, banter matrix, pool expansion, Lua samples

Chatter

- **Boss chatter pool.** New `boss_hostile` `ChatterKind` with 10
  distinct captain-tier lines. Ambient hostile chatter and the
  inter-NPC banter picker both route `e.boss === true` hostiles
  through it, so named pirate captains now trash-talk in their own
  voice with a deeper red tag (`#ff5566`) instead of blending into
  the generic hostile pool. (0.5.7 backlog item.)
- **Crew banter matrix expansion.** Added 12 new pair-flavored lines
  to the `banter` pool — coupler repairs, hazard reports, rations,
  wage-bill jokes, "you ever pray?" — so ambient crew banter reads
  distinct from single-role idle chatter. (0.5.7 backlog item.)
- **Pool expansion.** Extended `friendly` (+3), `neutral` (+3),
  `patrol` (+3), and `stranded_mayday` (+3) with fresh lines to keep
  ambient chatter from repeating on long sessions.

Modding docs / low-hanging fruit

- **Lua sample scripts library.** New `src/game/lua-samples.md`
  contains 7 self-contained snippets covering `frontier.log`,
  `frontier.chat`, `frontier.addCredits`, `frontier.addFuel`,
  `frontier.player()`, and the `onChatter` / `onPlayerDock` /
  `onPlayerFire` / `onEntityDestroyed` / `onSave` / `onPlanetLand`
  hooks. Paste any block into Options ▸ Scripting ▸ Edit Script to
  see the sandbox in action. (Suggestion #13 from the roadmap.)

VERSION bump

- 0.5.8 → 0.5.9, offline bundle rebuilt.

## 0.5.10 pass — Chatter pool expansion, System tab, wheel-scroll on Comms

Chatter (primary ask)

- **Broad pool expansion.** Added 5–13 new lines to every speaker pool
  that has one: `hostile` (+9), `boss_hostile` (+7), `friendly` (+9),
  `neutral` (+8), `station` (+9), `planet` (+6), `planet_populated`
  (+8), `patrol` (+9), `patrol_tow` (+5), `patrol_arrest` (+5),
  `stranded_mayday` (+7), `crit_hit` (+6), `npc_crit` (+5), `walkout`
  (+6), `stranded_thanks` (+5), `gunner_idle` (+6), `pilot_idle` (+6),
  `engineer_idle` (+6), `merchant_idle` (+6), `navigator_idle` (+5),
  `quartermaster_idle` (+5), `recruiter_idle` (+5), `tactical_idle`
  (+5), and `banter` (+13). Every entity capable of chatter has a
  meaningfully deeper pool now, so long sessions repeat far less.

Low-hanging fruit (from wishlist)

- **Comms `System` tab.** Fourth tab (`Sys`) added to the Comms panel
  after `Ext`. Filters `channel === "system"` — the ship computer
  (`Sensors`, `Radio`) already routes there, so this is pure UI
  surface. `\` cycle order is now All → Crew → Ext → Sys. Clears the
  0.4/0.5 backlog `System` tab item.
- **Mouse-wheel scroll on Comms panel.** The wheel handler now checks
  the cursor's cell position against the panel rect published each
  render (`_commsRect`). When the cursor is over the panel, the wheel
  scrolls the feed (2 lines per notch); otherwise it still adjusts
  throttle. No new keybind, no regression to existing throttle
  behavior. Clears the 0.4 backlog wheel-scroll item.
- **Panel hint updated** to mention wheel scroll alongside PgUp/PgDn.

VERSION bump

- 0.5.9 → 0.5.10, offline bundle rebuilt.

## 0.5.11 pass — Clickable Comms tabs + Hide/Show toggle

- **Clickable tabs.** All / Crew / Ext / Sys labels in the Comms
  header are now click hitboxes; selecting one sets `chatterTab` and
  resets `chatterScroll` to 0 (same as `\`).
- **[Hide] button.** New right-aligned `[Hide]` control on the header
  row collapses the entire panel to a single `[+] Show Comms` pill in
  the top-left. Clicking the pill restores the full panel.
- **Wheel routing respects the collapsed state.** `_commsRect` now
  covers just the pill when hidden, so mouse-wheel-over-pill won't
  scroll a hidden feed and the wheel falls back to throttle everywhere
  else on the canvas.
- **Transient state.** `commsHidden` is per-session, not persisted, so
  a fresh load always shows the full panel.
- VERSION bump 0.5.10 → 0.5.11; offline bundle rebuilt.

## 0.5.12 pass — Save UX polish, richer nebula, chatter expansion

- **Timestamped save/load slots.** The Save screen always shows all
  three slots with the most recent write time (or `(empty)`) so
  players can see at a glance which slot to overwrite. The Load
  screen lists only occupied slots with timestamps.
- **Export to JSON / Import from JSON.** New Save-screen action
  serialises the current in-memory game to a downloadable `.json`
  file; new Load-screen action opens a file picker and adopts the
  parsed blob as the live state (shares `applyLoadedBlob` with the
  disk-load path). Both go through `defaultOptions()` backfill.
- **Nebula wash overlay.** When `_inNebula` is true the renderer
  now paints a density-scaled multi-tint gas haze over the viewport
  (three glyph bands, five purple/violet tints) plus a pulsing
  `▒ NEBULA WASH — sensors degraded ▒` tag near the bottom of the
  viewport. Reads much more clearly than the old 30-speckle veil.
- **Crew idle chatter expansion.** ~80 new idle lines across
  Gunner / Pilot / Engineer / Merchant / Navigator / Quartermaster /
  Recruiter / Tactical pools to blunt the "hearing the same three
  lines" complaint. All use existing `chatterCtx` placeholders.
- VERSION bump 0.5.11 → 0.5.12; offline bundle rebuilt.


## Long-term wishlist (deferred, no ETA)

Items explicitly on hold for a future release (or an outside mod).

- **Player-to-NPC comms with template replies.** Hail-target key, intent
  menu, reply generator keyed by `(faction, intent, reputation,
  hostility)`, Lua `onHail` hook. ~1 focused release for templates,
  ~2 for an LLM-backed arc.
- **Rebindable rescue prompt at station menus.** Complements the
  existing hail-proximity rescue (0.5.7).
- **In-canvas multi-line Lua editor.** `prompt()` still truncates at
  ~2KB in some browsers; drag-drop `.lua` loading ships with M3 of the
  modding roadmap.
- **Chat Windows submenu** — nested Options subsection for the three
  inline Comms controls under Gameplay.
- **Distinct patrol silhouettes** — 0.3 backlog, still open.






## 0.5.13 — Distinct patrols + chatter refresh

- **Distinct patrol silhouettes.** `SHIP_SPRITES.patrol` now provides
  four blockier, armored 3×3 hulls used whenever an entity is a
  `friendly` with `faction: "patrol"`. Renderer branches at the
  sprite pick so civilian friendlies keep their softer silhouettes.
- **Chatter expansion.** ~60 additional lines seeded across
  `hostile`, `friendly`, `neutral`, `station`, `patrol`,
  `gunner_idle`, `pilot_idle`, and `engineer_idle` pools. All lines
  reuse the existing `chatterCtx` placeholders (no new fragments).
- VERSION bump 0.5.12 → 0.5.13.

Deferred (still open): player-to-NPC comms, in-canvas Lua editor.

## 0.5.14 — Chat Windows submenu, unclamped pitch, deep sky, 2× universe

- **Chat Windows submenu.** The three Comms controls (Width, Height,
  Word Wrap) are moved out of the flat Gameplay list into a nested
  Options ▸ Gameplay ▸ Chat Windows sub-page. ESC bounces back to
  Gameplay with the cursor parked on the entry. `optionsSection` gains
  a `"chat"` state; `updateOptionsChat` + `optionsChatItems` mirror the
  Keybinds pattern. Leaves room for future per-tab colors / timestamp
  format / auto-hide-in-combat toggles.
- **Continuous pitch.** Player pitch is no longer clamped at ±π/2.
  Keyboard (`Q`/`E`), touch stick, and mouse-steer paths now push
  through `wrapPi()` so the ship can loop over the top or under the
  bottom continuously — a real spacecraft has no absolute "up".
  `headingToVec` was already trig-based and needs no changes.
- **Colorful gas puffs.** New `gasClouds` field seeds ~60 dim
  `·` glyphs in warm/cool tints around the player, projected through
  the same camera as the starfield. Very sparse so entities/HUD read
  cleanly.
- **Galactic disk + core + supermassive black hole.** New `_galaxyDirs`
  builds 180 unit vectors along the galactic plane (rendered "at
  infinity" — camera rotation only, no translation) that paint a faint
  purple band across the sky. Direction to world origin projects a
  bright `*` galactic center with a warm halo and a `●` black-hole
  overlay in a deep near-black tone.
- **2× universe radius, density maintained.** `WORLD_RADIUS` and each
  sub-radius double (27k → 54k, etc). All population counts scale by
  ≈8× to preserve current per-volume density: 47 → 376 background suns,
  142 → 1,136 planets, 1,755 → 14,040 asteroids, 68 → 544 civilian
  stations, 37 → 296 pirate bases, 506 → 4,048 ships, 95 → 760 comets,
  140 → 1,120 nebulae, 68 → 544 beacons, 41 → 328 derelicts, 14 → 112
  UFOs, patrol group 5-7 → 40-63, wormhole pairs 7 → 56. Frame timing
  budget: renderer only draws entities within its existing culling
  radius, so far-away populations are cheap; AI ticks touch every
  ship, so if this proves heavy on lower-end machines we'll add a
  radius gate around the player in a follow-up.
- VERSION bump 0.5.13 → 0.5.14.

Deferred (still open): player-to-NPC comms, in-canvas Lua editor,
optional radius-gated AI tick for very large universes.

## 0.5.15 — Deep-space halo

- Added `DEEP_SPACE_RADIUS = 10 × WORLD_RADIUS` and a `randPosShell()`
  sampler so entities can be placed strictly OUTSIDE the core play area.
- Sparse deep-space scatter appended in `generateUniverse()` past the
  core shell: 220 far suns, 320 rogue asteroids (richer ore rolls),
  90 comets, 120 thin nebulae, 60 ancient wrecks (richer loot),
  60 wandering UFOs, 24 rogue pirate raiders, and 18 pure-rescue
  distress beacons. Total ≈ 910 entities across ~999× the core volume
  → density ~1000× lower than the core.
- Deliberately kept out of deep space: colonies, pirate bases,
  wormholes, ruins, bosses, patrols, wormhole gate stations, dyson
  swarms. Every quest-anchoring, faction, and economy entity stays in
  the core so quests keep working exactly as before.
- No new despawn logic needed — existing tick already has a 3500-unit
  distance gate around the player, so far-away deep-space entities are
  effectively free when the player is in the core.

## 0.6.0 — Physics audit + mouse-steer yaw drift fix

Bug hunt pass across the flight/positioning code before shipping the 0.6
milestone. Every player-driven heading mutation now round-trips through
`wrapPi()` so yaw and pitch stay bounded in `(-π, π]` regardless of
input path (keyboard, touch stick, mouse-steer, autopilot).

- **Mouse-steer yaw drift (fix).** The mouse-steer branch was the only
  remaining callsite that mutated `p.heading.yaw` with a bare `+=`, so
  long mouse sessions could accumulate an unbounded yaw magnitude. Over
  hours this drifts into large floating-point values where `Math.cos` /
  `Math.sin` lose precision, which shows up as a subtle wobble in the
  reticle heading and NPC bearing calculations. Now uses
  `wrapPi(p.heading.yaw + …)` to match the keyboard and touch paths.
  Pitch on the same branch already wrapped.
- **Physics audit — clean.** Verified with `grep` that every heading
  write across player and autopilot paths is `wrapPi`-wrapped (see 7
  callsites at lines 4747–4759, 4818–4819, 6165–6166). NPC AI does not
  store per-ship yaw/pitch (it steers by direct velocity vectors), so
  the drift class does not apply there.
- **Projection re-verified.** `renderPlaying`'s camera transform and
  `headingToVec` are pure trig against yaw/pitch and remain valid at
  any pitch, including continuously-looped values from 0.5.14. No
  clamping was reintroduced by mistake.
- **Autopilot shortest-arc re-verified.** `driveAutopilot` still
  normalizes both `dy` (yaw) and `dp` (pitch) to `(-π, π]` before
  slewing, so it never takes the long way around when engaged from an
  inverted attitude.
- VERSION bump 0.5.15 → 0.6.0; offline bundle rebuilt.

Deferred (still open, will pick up in 0.6.x):
- Player-to-NPC comms with template replies (long-term wishlist).
- In-canvas multi-line Lua editor (long-term wishlist).
- Faction reputation panel expansion (data exists on
  `PlayerState.reputation`; UI treatment is minimal today).
- Crew XP progression (design sketch only; not yet in code).



## 0.6.1 — Ringed worlds, planet variety, more chatter

- **Planetary rings** — Deterministic per-planet ring system. Base chance
  22%; gas giants (`planetSizeMul` ≥ 1.55) hit ~78%; dwarf worlds ~6%.
  Each ring gets an inner/outer radius (1.25–2.35× planet), a tilt
  (-77°..+77°), a density roll (0.35–0.80), and one of 8 dust/ice
  colors. Rendered as a screen-space annulus in the planet's tilted
  plane, with a Cassini-style gap at ~65% of the ring width, sparse
  glyph mix (`·`, `-`, `=`, `~`). Front-of-planet cells that fall
  inside the disc are occluded; back-half cells fall outside the disc
  thanks to the tilt, so the pass reads as 3D without a real z-buffer.
- **Planet size variability** — New `planetSizeMul(e)` returns a
  weighted per-planet size jitter: ~15% dwarfs (0.50–0.80×), ~70%
  normal (0.75–1.40×), ~15% giants (1.55–2.25×). Applied to the render
  world radius only — collision radius and dock hold radius stay at
  the 30u constant, so gameplay is unchanged.
- **Wider planet palettes** — `PLANET_FILLS` 12 → 32 colors (crimson
  hellworlds, indigo dwarfs, sulphurous yellows, amethyst gas giants,
  mint seas, cinder chars, moss/bog worlds, etc.); matching
  `PLANET_EDGES` extended to 32 shadow tones; `PLANET_TEX` gained
  `◍ ◉ θ ◐ ◑` for more surface pattern variety. All keyed by `hash01(e.id)`
  so seeds stay stable across saves.
- **Chatter expansion** — Added ~55 new lines across `hostile`,
  `friendly`, `neutral`, `station`, `planet`, `planet_populated`,
  `gunner_idle`, and `pilot_idle`. Several new lines reference the new
  ringed / pink-cloud / hellworld visuals so the flavor tracks the
  visual variety.
- **VERSION bump** — 0.6.0 → 0.6.1; offline bundle rebuilt (456 KB).

Deferred (still open, will pick up in 0.6.x):
- Player-to-NPC comms with template replies.
- In-canvas multi-line Lua editor.
- Faction reputation panel expansion (data exists; UI is minimal).
- Crew XP progression (design sketch only).
- Optional radius-gated AI tick for very large universes.

## 0.6.2 — Rep panel, crew XP, bottom-right overlap fix

- **Panel overlap audit (lower right)**: root cause was the mission log
  column (drawn at `cols-52..cols-1`, `rTop..rows-2`) with no right
  clip, colliding with the right cockpit panel (`cols-26..`), plus the
  CONTROLS block whose 19 rows extended two lines below `vpBottom` into
  the status/log strip. Fixes:
  - Right-clip every SYSTEM/mission bottom-strip putText call at
    `cols-54` so it can't bleed into the log column.
  - Right-clip the mission log column at `cols-28` so it can't bleed
    into the right panel.
  - Right-clip every CONTROLS and CREW right-panel line at
    `panelX+26` so long tags stay inside the panel.
  - Move `cTop` from `vpBottom-16` to `vpBottom-19` so the controls
    title + 17 keys + mouse row all sit inside the viewport.
- **Toggleable Rep Panel (R)**: new `repPinned` state (off by default)
  plus keybind entry `pinRep` (default R). When on, renders a compact
  `[ STANDINGS ]` block top-right of the viewport (below the quest
  tracker when both are pinned) with Fed / Gld / Pir label + numeric
  standing, color-coded green/red at ±20. Followed by a `[ CREW XP ]`
  block listing up to 4 crew with `L#` and a 9-cell `▮/▯` progress bar.
- **Crew XP**: added `CrewMember.xp?` (Gunner mirrors it) plus
  `crewLevel(c)` = clamp(floor(xp/50), 0..9) and `grantCrewXP(p, n)`
  helper. Hooked at kill (4 / 15 / 30 XP for regular / boss / pirate
  base) and dock (3 XP per dock). Cockpit right panel now shows `L#`
  next to each crew name.
- **Sci-fi pilot lines**: eight new pilot idle lines referring to the
  new ringed / multi-star / pink-cloud visuals from 0.6.1.
- **VERSION bump** — 0.6.1 → 0.6.2; offline bundle rebuilt (458 KB).

Still deferred for later 0.6.x:
- Player-to-NPC comms with template replies.
- In-canvas multi-line Lua editor.
- Full Reputation *Panel* on a dedicated screen (only the pinnable HUD
  strip is new here).
- Optional gunner-level crit bonus / pilot-level fuel sipping perks —
  today crew XP is display-only.

### 0.6.2 addendum — HiDPI + crisper text

- **HiDPI backing store**: `fit()` now sizes `canvas.width/height` to
  `CSS × devicePixelRatio` (capped at 2x) and sets an explicit CSS
  width/height so the element geometry is stable. `render()` calls
  `setTransform(dpr, 0, 0, dpr, 0, 0)` each frame so all draw code
  keeps writing in CSS-pixel coordinates — no other math changes.
- **Text hinting**: enable `textRendering = "geometricPrecision"`,
  disable kerning, and force `imageSmoothingEnabled = false` so
  drawImage-based glitch band copies stay pixel-aligned.
- **Mouse-steer**: updated the one non-render site that read
  `canvas.width` to use the new `_cssW/_cssH` fields so viewport
  math still matches the drawn cell grid.
- **Cap at 2×**: prevents fillText loops on 4K displays from doubling
  the paint cost for very little visible gain past 2× on ASCII glyphs.

## 0.6.3 — Crew XP perks + chatter

Turns the display-only crew levels from 0.6.2 into felt gameplay. Each
perk is a small, linear per-level scalar so a new hire is competent and a
veteran (L9) is noticeably better without breaking the balance curve.

- **Gunner XP**: +0.5%/level crit chance on auto-fire (up to +4.5%).
- **Tactical XP**: +0.5%/level crit chance on the tactical auto-fire path
  (stacks with the Gunner perk when both roles are staffed).
- **Pilot XP**: −1%/level fuel burn while thrusting (up to −9%), capped
  jointly with Engineer at a 0.50× floor so freebies stay bounded.
- **Engineer XP**: −1%/level fuel burn AND +2%/level shield regen (up to
  −9% fuel, +18% regen).
- **Tactical XP**: +2%/level shield regen (stacks with Engineer for a
  theoretical +36% at both L9).
- **Navigator XP**: +40u/level radar range (up to +360u), on top of the
  base +400u nav-crew bonus.
- **Merchant / Quartermaster XP**: +0.4%/level extra sell margin and
  −0.4%/level buy price per level of either. Stacks multiplicatively
  with the base merchant/QM crew bonuses.

New helper `roleLevel(p, role)` centralises the "on-crew level or 0"
lookup so future perks can hook in without duplicating the crew scan.

Also expanded chatter (~35 lines) across `pilot_idle`, `gunner_idle`,
and `engineer_idle` to reference the new "hours in the chair" flavor.

VERSION 0.6.2 → 0.6.3; offline bundle rebuilt (461.7 KB).

Still deferred for later 0.6.x:
- Player-to-NPC comms with template replies.
- In-canvas multi-line Lua editor.
- Full Reputation *Panel* on a dedicated screen (pinnable HUD strip only).

## 0.7.0 — Scripting completion & mod support (M2/M3/M4 slice)

The scripting stack ships as a first-class feature. Version-freeze target
hit; no incompatible schema changes past 0.7.0 without a real migration.

**Lua API expansions (M2 mutation surface + world/entity read)**

- `frontier.grant{ credits=?, fuel=?, xp=?, ore=? }` — batched player
  mutations; returns the resulting snapshot. Individual `frontier.addCredits`
  / `frontier.addFuel` remain for compatibility.
- `frontier.entities.list{ kind=?, faction=?, max=? }` and
  `frontier.entities.get(idx)` — read-only entity introspection with an
  optional filter (defaults to a 128-row cap; hard-clamped at 500 so a
  script can't tarpit a tick).
- `frontier.world.seed` (number) and `frontier.world.time()` (seconds
  since engine start).
- `frontier.chatter.add(kind, line)` — append a template line to any
  existing chatter pool (M4 content-pack surface). Returns `false` if
  the kind is unknown so mods can't fabricate new speaker categories
  without an engine update.
- `frontier.mods.installed()` — enumerate installed mods `{ id, name,
  enabled }` so a mod can gate features on peer presence.
- `LuaHostBridge` gained matching optional hooks: `addXp`, `addOre`,
  `worldTime`, `worldSeed`, `listEntities`, `getEntity`, `chatterAdd`,
  `installedMods`. All are optional so older bridge code keeps working.

**Mod bundles (M3 lite)**

- New **Options ▸ Mods** submenu. Each mod is `{ id, name, enabled,
  script }` persisted to `localStorage` under `voidwake.mods`.
- Menu rows: per-mod toggle (ENTER on the row flips enabled), `Add
  Mod... (paste JSON)`, `Reload All Mods`, `Clear All Mods`, `Back`.
- Add prompts for a JSON manifest and rejects duplicate ids.
- On `Reload All Mods` (or any script reload) enabled mod scripts are
  concatenated in id-sorted order into a single Lua source, each wrapped
  in `do ... end` so `local` declarations don't leak between mods, then
  loaded ahead of the user script.
- Save blobs carry `mods?: string[]` (the enabled mod ids at save
  time). `applyLoadedBlob` diffs against the currently-enabled set and
  posts warnings for missing / newly-added mods rather than silently
  desyncing. Older saves without the field still load cleanly.
- Zip / drag-drop file support and IndexedDB persistence remain
  deferred — the JSON-paste flow is small enough for text-only mods
  today and unblocks the whole M3 surface without shipping a file
  picker in this pass.

**Docs**

- `src/game/README.md ▸ Scripting` updated with the full 0.7.0 API
  table (grant, entities.list/get, world.seed/time, chatter.add,
  mods.installed) and a new **Mods** subsection covering the menu
  flow.
- `src/game/lua-samples.md` grew three new snippets (`entities.list`
  scan, `grant` reward payout, `chatter.add` content pack).
- `.lovable/plan.md` — this changelog.

**Version freeze**

- `VERSION = "0.7.0"`; offline bundle rebuilt (468.5 KB).
- The M3 milestones still open — file-picker / zip loading, IndexedDB
  persistence, per-mod permission gates, in-game Lua REPL, and the
  content-pack surfaces beyond chatter (weapons/hulls/species/etc.) —
  move to a future 0.7.x pass; 0.7.0 is the "scripting + mods
  minimally usable" cut-off.


### 0.7.0 addendum — modding polish

Same version tag (0.7.0); no schema bump, additive engine + API only.

- **Drag-drop file loader** on the game canvas. Drop `.json` → new mod
  entry via the same install path the menu uses. Drop `.lua` → replaces
  the user script (or, with Shift held, installs as a mod using the file
  basename as the id). Bypasses the browser `prompt()` 2 KB cap and works
  offline; feedback lands in the system log.
- **`frontier.entities.list{ radius=?, nearX=?, nearY=?, nearZ=? }`**
  optional filter. Defaults center to the player position when a radius
  is supplied and no center is given; skips entries with no `pos`. Fully
  additive — existing scripts keep working.
- **Per-mod error attribution.** `combinedScriptSource()` now builds a
  line-range → owner map, and a new `remapError` bridge on the Lua host
  rewrites `[string "..."]:LINE:` prefixes on load / run / hook errors to
  `[mod:<id>] ...` (or `[user script] ...`). Menu Status line now names
  which mod broke, not just which line.
- **Chatter pass** (~10 lines) across `patrol_tow`, `patrol_arrest`,
  `stranded_mayday`, and `stranded_thanks` to sell tow / arrest / mayday
  beats that were previously ambient-only.
- Offline bundle rebuilt (471.6 KB). Typecheck clean.

Still deferred for 0.7.x:
- Full Reputation *Panel* on a dedicated screen.
- Player-to-NPC comms with template replies.
- In-canvas multi-line Lua editor / REPL.
- IndexedDB / zip persistence for larger mod bundles.
- Content-pack surfaces beyond chatter (weapons / hulls / species).
