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

- Multiple simultaneous contracts surfaced as a real quest list (the data
  model already has `missions[]`; the UI still shows one).
- Escort/wing NPCs you can hire as a second hull.
- Waypoint marker drawn in the world for Nav Log entries (today the log gives
  distance and coordinates only).
- Station-to-station trade routes the player can automate with owned stations.
