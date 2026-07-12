# VOIDWAKE — ASCII Space Sim

A fully playable ASCII-rendered space simulation inspired by Elite Dangerous.
Rendered to an HTML5 `<canvas>` using a monospaced glyph grid.

## Architecture

The engine is a single class `Voidwake` defined in `voidwake.ts`. It is
organized into clearly labeled sections so you can extend it without
hunting around:

```
voidwake.ts
├─ RNG                  seeded PRNG (mulberry32)
├─ Types                interfaces for entities, player, ship, options
├─ Universe             procedural generation of stars/planets/asteroids/stations/ships
├─ AI                   simple state machines (friendly/neutral/hostile/station)
├─ Player Systems       combat, mining, trading, missions, progression
├─ Input                keyboard handling
├─ Menu                 ESC menu, character creation, ship customization, options (Gameplay / Audio / Controls + Keybinds sub-page)
├─ Save / Load          unencrypted JSON via localStorage + download/upload
├─ Render               ASCII grid renderer + cockpit HUD + 3D radar
└─ Loop                 fixed-timestep update + render
```

The React wrapper `src/components/VoidwakeGame.tsx` only mounts the canvas
and forwards lifecycle events.

## Offline build

The engine can be bundled into a single HTML file that works without a server
or internet connection. From the project root run:

```bash
bun run build:offline
```

Open `dist-offline/ascii-frontier-offline.html` in any modern browser. If
your browser blocks `localStorage` for file:// URLs, serve the folder locally:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/dist-offline/ascii-frontier-offline.html`.

## How to play

- `W/S` throttle up/down (or **scroll the mouse wheel** — up = faster, down = slower)
- `A/D` yaw left/right
- `Q/E` pitch up/down
- `Space` fire weapons
- `M` mine targeted asteroid
- `T` cycle target
- `F` dock with targeted station (must be close & slow)
- `B` buy/sell menu at station
- `J` accept mission at station
- `[` / `]` cycle target by category (stations / rocks / hostiles / ...)
- `G` toggle hired gunner AUTO / STANDBY
- `O` toggle hired **Pilot autopilot** to current target (full auto: fly, auto-dock stations, hold orbit). Mouse steering is suppressed while engaged and does **not** disengage it — press `O` again to take back manual control. A blinking banner near screen center reminds you it's on.
- `U` open Quest Log popup
- `K` pin / unpin quest tracker
- `L` open Codex (symbols / colors / keys)
- `P` pause
- `ESC` main menu (New / Save / Load / Options / Quit)

## Controller support (gamepad)

Any browser-visible controller with a **standard mapping** works out of the box
— Xbox / DualShock / DualSense / 8BitDo / Steam Deck / Backbone / most
generic USB pads. The layout is:

| Button | Action |
|---|---|
| Left stick | yaw / pitch |
| Right stick Y | throttle up/down |
| D-pad | throttle up/down + target cycle prev/next (also arrow keys in menus) |
| A / Cross | fire (also ENTER in menus) |
| B / Circle | menu / back (ESC) |
| X / Square | mine |
| Y / Triangle | dock |
| LB / L1 | previous target category |
| RB / R1 | next target category |
| LT / L2 | boost (afterburner) |
| RT / R2 | fire |
| Back / Select / Share | open Codex |
| Start / Options | pause |
| L3 (click LS) | toggle gunner |
| R3 (click RS) | toggle autopilot |

Configure it under **Options ▸ Controls ▸ Gamepad** (`auto` / `on` / `off`)
and **Options ▸ Controls ▸ Gamepad Deadzone** (0–0.5). "auto" enables the pad
the moment one is plugged in. Because the controller maps through your
keybinds, any key you rebind under **Options ▸ Controls ▸ Configure Keybinds…**
is remapped for the pad too.

## Touch controls (tablet / phone / handheld)

`Options ▸ Controls ▸ Touch Controls` (`auto` / `on` / `off`) enables an on-screen
overlay:

- **Virtual stick** — bottom-left. Tap anywhere in the lower-left, then drag
  in the direction you want to yaw / pitch. Release to re-center.
