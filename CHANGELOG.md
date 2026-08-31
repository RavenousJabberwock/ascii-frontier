# Changelog

All notable changes to **ASCII Frontier**. Versions are the engine `VERSION`
constant in `src/game/voidwake.ts`. Dates are omitted deliberately — releases
are milestone-driven, not calendar-driven.

## 1.0.3 — 3D Stereo Engine

- New `Options ▸ 3D` menu: mode (off / anaglyph red-cyan, green-magenta,
  amber-blue), depth strength, and convergence distance.
- World cells now carry a camera-space depth stamp; the paint pass renders two
  tinted eye images with depth-derived horizontal disparity. Distant sky sits at
  maximum uncrossed parallax, objects at the convergence plane sit on the glass.
- HUD, Comms, menus, and overlays stay on the screen plane in full colour.
- Glowing glyphs keep their baked halo in 3D via per-eye cached glow tiles.
- The mode registry (`RENDER_3D_MODES`) is renderer-agnostic, so side-by-side
  and interlaced outputs can be added later without touching the pipeline.

## 1.0.2.1 — Point Defence Control


A small patch on top of 1.0.2.

- **Point Defence mode.** New `Options ▸ Gameplay ▸ Point Defence` cycles
  `auto` / `target` / `off`. `auto` keeps the 1.0.2 nearest-hostile behaviour,
  `target` makes every mount favour your tracked contact while it is a hostile
  inside 1100u, and `off` holds the mounts without unbolting the refit.
- **Scripting.** New read surface `frontier.turrets()` →
  `{ mounts, max, range, cooldown, damage, mode }`.
- Saves and mods from 1.0.2 load unchanged; the option defaults to `auto`.

## 1.0.2 — Turret Mounts & Duty Rotation
Two long-deferred items land: a refit that does something other than widen a
stat, and a fleet that can keep itself busy across several kinds of work.

- **Point-defence mounts.** A sixth Refit Bay line, three levels deep. Each level
  bolts an autonomous turret to your frame: it ignores where your nose is
  pointed, takes the nearest hostile inside 1100u, and fires every 1.9 seconds
  for half your mounted weapon's damage. Turret fire never crits — it is steady
  chip damage while you line up the real shot.
- **Duty rotation.** A berthed frame can go on a rotating roster (`Rotate …` in
  the Hangar). It works five pay periods of its current duty, then signs its
  hands over to the next duty in the cycle for half the usual fee, paid out of
  its own account before your wallet. Standing down for fuel, damage or a full
  account takes the frame off the roster and says so; a change-over it cannot
  afford stalls with a note instead of nagging every period.
- **Scripting.** New hooks `onTurretFired` and `onFleetRotate`. `frontier.fleet()`
  rows now carry `rotating`, `periodsOnDuty` and `rotatePeriods`, and
  `onFleetIncome` reports `periodsOnDuty` / `rotating`.

## 1.0.1 — Wider Contract Board

Three new job families join the eight classics, so a station board is far less
likely to hand you three variations on "shoot that raider".

- **Convoy escort (`convoy`).** A named friendly hull is routed to a specific
  dock (`Entity.convoyToId` overrides its idle station-seeking AI) and you fly
  shotgun. The job pays on arrival, fails if the ward is destroyed, and lapses
  with a small Guild standing hit if you leave it more than 6000u behind for
  45 seconds.
- **Distress response (`defend`).** A civilian hull calls mayday over comms; the
  attacker is spawned next to it on the contract's first tick (never before, so
  declined offers leave nothing behind) and hails you itself. Close it by killing
  the raider — the normal kill path handles the credit — or by driving it more
  than 5000u off the ward. Losing the ward fails the job.
- **Supply run (`supply`).** Sell a set number of units of one clean commodity at
  a named dock. Both the per-commodity sell row and `[SELL ALL]` credit progress,
  so partial sales count and the tracker shows units sold plus units still in
  the hold.
- Contract Log filters and sorting cover the new kinds (`combat` includes
  defend, `freight` includes supply, `people` includes convoy), the pinned HUD
  tracker renders per-kind progress for each, and the faction houses hand out
  the ones that fit their style — Patrol Command favours distress calls, the
  Traders' Guild favours convoys and supply runs.

