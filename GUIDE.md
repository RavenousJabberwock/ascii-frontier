# ASCII FRONTIER — Player's Guide

A short, plain-language guide for new pilots. If you want the deeper
reference (every module, every crew perk, every option), read
[`MANUAL.md`](MANUAL.md). For engine internals see
[`src/game/README.md`](src/game/README.md).

---

## 1. The scenario

You're a freelance commander with one small ship, 500 credits, and a galaxy
that has no interest in your survival. There's no win condition and no story
you must follow. You choose a living — hauling, mining, bounty work,
couriering passengers, salvage, or building your own station — and the
frontier reacts to what you do.

The galaxy has three zones:

- **The core** — stars, planets, stations, belts, traffic, contracts. This is
  where the game happens.
- **Deep space** — a vast, near-empty halo out to roughly ten times the core
  radius. Rogue rocks, ancient wrecks, the odd UFO. Great for salvage,
  terrible if you run dry.
- **Exotic pockets** — black holes, neutron stars, pulsars, magnetars. They
  bend the starfield around them. Treat a suspiciously empty patch of sky as
  a threat.

---

## 2. Your first flight

1. Click the canvas so it takes keyboard focus.
2. Create a commander. Species gives one bonus and one drawback; the rest is
   cosmetic and shows up on the Character Sheet.
3. Accept or skip the opening **contract board** — skipping costs nothing,
   offers return when you dock.
4. `T` targets the nearest station. `W` throttles up. `A`/`D` yaw,
   `Q`/`E` pitch. Follow the HUD arrow.
5. Slow to a crawl close in, then `F` to dock.
6. Docked: `B` trade, `J` contracts, and browse the Module Shop, **Shipyard**
   and Crew list — all three rotate their stock over time.

### Controls at a glance

| Key       | Action                                     |
| --------- | ------------------------------------------ |
| `W` / `S` | Throttle up / down (below zero = reverse)  |
| `A` / `D` | Yaw left / right                           |
| `Q` / `E` | Pitch up / down (continuous — you can loop)|
| `Space`   | Fire                                       |
| `T`       | Cycle target                               |
| `{` / `}` | Cycle target *category*                    |
| `M`       | Mine the targeted rock or wreck            |
| `F`       | Dock with a targeted station or colony     |
| `B` / `J` | Trade / contract board while docked        |
| `C` / `R` | Character Sheet / Reputation panel         |
| `H`       | Hail the current target                    |
| `ESC`     | Menu                                       |

Gamepads and touch controls work too, and every bind is reassignable under
**Options ▸ Controls**.

**The one thing that confuses everybody:** with mouse-steer on, the ship keeps
turning while the cursor sits away from screen centre. That's the control
scheme, not a bug — bring the cursor back to centre or switch to keyboard
steering.

---

## 3. Staying alive

Three things kill new pilots, in order:

1. **Fuel.** It's your real health bar. Refuel at any dock. A **Fuel Scoop**
   skims gas giants and stars; a cheap **Solar Drive** keeps you steerable up
   to 20% throttle on an empty tank — a limp home, not a plan.
2. **Fights you can't leave.** Raiders are faster than they look. Shields
   regenerate, hull does not.
3. **Stars.** The glyph disc looks much further away than it is.

Everything else is recoverable.

---

## 4. Encounters you'll actually meet

| You'll see | What it means |
| --- | --- |
| **Traders / haulers** | Neutral, chatty, occasionally carrying something you want. Shooting them makes enemies of the law. |
| **Raiders / pirates** | Hostile on sight. Named "boss" captains announce themselves with a warning tone — run if you're green. |
| **Space Patrol (SPD)** | Heavily armed police. They chase hostiles, tow ships that run dry, and hunt *you* if you shoot neutrals or refuse a customs search. |
| **Stranded ships** | Broadcasting a mayday. Donate fuel for reputation and sometimes more. |
| **Distress beacons** | Usually a small payout. Sometimes a pirate trap. |
| **Derelicts and debris** | Salvage with `M`: tech or element crates, or scrap credits if your hold is full. |
| **Customs scans** | Lawful docks inspect your hold. Surrender, bribe, or refuse — refusing keeps the cargo and buys you a patrol tail. |
| **Aliens / UFOs** | Answer hails in static. Log enough contact and xeno crew become hireable. |
| **Wormholes** | One-hop travel across the galaxy, in linked pairs. Note where you came out. |
| **Asteroids and comets** | Mine with `M`. Shooting a rock chips off a small fragment — the ore comes out of the parent, so there's no infinite-ore trick. |

---

## 5. Making money

- **Trading.** Eighteen commodities. Buy where a good is cheap, sell where the
  local faction wants it. Buy rows name the best-paying market you've seen.
  Markets rotate every ~10 minutes; industrial goods and relics swing widest.
- **Mining.** Target a rock, hold `M`. A Mining Upgrade raises yield.
- **Contracts.** `J` at a dock: destroy, scan, deliver, courier, refuel a
  stranded ship, plus crew-specific quest lines. Completed objectives
  redirect the marker to the nearest civilian station for payout.
- **Passengers.** They take a cabin berth, have a deadline, and talk.
- **Bounty work.** Kill hostiles, bank the marks at lawful docks.
- **Your own station.** Buy a **Station Core**, deploy it at a Federation
  Gate, then feed it materials. Tiers T0→T5 raise capacity and passive income,
  which accrues while you play and caps until you dock and collect.