- **Throttle strip** — thin column on the far left. Drag up for more speed,
  down for less. It sets the throttle absolutely, so you can "cruise-lock"
  by lifting your finger.
- **Button pad** — cluster of labeled squares in the lower-right: `FIRE`,
  `MINE`, `DOCK`, `TGT`, `[` / `]`, `BOOST`, `JETT`, `AUTO`, `GUN`, `CDX`,
  `PAUS`, `MENU`.

"auto" turns the overlay on for coarse-pointer devices (phones, tablets,
Steam Deck touchscreen) and off for desktops. In menus, dragging the stick
also drives the ↑/↓/←/→ cursor, and tapping `FIRE` acts as ENTER — so the
whole game can be played thumbs-only.

On any list-style menu (main menu, options, save/load, quit-confirm, …) the
touch surface is repurposed:

- **Tap a menu entry** to move the cursor to it and confirm in one gesture.
- **Swipe right (→)** to confirm the current selection (same as ENTER).
- **Swipe left (←)** to go back (same as ESC).

The virtual stick and buttons don't render on menu screens, so a stray drag
won't accidentally start flying the ship.

## Universe

The play area is a cube roughly 54k units across (radius 27k — expanded
from 18k). Anything past 5k from your ship renders as a single colored
period; past 10k it's culled entirely — so the deep sky is a moving field
of pinpricks that only resolve into stars, planets, stations, and traffic
as you cruise toward them. Populations (planets, asteroids, stations,
traffic, comets, nebulae, beacons, wrecks) were scaled up by ~3.4× to keep
on-screen density roughly constant as the play volume grew.

Stars are drawn by spectral class — blue supergiants, red giants, sun-like
yellows, orange dwarves, red dwarves, white dwarves — each with a matching
color, size, and halo. Two exotic classes round out the sky: **pulsars
(`PSR`)** are tiny neutron stars whose fill visibly blinks at ~1 Hz, and
**black holes (`BH`)** are dark cores rimmed by a red-orange accretion
glow that bend your course with real inverse-square gravity when you fly
close. Cross the event horizon and you die instantly. Planets pull from a
broader palette (oceans, deserts, gas giants, ice worlds, molten worlds,
storm giants). Nebulae come in eight color families, render with irregular
noise-driven outlines, drain shields, and garble the COMMS panel while
you're inside one.

Roughly a third of civilian and pirate ships fly under a **named pilot
callsign** — hostiles get `Ace / Reaver / Fang / …`, friendlies get
`Cmdr / Lt. / Capt.`, neutrals get `Trader / Freerunner / …`. The current
target's pilot, when present, is shown as `pilot: …` in the cockpit
target panel.

## Rare phenomena

Every so often — genuinely rarely — the frontier throws something strange
at you. The scheduler waits ~30 minutes into a session for the first
surprise, then rolls once every 1–2 hours of play. They're meant to feel
like postcards from the deep, not a rotating event calendar:

- **UFOs (`◉`)** — cyan-green wanderers. Get close and one will pace your
  ship, observe for a few seconds, then boost away at absurd speed.
- **Unknown Contacts (`Ѫ` — "Thargoid-like")** — extremely rare. Exactly
  one exists in the universe and its dormant timer is 60–120 minutes;
  after it triggers, warps in, projects a ~10s EMP field (zeroing throttle,
  autopilot, and weapons), transmits gibberish, and departs, the same
  60–120 minute cooldown re-arms. Prior versions bugged this to seconds,
  so encounters felt like every few minutes.
- **Traversable wormholes (`Ø`)** — paired rifts. Fly within 60u of one and
  you emerge next to its sibling somewhere across the universe.
- **Dyson swarm (`◇`)** — a ring of collector platforms encircling one lucky
  star. Cosmetic (for now); a genuine wonder to stumble across.
- **Derelict wrecks (`†`)** — silent, drifting hulks. Fly within 40u to
  salvage credits + ore. No trap, no fight — just loot and a bit of
  environmental storytelling. Cycle to them with `[` / `]` (DERELICT).
