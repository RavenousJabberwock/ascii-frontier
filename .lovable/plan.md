# 0.7.1 — Economy & Ownership Pass

Big feature bundle. Scoping into four coordinated systems in `src/game/voidwake.ts`, shipped as **0.7.1**. All new state added to `SaveBlob` with graceful migration (missing fields → sensible defaults).

## 1. Station upgrade rotation

Each station rolls a per-visit inventory:

- **New modules** — expand `MODULE_CATALOG` from the current set to ~18 upgrades: extra shield capacitor, aux thruster, cargo expander I/II, mining laser upgrade, sensor booster, ECM suite, hull plating I/II, fuel scoop, life support upgrade, targeting computer, jump range extender, stealth coating, tractor beam, repair drones, luxury cabin (unlocks passenger berths), station beacon kit (see §4).
- **Rotation** — each station gets `upgradesOffered: string[]` of length `rng(0..5)` sampled from the catalog, seeded from `(stationId, epochDay)` so it rotates ~daily in-game.
- **Crew availability** — each station's `recruits: CrewMember[]` also rotates 0–4 per day, seeded the same way. Recruiter perk keeps its bonus of +1.
- Buy menu (`B`) gains an **Upgrades** tab alongside cargo.

## 2. Arbitrage economy

Introduce a proper commodity system. Cargo already tracks tonnage; each unit takes 1 slot.

- **Commodity classes** (with base price, volatility, legality):
  - *Elements*: Iron, Copper, Silicon, Titanium, Uranium, Antimatter.
  - *Tech*: Microchips, Robotics, AI Cores, Quantum Drives.
  - *Trade goods*: Grain, Textiles, Medicine, Spices, Luxury Goods.
  - *Relics*: Precursor Fragment, Ancient Datacore, Xeno Artifact (rare, high value, mild rep risk if sold to wrong faction).
- **Per-station price model**: `price = base * (1 + supplyBias) * (1 + rng(-0.15..0.15))` where `supplyBias` derives from station class (Mining → cheap elements, Industrial → cheap tech, Agricultural → cheap food, Trade Hub → neutral, Federation Gate → premium relics). Prices reseed daily so routes shift.
- Existing single-commodity trade collapses into this table; migrate old saves by converting current cargo to `Iron`.
- HUD shows top 3 spread hints when docked ("Buy X here, sell at Industrial +42%") — Navigator perk reveals more.

## 3. Passenger & long quest lines

Add a new mission kind `passenger`:

- Requires ≥1 free **berth** (base 0; Luxury Cabin module = +2, larger hulls get 1–2 baseline).
- Payload: `{ guestName, originStation, destStation, deadlineTicks, fare, vip }`.
- Deadline is generous (`distance / cruiseSpeed * 1.6`) so it's doable. Timer visible in Mission Log.
- On dock at dest → payout + rep; on expiry or guest death (hull breach) → rep hit and half fare forfeited.

Longer quest chains (`missionChain`):
- 3–5 step arcs (courier → recon → combat → payoff). Each station may offer chain step 1; completion at destination unlocks step 2 as a follow-up in Comms.
- Stored as `activeChains: MissionChain[]` in save.

## 4. Player-owned stations

Late-game money sink & income source:

- Purchase **Station Core** (~250k cr) from Federation Gate or Trade Hub when reputation ≥ threshold.
- Deploy at any free-space location (`F` while core is in cargo) → creates a `PlayerStation` entity with `tier: 0`, `capacity: 0`.
- Supply raw materials (Iron, Silicon, Titanium, etc. — see §2) to build tiers 1–5. Each tier lists required commodities; delivering enough advances the tier and unlocks:
  - Tier 1: docking + refuel.
  - Tier 2: passive income (10 cr/tick × tier).
  - Tier 3: buys/sells commodities from NPC traffic (adds to your treasury).
  - Tier 4: recruits crew, offers missions to NPCs.
  - Tier 5: fields defense drones vs hostiles.
- Player stations appear on radar with a unique glyph. Treasury visible in Character Sheet; withdraw on dock.

## 5. Lua/mod surface

- New hooks: `onCommodityTrade`, `onPassengerBoard`, `onPassengerDeliver`, `onPlayerStationTierUp`.
- `frontier.economy.price(commodityId, stationId?)` reader.
- `frontier.mods` chatter packs gain new pools: `passenger_smalltalk`, `player_station_report`.

## 6. Chatter, UI, docs

- ~40 new lines for passengers, station construction, and market gossip.
- Character Sheet gets a **Holdings** section listing owned stations, tiers, and income.
- Update `README.md`, `src/game/README.md`, `src/game/lua-samples.md`, and `.lovable/plan.md`. Bump `VERSION` to `0.7.1`. Rebuild offline bundle.

## Technical notes

- Save migration: any missing new field defaults to empty/zero; old cargo string maps to `Iron`.
- Station daily seed: `hash(stationId, floor(worldTime / DAY_TICKS))`.
- Player stations serialize with position, tier, materials-delivered, treasury.
- Type additions: `Commodity`, `MarketRow`, `PassengerMission`, `MissionChain`, `PlayerStation`, expanded `Module`.
- All new UI keys reuse existing menus (`B` upgrades tab, mission log for timers, `C` sheet for holdings) — no new keybinds needed.

## Out of scope for 0.7.1 (deferred)

- Player-station cosmetic customization.
- NPC trade AI actually moving cargo between stations (prices still shift daily via RNG).
- Faction-specific commodity bans beyond the relic rep hint.
