# Changelog

All notable changes to **ASCII Frontier**. Versions are the engine `VERSION`
constant in `src/game/voidwake.ts`. Dates are omitted deliberately — releases
are milestone-driven, not calendar-driven.

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