- **Jetsam** — jettisoned cargo canisters. Your own `X` drops leave a
  recoverable canister behind you, and derelict jetsam fields drift into
  scanner range from time to time.
- **Encoded relics** — roughly 1-in-50 mined fragments turn out to be an
  ancient encoded datacore. Instant payout (~30–90cr + XP), no cargo slot
  consumed. Applies to manual mining and gunner auto-mining alike.
- **Alien transmissions** — untranslatable glyph strings appear on the COMMS
  feed (ambient, not on the rare-event timer — more often near nebulae or
  during a Thargoid encounter).

Weapon shots, engine exhausts, comets, and distant suns all glow.

## HUD banners & reticle

A faint `+` crosshair marks the viewport center — that's where the guns
point, and where mouse-steer now pulls the cursor toward (previously the
neutral point was the canvas center, which sat left of the reticle because
the right-hand HUD panel eats ~28 columns). Persistent status banners
appear stacked below the top of the viewport:

- **LOW HULL** — blinking red under 30%.
- **CARGO HOLD FULL** — amber, prompts to sell or `J` jettison.
- **SCOOPING FUEL** — pulses amber while skimming a star corona.

Pressing `P` freezes the world and shows a session stat line under the
pause banner: elapsed play time (`hh:mm:ss`), current credits, kill count,
and total cargo units.

## Damage feedback

Shields collapsing tint the screen cyan-white for a beat; taking any hull
damage tints it red *and* jolts the grid a couple of pixels — bigger hits
shake harder. Both effects fade cleanly and are suppressed for players
with `prefers-reduced-motion` enabled.

## Fuel scooping

Fly close (but not too close) to a star and your Engineer will scoop the
corona for free fuel. The sweet spot scales with the star's apparent
size — big blue giants scoop from further out than red dwarves. Get too
close and the corona starts etching your shields and then your hull.
Black holes and pulsars are *not* safe to scoop from.


## Character creation

The name field is prefixed with `Cmdr` in the display — just type your
name (e.g. `Nosaj`) and the HUD will render it as `Cmdr Nosaj`. Case is
preserved, and an accidentally typed leading `Cmdr ` is stripped so you
won't end up with `Cmdr Cmdr Nosaj`.

### Species

Eight species are selectable at commander creation. Every one has an
upside and a matching downside, plus a **role affinity** — a crew member
of that species gives a small extra boost when serving in the matching
role. Player-species passives apply automatically; crew-species affinity
is folded into the same helpers so effects stack cleanly.

| Species | Bonus | Drawback | Affinity |
|---|---|---|---|
| Human | +3% sell / −3% buy prices | No standout strength | Merchant |
| Android | −15% fuel burn | −10% hull max | Engineer |
| Reptilian | −10% weapon cooldown | −10% shield max | Gunner |
| Aquilan | +250u radar range | +5% fuel burn | Pilot |
| Drift-born | +10% XP earned | −5% top speed | Merchant |
| Sylph | +8% top speed, +200u radar | −15% hull max | Pilot |
| Voidkin | +10% shield max | −10% cargo capacity | Engineer |
| Chorus | +8% XP earned | −5% top speed | Merchant |

### Ship hulls (unlocks)

The base four hulls (Sparrow Scout, Mule Freighter, Wasp Interceptor,
Pickaxe Industrial) are always available. Additional hulls unlock based
on your commander's **species** and whether at least one prior save
exists on this device:

| Hull | Unlock |
|---|---|
| Warhawk Gunship | Reptilian |
| Skyeye Recon | Aquilan / Sylph |
| Nomad Cell-Ship | Android / Voidkin |
| Drift Barge | Drift-born |
| Wayfarer Explorer | Human / Chorus |
| Veteran Corvette | prior save on this device |
| Phoenix Prototype | prior save on this device |

Every hull's berth count has been raised so up to two additional crew
members can be seated compared to the old baseline — Crew Quarters
modules still stack +1 each on top.

### Gunner weapon slot

