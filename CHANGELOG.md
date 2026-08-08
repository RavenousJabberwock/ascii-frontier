# Changelog

All notable changes to **ASCII Frontier**. Versions are the engine `VERSION`
constant in `src/game/voidwake.ts`. Dates are omitted deliberately — releases
are milestone-driven, not calendar-driven.

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