## 1.0.0 — Prime Time
The first stable release. No new subsystems — this milestone closes out two
long-standing deferments, cleans the last lint/type debt out of the tree, and
locks the documentation set.

- **Officer role affinity.** A seconded officer's earnings now depend on whether
  their trade fits the work. `FLEET_OFFICER_AFFINITY` adds a per-role, per-duty
  bonus on top of the flat +15% and the +4%/level: Tactical and Gunner are worth
  most on an escort patrol, Merchant and Quartermaster on a freight run, an
  Engineer on prospecting. No role is ever worse than contracted hands.
- **Rival houses.** Contract standing is no longer free money. `RIVAL_HOUSES`
  pairs each issuing house with the ones it is at odds with, and a paid faction
  contract now lifts the issuer *and* costs you half that amount with each of
  their rivals. The payout log line names who took note.
- **Clean tree.** Zero TypeScript errors, zero lint errors (the engine's dense,
  hand-aligned formatting is now explicitly out of prettier's scope so `bun run
  lint` is meaningful again), stale `eslint-disable` directives and dead locals
  removed from the AI tick.
- **Docs.** `README.md`, `GUIDE.md`, `MANUAL.md`, `src/game/README.md` and
  `src/game/lua-samples.md` reviewed end to end for a 1.0 reader; offline bundle
  regenerated.

## Save compatibility
Saves are shape-tolerant and unversioned at load: a pre-1.0 save loads into
1.0.0 with the new fields defaulted. Exported `.json` saves remain readable.

## 0.9.8 — Fleet Command (Phase 3)
- **Berth rent.** A parked frame now costs you something to keep. Each pay
  period every berthed hull accrues rent scaled to its list price; the bill is
  drawn from the frame's own duty account first and only falls into `rentOwed`
  arrears when the account is empty. `Collect …` settles arrears off the top,
  `Rent …` pays them outright, selling a frame nets them off the price, and the
  dockmaster will not release a frame with rent outstanding.
- **Seconded officers.** `Officer …` seconds a named crewmate from your roster
  to a berthed frame. You lose their perk while they are away, but the frame
  grosses +15–51% (by their level), pays 30% less in wages, and the officer
  earns crew XP on duty. Recall them the same way; they rejoin your crew if a
  bunk is free, and they come home automatically when you take the frame over.
- **Fleet presence.** A frame out on duty now physically shows up as a friendly
  contact when you are within 9,000u of its home dock, flying wing/escort AI,
  and despawns again beyond 15,000u.
- **Scripting.** New hooks `onFleetRent`, `onFleetOfficer`, `onFleetPresence`.
  `frontier.fleet()` rows now also carry `rentPerPeriod`, `rentOwed`, `officer`
  (`name`/`role`/`level`) and `present`.

## 0.9.7 — Working Fleets (Phase 2)
- **Standing duties.** A frame berthed in a hangar can now be crewed and put to
  work while you fly something else. Three duties: **Freight run** (pays off the
  hold), **Escort patrol** (pays off armament and structure) and **Prospecting**
  (pays off hold plus mining gear). Signing hands on costs a one-off fee; each
  pay period of real time the frame grosses a rate derived from its own hull,
  hold, guns and refits, pays its hands, burns its own fuel and rolls once
  against the duty's risk.
- **Its own account.** Net pay banks on the frame (up to 24,000cr) rather than
  landing in your wallet. `Collect …` pays it out, and taking the frame over
  with `Fly …` or selling it pays out whatever is banked.
- **Nothing is lost off-screen.** A duty that runs the tank dry, gets beaten
  below 35% structure, or fills its account stands *itself* down and files a
  Comms line. Damage never destroys a working frame; insurance halves the knock.
- **Hangar services.** Per-frame `Repair` (9cr/point), `Refuel` (3cr/unit),
  `Insure` (per-hull quote at 15% of list) and `Recall` — a 600cr ferry that
  brings a frame parked at another dock to the one you are standing in. Swapping
  now requires the frame to be berthed where you are, so the recall closes the
  0.9.6 remote-hangar gap.
- **Character Sheet** shows each berthed frame's duty and banked pay.
- **Scripting.** New hooks `onFleetDuty`, `onFleetIncome`, `onFleetIncident`,
  and `frontier.fleet()` rows now carry `duty`, `earned`, `netPerPeriod`,
  `grossPerPeriod` and `note`.

## 0.9.6 — Refits & Fleets (Phase 1)
- **Hull refits**: the Shipyard now has a **Refit Bay**. Five permanent upgrade
  lines — structural bracing, emitter tuning, hold restructure, thrust remap and
  a deck partition — each go three levels deep and add +30 hull, +25 shield,
  +8 cargo, +6 speed or +1 berth per level. Prices scale with the frame you're
  refitting and with each step taken, and Merchant/Quartermaster haggling
  applies. Refits belong to the hull, not the pilot: they follow the frame into
  a hangar and are lost if you trade it in.
- **Fleet hangar**: you can now own more than one ship. The yard has a purchase
  mode toggle — TRADE IN (as before) or KEEP, which berths the frame you flew in
  on for an 800cr fee instead of selling it back. Up to three frames can sit in
  hangars, each keeping its own modules, armament, refits, insurance and battle
  damage. Taking one back out costs 300cr and runs the same cargo/berth fit
  checks as a trade-in; selling a berthed frame pays the usual 55% of list.
- **Character Sheet** lists your fitted refits and everything berthed, with the
  station each frame is parked at.
- **Scripting**: new `onHullRefit`, `onFleetStored`, `onFleetSwapped` and
  `onFleetSold` hooks, plus `frontier.fleet()` — the active frame and every
  hangar frame with refit levels, caps and condition.

## 0.9.5 — Faction Contracts & Collision Fast Path
- **Faction contracts**: every contract now remembers who issued it. Station
  boards and comms work offers pull a house style — Federal writs, Patrol
  taskings, Guild consignments, Reach survey orders and no-questions Den jobs —
  which re-words the brief, biases the job kinds on offer (Federation leans
  bounty/escort/scan, the Guild leans freight/passenger, the Den leans wetwork)
  and scales the reward from 1.05x (Guild) to 1.4x (pirate).
- **Standing pays out**: settling a faction-issued contract now improves your
  standing with the issuing house (+2, or +4 for priority work), on top of the
  credits, no matter where you cash it in.
- **Performance**: the bullet collision loops — the densest pairwise test in
  the engine — no longer allocate a vector and call `hypot` per candidate. A new
  per-axis reject rules out the overwhelming majority of pairs with three
  comparisons, which cuts GC churn noticeably in heavy firefights.
- **Scripting**: `faction` and `issuer` are now on `onMissionAccepted`,
  `onMissionCompleted`, `onHailWork` offers and `frontier.contracts()` rows.
  Ships with a sample script (`src/game/samples/faction-ledger.lua`) and a
  sample installable mod (`src/game/samples/faction-broker.mod.json`).

## 0.9.4 — Comms Portraits & Reputation-Gated Work
- **Comms portraits**: hailing now shows an animated ASCII portrait of the
  contact, keyed to their faction and disposition, that only moves while they
  are actually speaking and takes its colour from the channel's mood.
- **Voices**: each reply plays a short blip run with a per-hull register —
  lower and rougher for hostiles, square for dock control.
- **Work over comms**: a new `Ask about work ▸` branch on stations, friendly
  hulls and patrol/federation hulls. Ordinary jobs need better than Wary
  standing; priority contracts (1.6–2.1x pay) need Friendly standing and rank
  Competent or better. Clearing the gate opens the usual contract board.
- **Scripting**: new `onHailWork` hook reporting the gate cleared and the
  offers put on the board.

## 0.9.3 — Conversation Trees & Depth Bucket Sort
- **Comms**: hailing a contact now opens a branching conversation instead of a
  single menu. Branch into local news, deals (cargo valuations, fuel, asking a
  friendly hull to intercept a hostile) or law business (record readback,
  restitution). Hostiles can be bribed or taunted, and taunting can commit them
  to an attack run.
- **Mood**: every channel tracks a mood that shifts with your choices, gates
  fuel/bribe/escort outcomes, and picks the sign-off you get when you hang up.
- **Chatter**: 15 new reply pools for the new nodes and sign-off tones.
- **Renderer**: the per-frame depth ordering uses a 256-band bucket sort instead
  of a comparison sort once a frame projects more than 48 bodies.
- **Scripting**: `onHailTopic` and `onHailClosed` hooks, plus `frontier.hail()`
  and `frontier.disposition(id)`.

## 0.9.2 — Spatial Grid, Glyph Atlas & Scripting Completion
- **AI broad phase**: a uniform 1024u spatial grid replaces the full-array scans
  that every active ship, pirate station turret and wing escort ran each frame
  to find a target. Busy sectors no longer scale quadratically with traffic.
- **Renderer**: glow cells are stamped from a baked offscreen glyph atlas
  instead of re-rasterising `shadowBlur` per cell.
- **FPS overlay**: now also shows entity count and AI-indexed body count.
- **Scripting**: `frontier.crew()`, `frontier.cargo()`, `frontier.record()`,
  `frontier.bookmarks()`, `frontier.reputation()`, `frontier.perf()` and
  `frontier.unbookmark(name)`.
- **Hooks**: `onBookmarkRemoved`, `onCargoChanged`, `onCrewPaid`.

## 0.9.1 — Performance Pass & Navigation Scripting
- **Renderer**: the per-kind sprite-radius table is no longer rebuilt every
  frame, and entities whose sprite cannot touch the world pane are rejected
  before they cost a sort slot or a draw pass. Dense sectors (rings, asteroid
  belts, station clusters) hold frame time much better.
- **Physics**: entity integration is done in place instead of allocating two
  Vec3 objects per entity per frame, which removes the GC sawtooth that showed
  up as stutter near busy space.
- **Bug — distant ships flew at double speed**: `tickAI`'s far-distance early
  return integrated position itself, then the caller integrated it again. Over
  a long session that let far traffic drift out of its home sectors.
- **Bug — stale entity index**: `byId()` invalidated its cache on entity count
  alone, so a frame that removed one entity and spawned another (a kill plus
  its loot) could hand back a destroyed ship. It now also watches array
  identity.
- **Collision broad phase**: ramming, dock bumps, corona scooping and
  black-hole shear now share one squared-distance reject, cutting the frame's
  hottest loop down to nearby contacts.
- Remaining linear `id` scans in the hot path replaced with the `byId()` index,
  and near-star lookups replaced with an allocation-free `nearestOfKind()`.
- **Scripting**: `frontier.target()`, `frontier.setTarget(id)`,
  `frontier.screen()`, `frontier.bookmark(name, x, y, z)` and
  `frontier.hooks()` — enough for a mod to build a navigation assistant and to
  feature-detect hooks instead of hard-coding the table.
- **Title tips**: expanded from 12 to ~40, now covering every system added
  since 0.8.0 (bulletin, contract log, bounties, holdings, wings, salvage,
  insurance, crew levels, mods).

## 0.9.0 — Frontier Events
- **Frontier events**: timed, located situations (Refinery Boom, Food Shortage,
  Tech Embargo, Relic Rush, Pirate Blockade, Fuel Crisis, Medical Quarantine,
  War Muster, Cargo Glut, Salvage Call) that really move prices at the docks
  they hit — station-scoped or faction-wide — for 5–18 minutes each, up to
  three live at once.
- Blockades and musters pull raiders to the anchor; crises push fuel and ore
  prices; gluts collapse them. Shifts are baked into the live market rows and
  reversed cleanly on expiry, and they survive a market-day rotation.
- **Frontier Bulletin** overlay (`Y`, rebindable): live advisories nearest
  first with distance, time remaining, what changed and what to do about it.
  `ENTER` targets the affected dock, `N` bookmarks it.
- Comms wire announces every event start, end and arrival inside the zone; new
  crew (`crew_ctx_event`) and NPC (`npc_ctx_event`) situational chatter pools.
- Scripting: new `onFrontierEvent` hook (`phase` = `start` | `end`) and
  read-only `frontier.events()`. Live events ride along in saves.

## 0.8.9 — Hull Classes, Station Archetypes & Rock Mineralogy
- 15 hull classes (Dart, Corsair, Marauder, Reaver, Dreadnought, Courier,
  Frigate, Escort, Cutter, Cruiser, Interdictor, Hauler, Freighter,
  Prospector, Liner) with 5x3 wide silhouettes for big hulls up close and
  per-ship blinking nav lights.
- Seven station structural archetypes (torus ring, spindle, pod cluster,
  drydock, foundry stack, sensor array, hive warren) overprinted around the
  faction stamp, plus blinking docking beacons.
- Asteroid mineralogy: C-type, S-type, M-type metallic, volatile ice and rare
  crystalline bodies, each with its own palette and glyph set.
- Target panel names the contact's hull class / station archetype / mineral
  class instead of the bare entity kind.
- Eight new scripting hooks: `onEntitySpawned`, `onPlayerDamaged`,
  `onScreenChange`, `onOreMined`, `onSalvageCollected`, `onMarketCycle`,
  `onReputationChange`, `onCrewLevelUp`; `shipClass` / `stationClass` /
  `rockClass` exposed on entity queries.

## 0.8.8 — Log Ergonomics, Manual Lanes & Hook Audit
- Contract Log: `S` cycles sort (accepted order / reward / deadline / kind),
  `F` cycles filter (all / ready / combat / freight / people / timed).
- Player-set freight lanes: pick the partner dock and/or the commodity on an
  owned station's Build page; either end can stay on **Auto**.
- Scripting hook audit — ten new hooks: `onMissionCompleted`, `onCrewHired`,
  `onCrewLeft`, `onRankUp`, `onModuleInstalled`, `onStationFounded`,
  `onWormholeJump`, `onPlayerDestroyed`, `onStowawayRevealed`,
  `onTradeRouteClosed`.
- First published `CHANGELOG.md`; hook table, MANUAL and plan refreshed.
- ~30 new situational chatter lines (contract load, lane reports, dealers).

## 0.8.7 — Contract Log & Station Trade Routes
- Multi-contract log (max 3) with tracked/pinned job, `U` to open,
  `ENTER` to track, `X` to abandon.
- Tier 3+ owned stations broker up to two automated freight lanes paying
  passive treasury income.
- `byId()` entity index replaces ~39 linear scans in hot paths.
- Hooks `onMissionAccepted`, `onMissionAbandoned`, `onTradeRouteEstablished`;
  `frontier.contracts()` and `frontier.holdings()` getters.

## 0.8.6 — Wing Escorts & Waypoint Markers
- Hireable wing escorts (max 2) with formation flying and hostile engagement.
- Nav Log bookmarks paint as in-world `◇` markers with live distance.
- Hooks `onWingHired`, `onWingLost`.

## 0.8.5 — Nav Log & Pilot's Record
- `N` bookmarks a target/position, `V` opens an 8-slot Nav Log.
- Character Sheet gains a lifetime Pilot's Record (distance, docks, ore, pay).
- Hook `onBookmarkAdded`.

## 0.8.4 — Bounty Office & Market Polish
- Bounty Offices with tier-based warrants and fine expungement.
- `[SELL ALL]` in markets, partial refuelling.
- Hooks `onBountyAccepted`, `onBountyClaimed`.

## 0.8.3 — Dealer Patter & Hull Insurance
- ~70 condition-sensitive used-ship dealer lines near shipyards.
- Hull insurance (15% of hull value) waives rescue fees and pays out cargo.

## 0.8.2 — Shipyard & Player's Guide
- Shipyards with rotating hull inventory, trade-ins and module transfer.
- `GUIDE.md` player's guide including minimum system specs.

## 0.8.1 — Situational NPC Comms
- `npcContextBuckets`: NPC barks keyed to damage, flight, cargo and phenomena.
- 12 new NPC and 9 new crew situational pools.

## 0.8.0 — Comms, Contraband Counterplay & Living Holdings
- `H` hails a target within 4000u; disposition-keyed replies.
- Shielded Hold and Bribe Encoder modules; interactive customs scans.
- Owned stations earn real-time income with capacity caps.
- Hooks `onPlayerHail`, `onCustomsScan`, `onShipHullChange`.

## 0.7.9 — Living Economy & Station Identity
- Faction contraband bans, trade route hints, NPC haulers that move prices.
- Station renaming and silhouette customisation.

## 0.7.8 — Exotic Stars, Lensing & Propulsion
- Black hole lensing, pulsars and magnetars; distance-gated solar flares.
- `engine-efficiency`, `overdrive-coil`, `solar-sail-engine` modules.
- Expanded species / hair / eye / skin customisation.
- Renderer optimisation pass (memoised projection, viewport clipping) and
  `MANUAL.md`.

## 0.7.7 — Animate Coronas, Planet Surfaces & New SFX
- Animated flares, planet visual categories (giants, terran, cratered).
- Flare rumbles, sonar chirps, rank-up fanfares.

## 0.7.6 — Skybox Variety
- Stellar corona spikes, comet ion tails, faction station silhouettes.

## 0.7.5 — Salvage, Fragmentation & Upside-Down Fixes
- Wreck salvage crates, asteroid chipping with conserved ore.
- Fixed target-indicator orientation while inverted; quests redirect to a
  station once the objective dies.

## 0.7.4 — Stowaways & Pets
- 5% stowaway chance (berth reads OUT OF ORDER until discovered).
- 45-entry crew pet table shown on the Character Sheet.

## 0.7.3 — Contract Board
- Multi-choice contract board at game start and on docking; quests optional.

## 0.7.2 — Compact Markets
- Compact buy/sell commodity UI, faction-relevant filters.
- Lua hooks for trading, passengers and station upgrades.

## 0.7.1 — Trade, Passengers & Player Stations
- 18 commodities with faction price bias and 10-minute market cycles.
- Passenger contracts with berths and deadlines.
- Station Core: found and grow your own station (T0–T5).
- Nine new modules including fuel scoop and mining upgrades.

## 0.7.0 — Modding & Scripting
- Options ▸ Mods UI: enable/disable, JSON paste, drag-drop `.lua`.
- Lua API `frontier.grant`, `.entities`, `.world`, `.chatter`, `.mods`,
  `.economy`; per-mod error attribution; in-canvas script editor.
- Character Sheet (`C`) with ASCII portraits, ship silhouettes and modules.

## 0.6.x — Rendering, Rep & Crew XP
- Crew XP/levels (L0–L9) with gameplay perks; reputation panel (`R`).
- HiDPI backing store, UI overlap fixes, mission-log word wrap.
- Planetary rings, varied planet palettes and diameters.
- Afterburner/Supercruise speed HUD tags with micro-glitch effects.
- Autosave quota recovery (drops chatter history on retry).

## 0.5.x — Comms, Lua Foundations & Deep Space
- Tabbed Comms panel (All / Crew / External / Sys) with buffer, wrap and
  size options; clickable tabs and collapse.
- Lua host on fengari-web with sandbox, hook dispatch and script editor.
- Crew roles: Navigator, Quartermaster, Recruiter, Tactical; morale, wages,
  walkouts, banter matrix.
- Colony planets with trade, salvageable debris, critical hits,
  Roche-limit deformation, nebulae, wormholes, galactic core and disk.
- Deep Space halo at 10x world radius with sparse rogue contacts.
- How To Play overlay; save timestamps and JSON import/export.

## 0.4.0 — Comms Overhaul
- System messages and chatter unified into a scrolling, tabbed Comms panel
  with ambient ship-to-ship and ship-to-station banter.

## Earlier
- Space Patrol (SPD) police ships with towing and arrest behaviour.
- Glitch effects for Thargoids and hull damage; scanline and HUD options.
- Core engine: procedural universe, ASCII renderer, flight model, combat,
  mining, docking, missions and save slots.