Ships now carry a **dedicated gunner weapon slot** in addition to the
pilot's primary. Buy or unmount it from the station's **Gunner Bay** page.
When populated, the gunner autopilot fires that weapon exclusively (with
the usual 15% cadence penalty on top of its base cooldown). Damage is
computed from the gunner's weapon on gunner-fired shots. Gunner-mount
hardware runs at a 25% premium over the pilot loadout price.



## Options menu

The **ESC ▸ Options** screen is organized into three subsections plus a
Keybinds sub-page:

- **Gameplay** — Difficulty, Peaceful Mode, Cheat Mode, Autosave, Unsaved
  Warn, Permadeath, Crew Chatter.
- **Audio** — Master / SFX / Music volume, Radio preset, Radio URL.
- **Controls** — Mouse Steer, Mouse Sensitivity, Gamepad, Gamepad Deadzone,
  Touch Controls, Show FPS, and **Configure Keybinds…** which opens a full
  rebind screen. On the Keybinds screen, ENTER on any action arms rebind
  capture — press the new key (ESC cancels). "Reset Keybinds to Defaults"
  lives at the bottom of that same page.

ESC in a subsection returns to the Options hub; ESC on the hub returns to
the main menu.

## Radio

**Options ▸ Audio ▸ Radio** picks the in-game music source:

- **Off** — no music.
- **Chiptune • Drift / Frontier / Arcade Runner / Nebula Cradle** —
  procedurally generated 8-bit tunes; no assets, works offline.
- **SomaFM • Deep Space One / Space Station / Mission Control / DEF CON** —
  free space-themed internet streams.
- **Custom URL** — plug in your own stream (**Options ▸ Audio ▸ Radio URL**,
  press ENTER to enter one).

Music volume is the `Music Volume` slider one row above; changes take
effect immediately.

## Crew & wages

Hired crew and your gunner draw a flat wage every time you dock: pilot 60cr,
engineer 55cr, merchant/gunner 30–40cr. Cheat Mode skips the payroll. If you
can't cover the full bill you pay whatever's on hand and the crew grumbles
in the COMMS feed — the shortfall is currently just cosmetic, but hooks are
in place for a real morale system later.

## Outfitting (module shop)

Dock at a station and open **Module Shop** to buy passive upgrades. Each
station carries a rotating slice of the catalog (2–5 modules per stop) at
±20% price jitter. All modules are single-install — dupes are blocked.

| Module | Price (base) | Effect |
|---|---|---|
| Cargo Expander | 800cr | +12 cargo capacity |
| Shield Booster | 1100cr | +25 shield max (also refills) |
| Afterburner OD | 650cr | boost multiplier 1.6× → 1.92× |
| Auto-Loader | 900cr | −15% weapon cooldown (player + gunner) |
| Loot Magnet | 500cr | pickup radius 20u → 60u |
| Crew Quarters | 1400cr | +1 crew berth |
| Sensor Array | 950cr | +600u radar range |
| Engine Tune | 1200cr | +15% top speed |
| Reinforced Plating | 1000cr | +40 hull max (also repairs 40) |
| Aux Fuel Tank | 700cr | +50 fuel max (also refills 50) |
| Long-Range Scanner | 1300cr | +1000u radar range (stacks with Sensor Array) |

## Notorious pirate captains

Roughly 5% of respawned raiders are named captains (Warlord / Blackwake /
Ironmaw …). They have +50% hull and shield, pay out a ~450cr bounty plus
extra XP on kill, drop a fatter "captain's cache" canister, and shift
faction reputation ~3× as hard as a rank-and-file pirate. A one-line
sensor alert announces them when they spawn.

## Adding new content

- **New ship hull**: append to `SHIP_HULLS` in `voidwake.ts`.
- **New species**: append to `SPECIES` array.
- **New mission type**: extend the `MissionKind` union and handle in
  `generateMission()` and `tickMissions()`.
- **New entity type**: extend `EntityKind`, add a generator in the
  Universe section, an AI handler in the AI section, and a glyph in
  `GLYPHS`.

## Save format

Saves are plain JSON. They live in `localStorage` under
`voidwake.save.<slot>` and can also be exported/imported as `.json`
files from the menu. No encryption, no obfuscation — open them in any
text editor.
