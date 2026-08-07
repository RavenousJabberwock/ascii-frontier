# ASCII FRONTIER — Pilot's Manual

A gameplay guide for the ASCII space sim. Everything here is playable in the
browser build (`bun run dev`), the hosted build, or the single-file offline
build. For engine internals see [`src/game/README.md`](src/game/README.md);
for release notes see [`.lovable/plan.md`](.lovable/plan.md). A shorter
new-pilot guide (with system requirements) lives in [`GUIDE.md`](GUIDE.md).

---

## 1. The premise

You are a freelance commander with a small hull, a modest loan's worth of
credits, and a galaxy that does not care whether you survive. There is no
win condition. You pick a living: hauling cargo, mining rock, running
contracts, hunting pirates, ferrying passengers, or eventually building and
supplying your own station and drawing income from it.

Three things kill new pilots, in order:

1. **Running out of fuel** far from a station.
2. **Flying into a fight you can't leave** (raiders are faster than you look).
3. **Flying into a star** because the ASCII disc looked far away.

Everything else is recoverable.

---

## 2. First ten minutes

1. Click the canvas so it takes keyboard focus.
2. Create a commander — species affects one bonus and one drawback; the rest
   (skin, eyes, hair) is cosmetic and shows on the Character Sheet.
3. Accept or skip the opening **contract board**. Skipping is fine; offers
   come back when you dock.
4. Press `T` to target the nearest station, throttle up with `W`, steer with
   `A`/`D` (yaw) and `Q`/`E` (pitch), and follow the direction indicator.
5. Slow to a crawl near the station and press `F` to dock.
6. At the station: `B` to trade, `J` for missions, and browse the module and
   crew inventory — it rotates over time and differs per station.

---

## 3. Controls

| Key         | Action                                              |
| ----------- | --------------------------------------------------- |
| `W` / `S`   | Throttle up / down                                   |
| `A` / `D`   | Yaw left / right                                     |
| `Q` / `E`   | Pitch up / down (continuous — you can loop)          |
| `Space`     | Fire selected weapon                                 |
| `T`         | Cycle target                                         |
| `{` / `}`   | Cycle target *category* (ships / stations / exotic…) |
| `M`         | Mine targeted asteroid                               |
| `F`         | Dock with targeted station or colony                 |
| `B`         | Buy / sell menu while docked                         |
| `J`         | Mission / contract board while docked                |
| `C`         | Character Sheet (crew, ship, modules, pets)          |
| `R`         | Reputation panel                                     |
| `H`         | Hail the current target (comms channel)              |
| `N`         | Bookmark the current target into the Nav Log         |
| `V`         | Open the Nav Log (saved waypoints, up to 8)          |
| `ESC`       | Main menu (New / Save / Load / Options / Quit)       |

Gamepads (any standard mapping) and touch controls are supported and can be
toggled under **Options ▸ Controls**. Every bind is reassignable via
**Options ▸ Controls ▸ Configure Keybinds…**.

### Mouse-steer and the spin problem

Mouse-steer (Options ▸ Controls) maps cursor offset from screen centre to
yaw/pitch rate. If you let the cursor sit far off-centre — or fling it out of
the window — the ship keeps rotating and it *feels* like a bug. It isn't:
return the cursor toward centre, or switch back to keyboard steering. Pitch
is continuous rather than clamped, so a sustained pitch input loops you
upside-down; the HUD direction arrow accounts for that and still points at
where the target actually is on screen.

---

## 4. Flight and fuel

- **Throttle** sets a target speed; the ship accelerates toward it. Reverse
  is just throttle below zero.
- **Afterburner** and **supercruise** multiply speed at a fuel cost. The HUD
  speed readout tags them `[AB]` / `[SC]` and shows the boosted number, and
  the screen picks up faint glitching while they run.
- **Fuel** is your real health bar. Refuel at any station or colony; a
  **Fuel Scoop** module lets you skim gas giants and stars, and the cheap
  **Solar Drive** keeps you steerable at up to 20% throttle even on a dry
  tank — an emergency limp home, not a strategy.
- Stranded ships broadcast maydays. Donating fuel earns reputation and
  occasionally more than that.
- **Wormholes** move you across the galaxy in one hop, with a nebula-tinted
  glitch during transit. They come in linked pairs — note where you came out.

---

## 5. The universe

- **Core**: dense with stars, planets, stations, asteroid belts, comets and
  traffic. Missions and quests live here.
- **Deep space** (out to ~10× the core radius): near-empty, with rogue
  asteroids, ancient wrecks, and the occasional UFO. Good for salvage and
  bad for rescue.
- **Stars** vary by real spectral class — O/B blue giants, red supergiants,
  white dwarfs, and exotic remnants. Coronas animate and flares erupt; get
  within a few thousand units of a flaring star and you'll hear it.
- **Exotic objects** — black holes, neutron stars, pulsars, magnetars — draw
  differently (photon rings, accretion discs, jets, sweeping beams) and can't
  be scooped. Anything larger than a gas giant **lenses** the starfield around
  it, so a suspiciously empty patch ringed with smeared glyphs is a black hole
  you should not fly into.