---

## 6. Ship, crew and upgrades

- **Shipyard** (docked ▸ Shipyard). Each station keeps 0–3 hulls on the pad,
  rotating with the market day. Prices are shown net of the trade-in on your
  current frame; modules and weapons transfer across. You can't downsize into
  a hull that won't hold your cargo or your crew — sell down or pay off first.
  Some hulls are locked to a species, others to veteran commanders. Offers
  list a signed delta against the frame you fly now.
- **Hull insurance** (Shipyard, 15% of your frame's list price). Covers one
  rescue: the 25% rescue fee is waived, your tank comes back full, and you're
  paid 60cr per unit of cargo lost with the wreck. The policy burns on the
  claim and lapses if you trade the frame in.
- **Bounty Office** (lawful docks). 0–3 warrants per market day on named pirate
  captains — light marks pay ~600–1100cr, heavy shielded marks ~1400–2300cr.
  Sign one and the mark spawns a few thousand units out; kill it and dock to
  collect. The same clerk will expunge a bad record with the local faction for
  a fine.

- **The lot.** Yards with hulls on the pad advertise on the open channel, and
  the pitch is keyed to what you're flying, hauling and can afford. It is very
  corny. This is intentional.
- **Modules.** 0–5 per station, rotating: cargo expanders, plating, shield
  boosters, aux tanks, fuel scoops, repair drones, engine tuning, luxury
  cabins, shielded holds, bribe encoders, station cores.
- **Crew.** Pilot, Gunner, Engineer, Navigator, Quartermaster, Recruiter,
  Tactical, Medic. Each takes a berth, draws a wage per dock, and grants a
  perk that levels L0–L9 through use. Morale falls with unpaid wages and long
  hauls and can end in a walkout (never on Easy, never with cheats on).
  Crew sometimes arrive with a pet, and you may pick up a **stowaway** who
  squats a berth marked "OUT OF ORDER" until they reveal themselves.
- **Character Sheet** (`C`) shows portraits, attributes, your ship
  silhouette, and a plain-language description of every fitted module.

---

## 7. Comms

Everything spoken routes into the **Comms** panel with `All` / `Crew` /
`External` / `Sys` tabs. Tabs are clickable, the panel collapses, the wheel
scrolls it. Ships, stations and colonies talk about their own situation —
damage, fleeing, crowded lanes, nebula wash, your reputation. `H` opens a
channel to a target inside 4000u: greet, ask for news or market word, beg
fuel, warn a hostile off, or pay restitution to repair standing.

---

## 8. Options worth changing early

- **Video** — glitch effects on/off, scanline density, HUD and reticle themes.
- **Audio** — master and SFX toggles.
- **Gameplay** — difficulty, contract board on/off, autosave.
- **Chat Windows** — Comms panel size, word wrap, tab behaviour.
- **Controls** — mouse-steer, gamepad, touch, full keybind editor.
- **Mods / Scripting** — load, order and configure Lua mods.

If the frame rate dips near a big star or black hole, lower scanline density
and turn glitch effects off.

**Saving:** plain JSON in `localStorage` under `voidwake.save.<slot>`, with
timestamps, plus `.json` export/import from the menu.

---

## 9. Modding and scripting

Mods are **Lua 5.3** (via Fengari) plus optional JSON content packs, loaded
from **Options ▸ Mods** by paste, file picker, or drag-and-drop — no code
editing and no build step.

- Scripts register hooks: `onCommodityTrade`, `onPassengerBoard`,
  `onPlayerStationTierUp`, `onPlayerHail`, `onCustomsScan`,
  `onShipHullChange`, `onBountyAccepted`, `onBountyClaimed`, and many more.

- They call into the `frontier.*` API for entities, world state, economy
  queries, chatter injection, and grants.
- Content packs can add chatter lines without any Lua at all.
- Errors are attributed to the offending mod instead of crashing the sim, and
  each mod can be toggled and reordered independently.

Worked examples: [`src/game/lua-samples.md`](src/game/lua-samples.md).

---

## 10. System requirements (estimated)

The game is a single HTML5 `<canvas>` drawing a character grid — no WebGL, no
3D acceleration, no downloads beyond the page itself.

**Minimum**

- Any browser released in the last ~4 years with `<canvas>` and ES2020
  support (Chrome/Edge 90+, Firefox 90+, Safari 15+).
- Dual-core CPU around 1.6 GHz. Rendering is CPU-bound text drawing.
- 2 GB RAM (roughly 200–350 MB for the tab).
- 1280×720 display. Smaller works but the HUD panels get cramped.
- Keyboard, or a touchscreen with touch controls enabled.
- ~5 MB of transfer for the hosted build; the offline single-file build is a
  few MB on disk.

**Recommended**

- Modern quad-core CPU, 4 GB+ RAM, 1920×1080 or larger.
- Chrome or Firefox for the smoothest text rendering.
- A gamepad if you prefer analogue flying.

**If it stutters:** turn glitch effects off, lower scanline density, shrink
the Comms panel, and use a smaller browser window. The hosted build at
<https://ascii-frontier.lovable.app/> generally animates more smoothly than
the offline single-file build.
