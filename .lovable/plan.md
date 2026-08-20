# 1.0.0 — Prime Time

Ships as **1.0.0** — the first stable release.

- **Officer role affinity** (closes 0.9.8's deferment). `FLEET_OFFICER_AFFINITY`
  maps each `CrewRole` to a per-duty bonus, read by `fleetOfficerAffinity(f)` and
  folded into `fleetOfficerGrossMul(f)` alongside the flat +15% and +4%/level.
  Tactical/Gunner peak on `patrol`, Merchant/Quartermaster on `freight`,
  Engineer on `prospect`; every role is >= 0, so seconding is never a downgrade.
- **Rival houses** (closes 0.9.5's deferment). `RIVAL_HOUSES` +
  `adjustRepWithRivals(p, faction, delta)` apply the issuer gain and a
  half-magnitude loss to each rival in one call. Wired into the contract payout
  path; the log line names the rivals that reacted.
- **Clean tree.** Dead locals removed from the `ufo`/`thargoid` AI branches,
  five stale `eslint-disable` directives dropped, `src/game/voidwake.ts` and
  `dist-offline` added to `.prettierignore` (the engine is hand-aligned on
  purpose), everything else prettier-formatted. `tsgo --noEmit` and `bun run
  lint` are both clean; only shadcn `react-refresh` advisories remain.
- **Docs.** CHANGELOG 1.0.0 entry with a save-compatibility note, MANUAL fleet
  and reputation sections updated, engine README hook/API tables current.

## Deferred past 1.0

- Multi-frame duty *chaining* (a frame that rotates duties on its own).
- Refit slots beyond the five stats (weapon hardpoints, module bays).
- Player-to-NPC free-text comms (templated replies only today).

# 0.9.8 — Fleet Command (Phase 3)

Ships as **0.9.8**.

- **Berth rent.** `FleetShip` gains `rentOwed`. `fleetRentPerPeriod(p, f)` scales
  the per-period bill off the hull's list price; `tickFleetDuty` charges every
  berthed frame each `FLEET_PAY_PERIOD`, drawing from `earned` first and pushing
  the remainder into `rentOwed`. `fleetCollect` settles arrears off the top,
  `fleetPayRent` clears them from the wallet, `fleetSell` nets them off the
  payout, and `fleetSwap` refuses while rent is outstanding.
- **Seconded officers.** `FleetShip.officer` holds a `CrewMember` lifted out of
  `p.crew` (so their perks stop applying to the player). `fleetOfficerGrossMul`
  gives +15% +4%/level gross, wages drop 30%, and the officer accrues crew XP
  each settled period. `fleetCycleOfficer` toggles seconding/recalling; recall
  needs a free berth, and a takeover or sale brings them home.
- **Fleet presence.** `presenceId` binds a live friendly entity (faction
  `"fleet"`, wing/escort AI, own hull tint) spawned when the pilot is inside
  9,000u of the frame's home dock and despawned past 15,000u.
- **Scripting.** `onFleetRent`, `onFleetOfficer`, `onFleetPresence`; plus
  `rentPerPeriod`, `rentOwed`, `officer`, `present` on `frontier.fleet()`.

## Deferred

- Multi-frame duty *chaining* (a frame that rotates between duties on its own).
- Officer-specific duty bonuses per role (any role currently gives the same
  gross/wage effect scaled only by level).
- Refit slots beyond the five stats (weapon hardpoints, module bays).

# 0.9.7 — Working Fleets (Phase 2)

Ships as **0.9.7**.

- **Standing duties.** `FleetShip` gains `duty` / `dutySinceMs` / `earned` /
  `note`. `FLEET_DUTY_SPECS` carries three duties — `freight`, `patrol`,
  `prospect` — each with a sign-on `hire`, a per-period `wage`, `fuel` burn,
  `risk` chance, `dmg` band and a `gross(caps, frame)` closure so the rate is
  derived from the frame's own hold, armament, structure and refits rather than
  from the pilot.
- **`tickFleetDuty(dt)`** runs beside `tickStationIncome` and settles a period
  every `FLEET_PAY_PERIOD` (60s): net (gross - wage) banks on the frame up to
  `FLEET_EARN_CAP`, fuel burns, and one risk roll may cost structure (halved by
  a policy). Stand-down conditions — dry tank, hull at or below
  `FLEET_STANDDOWN` (35%) of `fleetHullMax`, or a full account — set `duty` back
  to idle and post a Comms line. A working frame is never destroyed off-screen.
- **Hangar services.** `fleetCycleDuty`, `fleetCollect`, `fleetRepair` (9cr per
  point), `fleetRefuel` (3cr per unit, tank from `fleetFuelMax`), `fleetInsure`
  (`fleetInsuranceQuote`, 15% of that hull's list) and `fleetRecall`
  (`FLEET_RECALL_FEE` 600cr ferry). `fleetSwap` now requires the frame to be
  berthed at the dock you are in and refuses while a duty is running; it pays
  out any banked credits on takeover. `fleetSell` refuses a working frame and
  adds the banked balance to the payout.
- **Scripting.** `onFleetDuty`, `onFleetIncome`, `onFleetIncident`, plus `duty`,
  `earned`, `netPerPeriod`, `grossPerPeriod`, `note` on `frontier.fleet()`.

## Deferred

- ~~Working frames as *visible* AI hulls in the world~~ — shipped in 0.9.8 as
  fleet presence entities.
- ~~Assigning named crew from your roster to a duty~~ — shipped in 0.9.8 as
  seconded officers.
- ~~Hangar rent over time~~ — shipped in 0.9.8 as berth rent + arrears.
- Refit slots beyond the five stats (weapon hardpoints, module bays).

# 0.9.6 — Refits & Fleets (Phase 1)

Ships as **0.9.6**.

- **Hull refits.** `PlayerShip.refit` holds a per-stat level map
  (`hull`/`shield`/`cargo`/`speed`/`berths`, 0..`REFIT_MAX` = 3). `REFIT_SPECS`
  carries the per-level amount (+30 hull, +25 shield, +8 cargo, +6 spd, +1
  berth) and the flavour text. `refitBonus()` is read by `recomputeShipStats`,
  `effectiveCargoMax` and `effectiveCrewMax`, so refits stack on top of the
  hull x species x module maths instead of replacing any of it and survive a
  module install, a load, or a stat recompute. `refitPrice()` scales with the
  frame's list price and the step being bought (12% x next level, min 400cr) and
  honours Merchant/Quartermaster haggling.
- **Refit Bay page** under the Shipyard: one row per stat with a `[■■·]` level
  bar, the next step's price and what it adds. Refits belong to the *frame*, so
  they travel into the hangar with it and are lost on a trade-in (the trade-in
  log line now says so).
- **Fleet hangar (groundwork for owning multiple ships).** `PlayerState.fleet`
  holds up to `FLEET_MAX` = 3 `FleetShip` records — hull id, hull/shield/fuel
  condition, both weapon mounts, modules, refits and the insurance flag, plus
  where and when it was parked.
- **Yard purchase mode.** A toggle row on the Shipyard page switches between
  TRADE IN (pre-0.9.6 behaviour) and KEEP. In KEEP mode `shipyardOffers()` drops
  the trade-in credit and adds an 800cr berth fee, and `buyHull()` snapshots the
  old frame into the hangar; the new frame then comes out bare with a full tank.
  KEEP silently falls back to a trade-in when the hangar is full.
- **Hangar page.** Per stored frame: `Fly …` (300cr transfer) and `Sell …` (the
  usual 55% of list). A swap runs the same cargo and berth fit checks as a
  trade-in against caps derived from the stored frame's own hull, modules and
  refits, and it preserves that frame's hull/shield/fuel condition.
- **Character Sheet** now lists fitted refits and hangar contents.
- **Scripting.** New hooks `onHullRefit`, `onFleetStored`, `onFleetSwapped`,
  `onFleetSold`, and a `frontier.fleet()` read surface returning the active
  frame (flagged `active = true`) plus every berthed frame with its refit levels.

## Deferred

- ~~Fleet ships doing useful work rather than sitting in a hangar~~ — shipped in
  0.9.7 as standing duties (still off-screen workers, not spawned escorts).
- ~~Remote hangar access~~ — shipped in 0.9.7 as `Recall` (600cr ferry).
- ~~Per-hull insurance quotes for stored frames~~ — shipped in 0.9.7. Hangar rent
  over time remains deferred.
- Refit *slots* beyond the five stats (weapon hardpoint count, module bays).

# 0.9.5 — Faction Contracts & Collision Fast Path

Ships as **0.9.5**.

- **Faction contract flavour** (closes the 0.9.4 deferment). `FACTION_CONTRACTS`
  maps each issuing faction to a house style: `issuer` label, `rewardMul`,
  a `prefers` list of `MissionKind`s picked with `bias` probability, and a
  `brief()` wording wrapper. `generateMission(faction?)` wraps the untouched
  `rawMission(forced?)` core, so with no faction it behaves exactly like the
  pre-0.9.5 generator (the starter board has no issuer). Passenger jobs are
  filtered out of the preference pool when the ship has no berths.
  Styles: Federal Office 1.15x (bounty/escort/scan), Patrol Command 1.1x
  (bounty/destroy/rescue), Traders' Guild 1.05x (deliver/haul/passenger),
  Aquila Reach 1.25x (scan/rescue/escort), the Den 1.4x (destroy/haul/bounty).
- **Wired callsites.** Station contract boards and the `work ▸` hail branch both
  pass the issuing hull's faction; `premiumMission(faction?)` forwards it so
  priority work keeps its house flavour on top of the 1.6–2.1x scaling.
- **Standing on payout.** Settling a contract with a `faction` adjusts rep with
  that house (+2, +4 for `PRIORITY:`) and posts a log line naming the issuer.
  Cashing in at a rival dock still counts.
- **Collision fast path.** `V.d2` and a module-level `within(a, b, r)` replace
  `V.len(V.sub(a, b)) < r` in the three bullet collision loops. Three axis
  comparisons reject almost every pair before any multiply, removing a Vec3
  allocation and a `hypot` per bullet-per-candidate-per-frame.
- **Scripting.** `faction` / `issuer` added to `onMissionAccepted`,
  `onMissionCompleted`, `onHailWork` offers and `frontier.contracts()` rows.
  Samples: `src/game/samples/faction-ledger.lua` (user script) and
  `src/game/samples/faction-broker.mod.json` (script + chatter mod bundle).

## Deferred

- Rival-house penalty on payout (taking Den work does not yet *cost* Federation
  standing directly — only the existing crime/retaliation systems do that).
- Faction-specific mission *targets* (a Guild consignment can still send you to
  a rival dock).

# 0.9.4 — Comms Portraits & Reputation-Gated Work

Ships as **0.9.4**.

- **Portrait frames on the comms screen.** The hail screen now carries a
  7x5 portrait of whoever is on the other end, top-right. The crest row is
  keyed to faction (pirate / patrol / federation / guild / aquila, with a
  structural frame for docks) and the eye glyph to disposition. `_hail.speakUntil`
  is stamped by `hailReply()`, and the mouth frame only alternates while that
  window is open — the face holds shut and shows `...` when the channel is
  quiet, `((•))` while the far end is mid-line. Frame colour follows the mood
  band, so a souring channel reads at a glance. The transcript now wraps to the
  pane left of the portrait instead of running under it.
- **Voiced replies (`hailVoice`).** Every reply plays a short blip run whose
  register is hashed off the speaker's name (so a given hull always sounds the
  same), lower and rougher for hostiles, square for dock control. Syllable count
  scales with line length. Routed through `beep`, so Audio options gate it like
  any other cue.
- **Reputation-gated work (`work ▸`).** A new root branch on stations, friendly
  hulls and law hulls. `hailWorkGate()` reads standing with *that hull's*
  faction plus the live mood: `casual` work needs better than Wary, `priority`
  work needs Friendly standing **and** rank Competent or above. The option
  labels state the gate up front rather than refusing after the fact. Clearing
  the gate closes the channel straight into the ordinary contract board, so
  accept/skip/log-full behaviour is shared with docking; a refusal costs a point
  of mood and leaves the branch open. Honours **Options ▸ Quest Offers: OFF**
  and `CONTRACT_MAX`.
- **`premiumMission()`.** Priority work is the standard generator with the
  reward scaled 1.6–2.1x and a `PRIORITY:` flag on the description, so contract
  log, payout, sorting, hooks and Lua all treat it as a normal mission.
- **Scripting.** New `onHailWork` hook (`{ targetId, target, priority, standing,
  rank, offers[] }`) fires the moment work is put on the board.

## Deferred

- ~~Faction-specific contract flavour~~ — shipped in 0.9.5.

# 0.9.3 — Conversation Trees & Depth Bucket Sort

Ships as **0.9.3**.

- **Conversation trees (`_hail`).** The hail screen is no longer a flat option
  list. It carries a `node` (`root` / `news` / `deal` / `law`) plus a `mood`
  score (-3..+3) seeded from the target's disposition. Options are rebuilt after
  every choice, so branches open and close as the exchange moves:
  - `news ▸` raider activity / market word / patrol movements. A cold channel
    starts refusing to answer.
  - `deal ▸` ask what they'd pay for your most valuable cargo (real station
    `sell` price when hailing a dock, base price ± spread otherwise, nudged by
    mood), request an emergency fuel transfer, or ask a friendly/law hull to
    intercept the nearest hostile (retargets their AI for real).
  - `law ▸` record readback (flags when federation *and* guild standing are
    <= -15) and the existing 500cr restitution.
  - Hostiles gain **bribe** (ask scales with credits + kills, success scales
    with mood) and **taunt** (45% smug reply, otherwise the ship commits to an
    attack run via the same `hostileUntil` window `tickAI` hunts on).
  - Closing the channel plays a sign-off keyed to the final mood band, and the
    header shows a mood meter and the current branch path.
- **Chatter.** 15 new pools for the tree nodes and the three sign-off tones.
- **Depth bucket sort.** `renderPlaying()`'s far→near ordering was a comparison
  sort over every projected body. Frames with more than 48 projected entities
  now bucket into 256 log-spaced depth bands and concatenate far→near: O(n) with
  no comparator calls, and ordering inside a band is visually indistinguishable.
- **Scripting.** `onHailTopic` (fires for every node walked, with `topic`,
  `node`, `mood`, `disposition`) and `onHailClosed` (`mood`, `tone`).
  `onPlayerHail` still fires for compatibility. New read surfaces
  `frontier.hail()` (live channel: target, node, mood, tone, option ids,
  transcript tail) and `frontier.disposition(id)`.

## Deferred

- Voiced/animated portrait frames for the comms screen.
- Reputation-gated contract offers surfaced inside the conversation tree.

# 0.9.2 — Spatial Grid, Glyph Atlas & Scripting Completion

Ships as **0.9.2**.

- **Uniform spatial grid (`SpatialGrid` / `AI_GRID`).** The remaining O(n) hot
  path was every active ship walking the whole entity array to find its nearest
  enemy, plus pirate station turret scans and wing-escort engage scans. The grid
  buckets ship-like kinds into 1024u cells, rebuilt once per frame before the AI
  pass (`rebuildAiGrid`), and a query visits the 27 neighbouring cells with a
  squared-distance reject. `findEnemyShip`, the pirate scan and `tickWing` all
  go through it now.
- **Glyph atlas (`glowTile`).** Glow cells used to toggle `shadowBlur` per cell,
  which forces a fresh blur rasterisation each time. Each (glyph, color) pair is
  now baked once into a HiDPI offscreen canvas and stamped with `drawImage`.
- **Perf readout.** The FPS overlay reports entity count and how many bodies the
  AI broad phase is indexing (`fps 60 · e1240 · ai86`).
- **Scripting completion.** Read surfaces that were still missing: `frontier.crew()`,
  `frontier.cargo()`, `frontier.record()`, `frontier.bookmarks()`,
  `frontier.reputation()`, `frontier.perf()`, plus `frontier.unbookmark(name)`.
- **Hooks.** `onBookmarkRemoved` (Nav Log delete), `onCargoChanged` (per-frame
  manifest diff, so every one of the ~20 cargo callsites is covered by one
  watcher) and `onCrewPaid` (dock payroll settlement).

## Deferred

- ~~Player-to-NPC conversation trees~~ — shipped in 0.9.3.
- ~~Culling the depth sort itself via a per-band bucket sort~~ — shipped in 0.9.3.

# 0.9.1 — Performance Pass & Navigation Scripting

Ships as **0.9.1**.

- **Renderer hot path.** `WORLD_RADIUS_BY_KIND` is hoisted to module scope
  (the table was re-allocated per rendered frame). `renderPlaying()`'s
  projection loop now rejects any entity whose `sx/sy ± (rCells + 6)` box
  misses the world pane, so off-screen contacts never reach the depth sort or
  the draw pass.
- **In-place integration.** The entity move loop mutates `e.pos` instead of
  `e.pos = V.add(e.pos, V.scale(e.vel, dt))`. Verified every entity owns a
  private `pos` object (bullets and swarm spawns already copy), so mutation is
  safe. This was two allocations per entity per frame — the source of the GC
  sawtooth near dense space.
- **Collision broad phase.** One squared-distance reject (1200u) at the top of
  the player-collision loop guards ram, dock-bump, corona-scoop and
  black-hole-shear checks, all of which trigger well inside 800u.
- **Fixed: distant traffic at double speed.** `tickAI`'s >3500u early return
  integrated `pos` before returning, and the caller integrated it again.
- **Fixed: stale `byId()` cache.** Invalidation watched entity count only, so a
  frame that removed one entity and spawned another could return a destroyed
  ship. It now also compares array identity (removals always go through
  `filter()`, producing a fresh array).
- **`nearestOfKind(kind, radius)`.** Allocation-free nearest lookup; replaces
  the per-frame `entities.find(... V.len(V.sub(...)) < r)` star scan. Remaining
  `entities.find(e => e.id === ...)` scans folded into `byId()`.
- **Scripting.** `frontier.target()`, `frontier.setTarget(id)`,
  `frontier.screen()`, `frontier.bookmark(name, x, y, z)` and
  `frontier.hooks()`. Bookmarks respect `NAV_BOOKMARK_MAX` and dispatch
  `onBookmarkAdded`; `setTarget` validates the id and logs the switch.
- **Title tips.** 12 → ~40 entries covering bulletin, contract log, bounties,
  holdings, wings, salvage, insurance, crew levels, chipping, solar sail,
  visual options and mod install.

## Deferred

- Spatial hash / uniform grid for the NPC-vs-NPC target scans (the remaining
  O(n) work per active ship). Needs a rebuild-per-frame budget study first.
- Offscreen glyph atlas for repeated sprite stamps.

# 0.9.0 — Frontier Events

Ships as **0.9.0**.

- **Frontier events.** `FRONTIER_EVENTS` defines ten kinds (ore boom, famine,
  tech embargo, relic rush, blockade, fuel crisis, quarantine, war muster,
  glut, salvage call) with a scope (`station` / `faction`), a duration roll,
  price multipliers by commodity class or id, fuel/ore multipliers and an
  optional raider count. `tickFrontierEvents()` rolls a new one every
  ~2.5–6 minutes up to `FRONTIER_EVENT_MAX` (3), expires finished ones, and
  posts a one-time proximity notice when the player comes inside 6000u.
- **Market coupling.** Shifts are applied to the live `StationStock` rows (the
  same objects `tickTradeSim` mutates) and reversed on expiry.
  `StationStock.evApplied` records which event ids are baked in, so
  `syncStockEvents()` — called on every `getStock()` — is idempotent and
  re-applies live events after a market-day rotation without stacking.
- **Frontier Bulletin.** New `events` screen on keybind `bulletin` (`Y`,
  rebindable): `bulletinRows()` sorts live events nearest-first with distance
  and time left; ENTER targets the anchor dock, the bookmark key files it.
- **Chatter.** New `frontier_event`, `frontier_event_end`, `crew_ctx_event`
  and `npc_ctx_event` pools; crew and NPC context buckets add the event bucket
  when an advisory is within 20000u of the speaker.
- **Scripting.** `onFrontierEvent` (`phase` start/end) and read-only
  `frontier.events()`. Events persist in `SaveBlob.events`; loading clears the
  market cache so restored advisories re-apply cleanly.

# 0.8.9 — Hull Classes, Station Archetypes & Rock Mineralogy

Ships as **0.8.9**.

- **Hull classes.** `SHIP_CLASSES` / `SHIP_CLASS_POOLS` / `shipClassOf()`
  replace the old per-faction `SHIP_SPRITES` table. Class resolves from name
  keywords, the `boss` flag, then a hash of the entity id, so silhouettes are
  stable per ship. Classes with a `wide` 5x3 stamp switch to it at
  `rCells >= 2.2`; every class carries a blinking nav-light offset.
- **Station archetypes.** `STATION_ARCHETYPES` / `stationArchetypeOf()` paint a
  5x5 structure ring around the existing 3x3 faction stamp at `rx >= 4` (the
  inner 3x3 is skipped so the faction silhouette survives), plus a blinking
  docking beacon above the hull.
- **Rock mineralogy.** `ROCK_CLASSES` / `rockClassOf()` drive asteroid tint and
  glyph palette (carbonaceous, silicate, metallic, icy, ~8% crystalline).
- **Target panel.** Contact line names the hull class / station archetype /
  mineral class instead of the bare entity kind.
- **Hooks.** Eight new: `onEntitySpawned`, `onPlayerDamaged`, `onScreenChange`,
  `onOreMined`, `onSalvageCollected`, `onMarketCycle`, `onReputationChange`,
  `onCrewLevelUp`. Damage and screen transitions use a single per-frame
  watcher at the end of `update()` so no future callsite can miss them.
  `frontier.entities` now returns `id`, `shipClass`, `stationClass`,
  `rockClass`.

# 0.8.8 — Log Ergonomics, Manual Lanes & Hook Audit

Ships as **0.8.8**.

- **Contract Log sort & filter.** `S` cycles `contractSort`
  (added → reward → deadline → kind), `F` cycles `CONTRACT_FILTERS`
  (all / ready / combat / freight / people / timed). `contractView()` is the
  single ordered+filtered list the log renders and acts on, so pinning and
  abandoning always hit the row the player sees.
- **Player-set freight lanes.** `lanePartnerOptions()` / `laneGoodsOptions()`
  drive two new Build-page rows; `establishTradeRoute()` honours the pinned
  partner and/or commodity and falls back to the best-spread search when
  either is Auto. Contraband and duplicate lanes are still refused.
- **Hook audit.** Ten lifecycle events that previously only wrote a log line
  now dispatch: `onMissionCompleted`, `onCrewHired`, `onCrewLeft`, `onRankUp`,
  `onModuleInstalled`, `onStationFounded`, `onWormholeJump`,
  `onPlayerDestroyed`, `onStowawayRevealed`, `onTradeRouteClosed`. All are
  registered in `lua-host.ts` `HOOK_NAMES`.
- **Docs.** New `CHANGELOG.md` covering 0.4.0 → 0.8.8; hook table, MANUAL and
  GUIDE refreshed.
- **Chatter.** `EXTRA_TEMPLATES_088` appends ~30 lines across contract-load,
  mission, station-report, quartermaster, navigator, pilot, engineer, dealer,
  hauler and station pools.

# 0.8.7 — Contract Log & Station Trade Routes

Ships as **0.8.7**.

- **Contract Log.** `PlayerState.missions` is now the canonical list of active
  contracts (max 3) with `mission` as the *tracked* one that the HUD arrow,
  objective diamond and SYSTEM pane follow. `contractList()` migrates old
  saves in place, `addContract()` refuses a fourth job, `dropContract()`
  re-pins the next. Kill checks, passenger drop-offs, deadline failures and
  dock payouts all iterate the log, so background jobs progress and every
  finished contract settles on the same dock.
- **Log UI.** `U` (was "Quest Log") lists all contracts with reward and a live
  per-kind progress line; `ENTER` tracks a row, `X` abandons it for -1 Guild
  standing (-3 for a stranded passenger) and fires `onMissionAbandoned`.
- **Station trade routes.** Owned stations at Tier 3+ can broker up to two
  automated freight lanes from the Build / Upgrade page (8000cr each). Each
  lane auto-picks the best-paying charted market for a good the partner dock
  can legally take and pays `stationRouteIncome()` per minute on top of tier
  income; lane-running stations file `player_station_route` Comms reports.
- **Lua.** New hooks `onMissionAccepted`, `onMissionAbandoned`,
  `onTradeRouteEstablished`, plus read-only `frontier.contracts()` and
  `frontier.holdings()` getters. Two new samples in `lua-samples.md`.
- **Performance.** New `byId()` entity index: a Map rebuilt only when the
  entity count changes replaces 39 linear `entities.find(e => e.id === …)`
  scans across missions, targeting, docking, waypoint markers and rendering.
- **Chatter.** New `crew_ctx_contracts` (full log), `crew_ctx_routes` (lane
  income) and `player_station_route` pools, plus an `EXTRA_TEMPLATES` merge
  block appending ~25 lines to pilot/engineer/quartermaster/navigator idle,
  merchant, dealer, hauler, traffic and colony pools.

# 0.8.6 — Wing Escorts & Waypoint Markers

Ships as **0.8.6**.

- **Wing escorts.** Lawful docks now broker escort contracts from the Crew
  page (`Hire wing escort`, 1800cr, 90cr/dock, max 2). Each escort is a real
  `friendly` entity with faction `wing`: amber-tinted, patrol silhouette, its
  own hull (130) and shield (80). It does not consume a berth — escorts fly
  their own ship.
- **Wing AI.** New branch in `tickAI`: engage the nearest hostile inside
  1200u (fire at <480u on a 0.5s cadence), otherwise hold a formation slot
  ~130u off the player's flank with distance-scaled closing speed so it
  catches up fast and settles instead of rubber-banding. Slot side is derived
  from entity id so two escorts split left/right.
- **Wing lifecycle.** `tickWing()` re-binds each roster entry to a live
  entity every frame, so escorts survive save/load and wormhole jumps. A
  destroyed escort fires `onWingLost` and is struck from the roster
  permanently — re-hiring costs full price. A short payday voids the newest
  contract on the spot. `Stand down <name>` dismisses cleanly.
- **Waypoint markers.** Nav Log bookmarks now paint in world space: a `◇`
  glyph plus name and live distance, bright when the source contact is still
  on sensors and dim when only the frozen coordinates remain. Markers never
  overwrite a cell already occupied by a hull or a body.
- **Lua.** New `onWingHired` (name, fee, wage) and `onWingLost`
  (name, reason?) hooks, registered in the Lua host.
- **Chatter.** ~15 new humorous lines across pilot idle, engineer idle and
  the used-ship dealer pools.

# 0.8.5 — Nav Log & Pilot's Record

Ships as **0.8.5**.

- **Nav Log.** `N` bookmarks the current target (or, with nothing targeted,
  the ship's present position) and `V` opens the log: up to 8 waypoints, each
  showing live distance plus the frozen coordinates, so a contact that has
  since been destroyed still yields a usable bearing. `ENTER` re-targets a
  bookmark whose entity is still on sensors, `X` clears the highlighted row.
  Both binds are reassignable under Options ▸ Controls ▸ Keybinds and the
  waypoint list rides along in the save (it lives on `PlayerState`).
- **Pilot's Record.** New lifetime tallies on `PlayerState.record` — distance
  flown (odometer captured around the powered/solar/drift integration so all
  three count), docks, contracts completed, ore mined and lifetime contract
  pay — rendered as a single line on the Character Sheet under the commander
  block.
- **Lua.** New `onBookmarkAdded` hook (name, kind, x, y, z), registered in the
  Lua host alongside the existing bounty hooks.
- **Copy pass.** Swept chatter and UI strings for spelling/grammar slips; the
  only hits were intentional in-character contractions, so no lines changed.

# 0.8.4 — Bounty Office & Market Polish

Ships as **0.8.4**.

- **Bounty Office.** Lawful docks post 0–3 warrants per market day on named
  pirate captains (`generateStationStock` → `StationBounty[]`); Federation
  offices keep the fattest board, pirate holds post none. Signing a warrant
  spawns the mark 2.5–5k out as a boss-tagged pirate (heavy marks carry a
  shield and a railgun and pay ~2x) and writes a `bounty` mission so the
  tracker and objective diamond point at it. Warrants splice out of the
  board on accept so they can't be double-claimed within a day.
- **Bounty kill fix.** The bullet-hit completion check only tested
  `kind === "destroy"`, so `bounty` missions could never close. Both kinds
  now complete on kill, show live distance in the mission pane, and redirect
  the objective marker to the nearest civilian dock once done.
- **Records expungement.** With local standing below Wary, the Bounty Office
  clears your file for `120cr` per point of standing (min 300cr) via
  `recordFine()`, restoring you to -5.
- **Market polish.** Commodities SELL mode gained a `[SELL ALL]` row that
  liquidates everything the dock legally buys in one press; the Market page
  gained a partial refuel row (up to 25u) for pilots who can't afford a full
  top-off.
- **Lua.** New `onBountyAccepted` (name, reward, threat, targetId, stationId)
  and `onBountyClaimed` (name, reward, targetId) hooks, registered in the Lua
  host.

# 0.8.3 — Dealer Patter & Hull Insurance


Ships as **0.8.3**.

- **Used-spacecraft dealer chatter.** Stations holding hulls on the pad now
  advertise on the open channel within 2500u. `dealerBuckets()` picks the
  pitch from the pilot's own condition across 12 buckets: broke, flush,
  cracked hull, stuffed hold, full berths, still-flying-the-starter,
  veteran kill count, dry tank, contraband aboard, a locked frame on the
  pad, no insurance, and generic patter. The salesman also greets you at
  the door when you open Docked ▸ Shipyard. ~70 new corny lines.
- **Hull insurance.** The Shipyard sells a policy on your current frame for
  15% of its list price (Merchant/Quartermaster discounts apply). One claim:
  `respawnAtStation()` waives the 25% rescue fee, refills the tank, and pays
  60cr per unit of cargo lost with the wreck. The policy burns on the claim
  and lapses when the frame is traded in.
- **Shipyard offer deltas.** Each listing now shows signed deltas against the
  frame you fly (`HP 320(+80) SH 90(-10) cargo 60(+12) …`) so the trade reads
  at a glance.

# 0.8.2 — Shipyard & Player's Guide

Ships as **0.8.2**.

- **Shipyard.** Docked ▸ Shipyard lists 0–3 hulls per station, rotating with
  the market day (Federation yards keep the most berths, pirate holds the
  fewest, colonies none). Prices come from `hullPrice()` — derived from the
  hull's own stats so new frames self-price — shown net of a 55% trade-in on
  your current hull and discounted by Merchant/Quartermaster perks.
  Species-locked and veteran-locked frames are listed but flagged LOCKED.
- **Safe frame swaps.** `recomputeShipStats()` re-derives hull/shield/cargo/
  fuel/speed from (hull × species × modules), so module bonuses transfer
  instead of being lost or double-counted. Purchases are blocked (before any
  credits move) if the new hold can't take your cargo or the new berth count
  can't take your crew, with a message naming how much to shed.
- **Lua.** New `onShipHullChange` hook (hullId, name, net, previous,
  stationId), registered in the Lua host.
- **Player's guide.** New `GUIDE.md`: scenario, first flight, controls,
  survival, an encounter table, income routes, ship/crew/upgrades, Comms,
  options, modding/scripting, and estimated minimum + recommended specs.

# 0.8.1 — Situational NPC Comms

Ships as **0.8.1**. Extends the 0.8.0 context-bark system outward from the
crew to everyone else in the sector.

- **Situational NPC chatter.** `npcContextBuckets()` inspects a nearby
  speaker's own condition before it talks: badly damaged hull, fleeing,
  laden hauler, crowded station approach, nebula wash, proximity to a
  compact object, deep space beyond the charts, or a mayday nearby.
  Patrols react to a flagged player file, pirates smell a wounded ship,
  and pirates with sense give a high-kill pilot the lane. Colonies get a
  quiet ground-control voice. ~65% of ambient external lines now come
  from these 12 buckets instead of the flat per-kind tables.
- **More crew situational barks.** Nine new buckets: dry tank / drifting,
  inside a nebula, near an exotic compact object, actively mining, law
  nearby with bad standing, owned-station report, veteran kill count, a
  crew pet aboard, and a contract deadline inside two minutes.

# 0.8.0 — Comms, Contraband Counterplay & Living Holdings

Ships as **0.8.0**. Clears the three remaining backlog items.

- **Player-to-NPC comms.** `H` opens a channel to the current target
  (ship, station or colony within 4000u; aliens answer in static). Options
  are filtered by what the target could plausibly do: greet, ask for local
  news/market word, request an emergency fuel transfer, warn a hostile off,
  or offer 500cr restitution to Patrol/Federation. Replies are keyed to
  disposition (faction reputation + current hostility) via new
  `hail_*` chatter buckets. Fires the `onPlayerHail` Lua hook.
- **Smuggling counterplay.** Two new modules: **Shielded Hold** (hides 8
  units of each banned good per fitted unit) and **Bribe Encoder** (raises
  bribe odds from ~30% to ~75%). Customs is now interactive: an inspection
  that finds anything opens a screen with **Surrender** (seizure + fine +
  rep hit), **Bribe** (cost ~80% of the fine, odds shown; a refused bribe
  costs extra rep and a 1.5x fine), or **Refuse the search** (keep the
  cargo, undock hot, nearby lawful ships flag you and Patrol hunts you).
  Fires `onCustomsScan`.
- **Station income scaling.** Treasury accrues per minute of real play, not
  only on docks: `tier income x (1 + surplus bonus) x Quartermaster grade`,
  where surplus is material delivered beyond the tier requirement (up to
  +100%). Treasury caps at `tier^2 x 2000` so an ignored station stops
  printing; owned stations file periodic Comms reports, including a
  "vaults are full" warning.
- **Context-sensitive crew chatter.** ~70% of idle barks are now chosen by
  shipboard situation instead of at random: low fuel, low hull, low
  shields, full hold, hostiles in range, deep space, broke, flush,
  carrying contraband, close to a star, active contract, low morale,
  passenger aboard, or all-quiet — each spoken by the role most likely to
  raise it, across 14 new chatter buckets.

# 0.7.9 — Living Economy & Station Identity

Ships as **0.7.9**. Clears the last four deferred backlog items.

- **Faction contraband bans.** `factionBans()` gives each faction a banned
  legality set (Federation/SPD ban grey + restricted, Guild and colonies ban
  restricted, pirates ban nothing). Banned goods vanish from the Commodities
  page, the page warns which tiers are prohibited, and docking runs a
  **customs scan**: contraband is confiscated, fined at half local value,
  costs rep with that faction and *gains* a little pirate rep.
- **Route-hint HUD.** Buy rows now read
  `[BUY 10] Titanium @  61cr  stock  44  have 0  → Kepler Hub +42%`, naming
  the best-paying market seen this session. Cached per station/market-day so
  the per-frame menu build stays cheap; contraband destinations are excluded.
- **NPC trade AI.** `tickTradeSim()` fires every ~12s: an off-screen hauler
  moves a batch of one commodity from the cheapest market to the dearest,
  shifting stock and nudging both stations' prices ~3% toward each other.
  Fat spreads decay if you don't run them.
- **Player-station customization.** Owned stations get a cosmetic
  `Silhouette:` cycle across five motifs (Bastion / Halo / Spire / Forge /
  Nest) that renders as the station's 3x3 stamp, plus `Rename station →`
  cycling a twelve-name pool. Available at every tier, including max.

# 0.7.8 — Exotic Stars, Lensing & Propulsion


Ships as **0.7.8**.

- **Renderer performance pass (no version bump — correction only).**
  - Per-frame caches: star and planet lists are built once per frame, and
    "nearest star" is memoized per entity on a 2s cadence. Kills the old
    O(entities × entities) scans that ran for lighting, comet tails, and
    Roche deformation on every drawn body.
  - Viewport clipping of sprite loops: the filled disc, star halo, nebula
    field, lensing annulus, planetary rings, colony ring, and the black-hole
    event horizon now iterate only cells that can land inside the viewport.
    Previously a nearby large body projected thousands of cells wide and the
    full-disc loops burned millions of clipped iterations per frame — the
    source of the stutter near stars and exotic objects.
  - Lensing uses squared-radius tests and defers `sqrt` to accepted cells.
- **Player manual** added at `MANUAL.md` (flight, fuel, economy, mining,
  combat, missions, crew, station building, options, saves, modding).


- **Flares are distance-gated.** The flare tongue and the `flare` rumble now
  test true world distance (`|e.pos - p.pos|`), not camera depth: tongue
  inside 6000u, audio inside 3000u. Flying past a star sideways no longer
  leaves it erupting forever.
- **Exotic compact objects** (`BH`, `PSR`, plus new `NS` neutron star and
  `MAG` magnetar) bypass the disc/halo/corona pipeline for `drawExoticStar`:
  - Black hole: true black horizon that erases the background, a photon
    ring, a churning doppler-brightened accretion disc, and polar jets.
  - NS/PSR/MAG: pinpoint core, crackling magnetic field arcs, and swept
    twin lighthouse beams (PSR fast, MAG violent violet, NS lazy).
  - Both are unscoopable and register under the EXOTIC target category.
- **Gravitational lensing.** Bodies larger than a gas giant smear the
  background: glyphs in an annulus are pulled inward along the radial.
  Strength scales BH 1.0 → compact 0.55 → big star 0.30 → giant planet 0.22,
  so an "empty" patch ringed by warped starfield betrays a black hole.
- **Propulsion modules**: `Flux Regulator` (-25% burn), `Overdrive Coil`
  (+25% top speed / +15% burn), and the cheap `Solar Drive` (-15% burn and,
  on a dry tank, steerable flight capped at 20% throttle).
- **Character customization**: six new species (Cephalid, Ferrix, Lumen,
  Stoneborn, Kobal, Thallian) each with portrait crests and a bonus/drawback
  pair, plus expanded skin/eye palettes and new hair style + hair color
  fields shown on the Character Sheet.

# 0.7.7 — Animate Coronas, Planet Surfaces & New SFX

Ships as **0.7.7**.

- **Animated stellar coronas.** The cardinal spikes now breathe on a per-star
  phase, diagonal micro-flares flicker with the cycle, and a curling
  **flare tongue** erupts every ~11s from a random pole. When a flare peaks
  within 1200u of the pilot it cues a new `flare` sfx (rumbling sawtooth
  swell), globally rate-limited so a swarm of stars doesn't machine-gun it.
- **Planet surfaces by category.** New `planetCategory` picks
  giant / terran / rocky / ice from size + hash and drives a dedicated
  `planetSurfaceChar`:
  - Giants get horizontal cloud bands plus a per-planet Great-Spot oval.
  - Terrans mix `~`/`≈` oceans with `#`/`%` continents (noise-driven)
    and `*` polar caps.
  - Rocky worlds sprinkle `o`/`O` craters on a dust field.
  - Ice worlds get sparkle-speckle poles and pale dot fields.
- **Computer advisory chatter.** 40% of planet chatter picks now trigger a
  Computer follow-up that names the world's class ("class-M terran,
  colonized. Breathable atmosphere, standing water detected." / "gas
  giant. No solid surface; scoopable atmosphere only.", etc).
- **New SFX** added to the existing WebAudio bank:
  - `scan` (sonar sweep) — replaces `chime` on scan-flavored events
    (alien ruins, UFO first contact).
  - `warning` (three-tone alert) — cues on notorious pirate captain arrival.
  - `levelup` (rising arpeggio) — unified rank-up fanfare. `awardXP`
    stamps `_pendingRankUp` on the player when the rank label ticks over;
    the game loop consumes it once per frame, plays the fanfare, and
    posts a Computer line so every XP source shares the same cue.
  - `flare` — see coronas above.

# 0.7.6 — Skybox Variety

Ships as **0.7.6**.

- Stars gained cardinal **corona spikes** that scale with rx and take their
  color from the class halo, so O/B/RG/RSG giants read as luminous
  cross-hatched sources instead of amber blobs. WD/M/PSR stay compact.
- **Comet ion tails** now cast away from the nearest star, projected
  through the same camera as the coma. Per-comet length hash keeps a
  swarm from marching in lockstep.
- **Station faction silhouettes**: after the sphere fill, each station
  is overprinted with a 3×3 faction stamp — Pirate `\ / X / \`, SPD
  `[+] |#| [+]`, Federation `_|_ |H| |`, Guild `/^\ <$> \v/`, Aquila
  `.~. (o) '~'`. Legend still reads them as stations; the shape just
  tells you at a glance whose it is.

# 0.7.5 — Salvage, Fragmentation & Upside-Down Fixes

Ships as **0.7.5**.


- Ship debris (`asteroid`s renamed to "debris"/"wreckage" on kill) yields
  variety when mined: 25% chance per tick of a tech/element commodity
  crate, or a small scrap-credit payout if cargo is full. Real asteroids
  stay ore-only.
- Player bullets can chip natural rocks. 40% roll per hit spawns a small
  fragment carrying 1–2 ore, **subtracted from the parent** so total ore
  is conserved. Each rock has a per-instance split budget (max ~3), and
  chunks won't spawn once the parent falls to 2 ore. Debris/wreckage is
  excluded to keep salvage single-source.
- Destroy / scan quest markers redirect to the nearest civilian station
  once complete — the objective diamond and arrow now point at the
  reward instead of the drifting corpse.
- Direction indicators fixed for inverted flight. When the pilot is
  upside-down (cos(pitch) < 0) the screen frame is 180°-rolled vs the
  world frame; both the SYSTEM mission arrow (`→ RIGHT` / `↑ UP` / …)
  and the off-screen edge bracket now mirror x/y so they point where
  the target actually appears on the pilot's screen. Yaw input inversion
  is unchanged (still handled by `yawSign` at input time).

# 0.7.4 — Stowaways & Pets

Ships as **0.7.4**.

- 5% chance on a non-trap distress rescue, derelict salvage, or station dock (with a free berth) to pick up a stowaway. Max one per playthrough.
- Undiscovered stowaway squats a berth: Character Sheet shows it as "OUT OF ORDER"; `effectiveCrewMax` -1 until revealed.
- Weird-things chatter drips every ~1–3 min (respects Comms frequency); after 3–5 hints they step out and slot into the first vacant role at **10cr/dock**, no perks.
- 5% chance at hire that any crewmember (or the legacy gunner) has a pet from a 44-entry table. Cosmetic only — appears on their Character Sheet row.

## Deferred (stays on the backlog)

- Contract log with per-contract sorting/filtering (today it is a flat list of
  three).
- Player-set trade lanes (today the lane picks its own partner and commodity).