- **Planets** are typed as giant / terran / rocky / ice, with cloud bands,
  continents and oceans, craters, or polar sparkle. Roughly one in five has
  rings. Populated worlds show a dotted orbital ring and a `◈` beacon and can
  be docked at like a station.

---

## 6. Trade and the economy

Eighteen commodities across elements, technology, relics, and general goods.
Each station shows a filtered list of what plausibly trades there, in a
compact **[Buy] / [Sell]** view (LEFT/RIGHT switches mode).

- Prices vary by faction bias, station type, and a small per-station jitter,
  and markets rotate roughly every ten minutes.
- Everything you carry takes **cargo space**. Cargo capacity is a hull stat
  and can be expanded with modules.
- Arbitrage is the core loop: buy where a good is cheap and abundant, sell at
  a station whose faction wants it. Industrial and relic markets swing widest.
- Relics move reputation as well as credits; some factions dislike you
  trafficking them.
- In SELL mode a **[SELL ALL]** row liquidates everything the dock legally
  buys in one press. The Market page also has a **partial refuel** row (up to
  25u) for when a full top-off is out of reach.


---

## 7. Mining and salvage

- Target an asteroid and hold `M` within range. A **Mining Upgrade** module
  raises yield per tick.
- Shooting a natural rock can chip off a small fragment carrying 1–2 ore.
  That ore is **subtracted from the parent**, and each rock has a limited
  split budget, so there's no infinite-ore exploit.
- **Debris and wreckage** from destroyed ships is salvageable: mining it can
  yield tech or element crates, or scrap credits if your hold is full.

---

## 8. Combat

- Weapons differ in damage, rate, range, and heat. Shields regenerate
  between fights; hull does not — repair while docked or fit **Repair
  Drones**.
- **Critical hits** apply to both you and NPCs.
- Hull damage produces screen glitching (disable it under Options ▸ Video if
  it bothers you).
- **Space Patrol (SPD)** ships police the lanes: they chase hostiles, tow
  ships that run dry, and will come after *you* if you shoot neutrals.
  Attacking a patrol is a fast way to make a region unlivable.
- Notorious pirate captains announce themselves with a warning tone. Run if
  you're not ready.

---

## 9. Missions, quests, and passengers

- The **contract board** (`J` at a station, and at game start) offers several
  jobs plus the option to take none. It can be disabled entirely in
  **Options ▸ Gameplay**.
- Kinds include: destroy a raider, scan an object, deliver supplies, courier
  cargo between outposts, fuel a stranded ship, and crew-specific quest lines
  offered when you hire someone.
- **Passengers** occupy a berth and have a delivery deadline. They also talk.
- **Bounty Office** (docked ▸ Bounty Office, lawful stations only). Lawful
  docks post 0–3 warrants per market day on named pirate captains; Federation
  offices keep the fattest board and pirate holds post nothing. Light marks pay
  ~600–1100cr; heavy marks fly shields and a railgun and pay ~1400–2300cr.
  Signing a warrant spawns the mark 2.5–5k out and loads it into your tracker.
  Kill it, then dock anywhere to collect. One warrant at a time.
- **Clearing your record.** If your standing with the local faction is below
  Wary, the same office will lose the paperwork for 120cr per point of
  standing (minimum 300cr), restoring you to Wary.
- Completed destroy/bounty/scan objectives redirect the marker to the nearest
  civilian station for your payout — follow the diamond.


---

## 10. Crew

Roles: Pilot, Gunner, Engineer, Navigator, Quartermaster, Recruiter,
Tactical, Medic. Each occupies a berth, draws a wage per dock, and grants a
passive bonus that scales with its **level** (L0–L9, earned through use).

- **Morale** falls with unpaid wages, deaths, and long hauls, and rises with
  successful jobs. Low morale can end in a walkout — except on Easy or with
  cheats enabled.
- Crew have idle chatter, a banter matrix with each other, and a 5% chance of
  arriving with a **pet** (cosmetic, shows on the Character Sheet).
- **Wing escorts** (0.8.6): lawful docks broker up to two escort contracts
  from the Crew page — 1800cr up front, 90cr per dock. An escort is a real
  ship, not a berth: it flies formation off your flank, engages hostiles
  within 1200u, and its amber hull shows on scope. Escorts survive save/load
  and wormhole jumps, but a shot-down escort is gone for good, and a short
  payday voids the newest contract. `Stand down <name>` releases one.
- **Stowaways**: 5% chance per playthrough to pick one up from a rescue,
  derelict, or dock with a free berth. Until discovered they squat a berth
  that reads "OUT OF ORDER" and cause odd shipboard chatter; once revealed
  they join a vacant role at a very low wage.

- **Contract Log** (0.8.7): `U` opens the log. You can carry up to **three**
  contracts at once; `ENTER` marks one as tracked (the HUD arrow, objective
  diamond and SYSTEM pane follow it), `X` abandons the highlighted job at a
  cost of Guild standing (more for a stranded passenger). Every contract in
  the log progresses and pays out independently — dock once and all finished
  jobs settle together.
