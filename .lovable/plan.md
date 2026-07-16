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