- **Station trade routes** (0.8.7): from Tier 3 a station you own can broker
  automated freight lanes on the Build / Upgrade page. 8000cr per lane, two
  lanes maximum; each lane picks the best-paying charted market for a good it
  can legally move and pays passive treasury every minute on top of tier
  income. Your station files lane reports over Comms.

Bookmarked waypoints also paint in the flight view (0.8.6) as a `◇` marker
with the name and live distance — bright while the original contact is still on
sensors, dim when only the stored coordinates remain.

The sheet also carries your **Pilot's Record** (0.8.5): distance flown,
docks, contracts completed, ore mined and lifetime contract pay.

Press `C` for the full sheet: portraits, attributes, ship silhouette, and a
plain-language description of every fitted module.

---

## 10a. The shipyard

Every station keeps **0–3 hulls** on the pad, rotating with the market day —
Federation yards list the most, pirate holds the fewest, colonies none at all.
The price shown is already net of the **trade-in on your current hull** (55%
of list), and Merchant/Quartermaster perks discount yard work like anything
else. Modules and both weapon mounts transfer to the new frame, and its
bonuses are re-applied to the new base stats.

Two sales are refused outright, before any credits move: a hull whose hold is
smaller than your current cargo, and a hull with fewer berths than your crew.
The message tells you how much to sell down or pay off. Hulls locked to a
species or to veteran commanders are listed but flagged `LOCKED` so you can
see what else flies out there.

**Hull insurance.** The yard writes a policy on your current frame for 15% of
its list price (Merchant/Quartermaster discounts apply). One claim: on a
respawn it waives the rescue fee, refills the tank, and pays 60cr per unit of
cargo lost with the wreck. It burns on use and lapses on trade-in.

**Dealer patter.** Stations with hulls on the pad broadcast adverts within
2500u, and the line is chosen from what your ship's condition suggests — dry
tank, cracked hull, stuffed hold, full berths, starter frame, fat balance,
empty balance, contraband aboard, a locked frame on display, or no policy.
Gated by the Comms frequency option like every other ambient scheduler.

---

## 11. Your own station

Buy a **Station Core** module, deploy it, then feed it raw materials.
Stations progress T0 → T5; each tier raises capacity and passive income.
Income accrues per minute of play, scaled by tier, by surplus material
delivered beyond the tier requirement, and by a hired Quartermaster. It caps
per station, so collect by docking — your holdings will tell you over Comms
when the vaults are full.
Supply runs are the price of a paycheck that keeps arriving while you do
something else.

---

## 11a. Hailing and customs

Press `H` with a ship, station or colony targeted inside 4000u to open a
channel. What you can say depends on who they are: greet them, ask for local
news and market word, beg an emergency fuel transfer, warn a hostile off
(they may break away — bluffing works better with kills behind you), or pay
500cr restitution to Patrol/Federation to repair standing. Aliens answer in
static.

Lawful docks scan the hold. A **Shielded Hold** conceals eight units of each
banned good; whatever still shows opens an inspection where you may
surrender the cargo and pay the fine, offer a bribe (a **Bribe Encoder**
makes it stick), or refuse the search — which keeps your cargo, undocks you
hot, and puts patrols on your tail.

## 12. Comms

All system messages and chatter route into a scrolling **Comms** panel with
`All` / `Crew` / `External` / `Sys` tabs. Tabs are clickable, the panel
collapses via its Hide toggle, the mouse wheel scrolls it, and size and word
wrap are configurable in **Options ▸ Chat Windows**. Unstaffed crew stations
stay quiet; the ship computer speaks for them.

---

## 13. Options worth knowing

- **Video**: glitch effects on/off, scanline density, HUD and reticle themes.
- **Audio**: master/SFX toggles for the WebAudio bank (flares, scans, alerts,
  rank-up fanfare).
- **Gameplay**: difficulty, contract board on/off, autosave.
- **Chat Windows**: Comms panel size, wrap, and tab behaviour.
- **Controls**: mouse-steer, gamepad, touch, full keybind editor.
- **Mods / Scripting**: enable, reorder, and configure Lua mods.

If the game stutters near a big star or black hole, that's the renderer
drawing an enormous sprite — the current build clips those to the viewport,
but lowering scanline density and disabling glitch effects still buys frames
on weak hardware.

---

## 14. Saving

Saves are plain JSON in `localStorage` under `voidwake.save.<slot>`, shown
with timestamps, and can be exported/imported as `.json` from the menu.
Autosave degrades gracefully: if browser storage is full it retries without
chatter history rather than failing silently.

---

## 15. Modding in one paragraph

Mods are Lua (Lua 5.3 via Fengari) plus optional JSON content packs, loaded
from **Options ▸ Mods** by paste, file, or drag-and-drop. Scripts register
hooks (`onCommodityTrade`, `onPassengerBoard`, `onPlayerStationTierUp`, and
many more) and call into the `frontier.*` API for entities, world state,
economy queries, chatter injection, and grants. Errors are attributed to the
offending mod rather than crashing the sim. Worked examples live in
[`src/game/lua-samples.md`](src/game/lua-samples.md).
