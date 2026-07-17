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
- `\` cycle **Comms** tab (All / Crew / External); `PgUp/PgDn` scroll the panel, `Home` jumps to newest
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

### Cross-universe rarities (rolled at generation)

- **Alien ruins** — every universe seeds **1–6 desolate ruin planets**.
  Fly within 200u to scan for a one-shot credit payout (~180–400cr) and
  +120 XP. Repeat flybys are silent — each ruin is recorded in
  `player.scannedRuins`.
- **UFO Mothership** — **1% chance per universe**. A capital-class
  hostile (hull 1200 / shield 600, boss bounty) accompanied by 3–4 UFO
  escorts. Killing the mothership pays the standard boss bounty.
- **Anomalous Homeworld** — **5% chance per universe**. A single alien
  world permanently ringed by 8–12 hostile `Anomalous Fighter` ships
  that engage anything non-alien within range.
- **Orbital mini-stations** — ~25% of civilian planets get one in low
  orbit. Dockable, but the menu is stripped to Market + Undock only
  (no crew, weapons, or modules).

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
  Warn, Permadeath, Crew Chatter, Glitch FX, Scanlines, HUD Color, Reticle
  Color, Reticle Shape, and **Comms Width / Comms Height / Comms Word Wrap**
  (0.5) which resize and word-wrap the top-left Comms panel.
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

Hired crew and your gunner draw a flat wage every time you dock: tactical
75cr, pilot 60cr, engineer 55cr, navigator 50cr, quartermaster/recruiter
45cr, merchant/gunner 30–40cr. Cheat Mode skips the payroll. If you can't
cover the full bill you pay whatever's on hand and the crew grumbles in the
COMMS feed — the shortfall is currently just cosmetic, but hooks are in
place for a real morale system later.

### Crew roles (0.5.4 / 0.5.5)

| Role | Effect |
|---|---|
| Gunner | auto-fires on hostiles, auto-mines rocks |
| Pilot | autopilot to current target (O); +150u radar |
| Engineer | slow hull regen, +75% shield recharge, −20% fuel; +150u radar |
| Merchant | +15% ore sell, −10% station buy prices |
| Navigator | +400u radar range, −10% fuel burn, unlocks WORMHOLE / MISSION / EXOTIC target cycle categories |
| Quartermaster | stacks +5% ore sell / −5% station buy on top of Merchant |
| Recruiter | −15% crew hire fees (including Xeno), halves morale decay on shortfall pay |
| Tactical | auto-fires main weapon on hostiles, +25% shield recharge — **mutually exclusive with Gunner** |

Gunner ↔ Tactical exclusivity is enforced at the hire menu: if either is
aboard, the other's row is greyed out and shows a "locked" note.

### Morale (0.5.5 → 0.5.6)

Every crewmember carries a `morale` field (0..100, new hires start at 100).
Wage shortfalls at dock drop morale by 15/dock (halved to 8 when a
Recruiter is aboard). Full-pay docks heal +2. Morale below 30 changes the
Comms grumble line from "Payday came up light" to "Morale's underwater —
fix this or we walk."

**0.5.6 gating (walk-outs):**

- **Cheat Mode** — wages and morale are skipped entirely. Crew never
  grumble, never walk. Safe sandbox.
- **Easy** difficulty — morale floors at 5. Crew still gripe when shorted
  but **never walk off**. A softer line is posted on short pay.
- **Normal / Hard / Brutal / Nightmare** — morale can hit 0 on repeated
  short pay. At 0, the crewmember walks off at that dock, is spliced from
  `player.crew`, and posts their `*_farewell_bad` line (or a generic
  `walkout` line if the role has none).

### Critical hits (0.5.6)

Every player shot rolls for a crit. Base chance is 8%; +5% with a Gunner
aboard; the Tactical Officer's auto-fire uses a 23% floor (the promised
"+15% crit chance" from the crew backlog). Crits apply a **2× damage
multiplier** and post a brief `★ CRIT` chatter line ("Gunner" /
"Tactical" / "Weapons") in the amber Comms color. NPC shots do not crit
— crits are a player-side feedback loop, not a two-way lottery.



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

## Ship-to-ship trade

Any friendly or neutral ship is a rolling market. Pull within **50u** at
throttle ≤ 5% and press **F** — a stripped-down station screen opens on
the target ship (Market only: sell ore / buy fuel at that ship's stock
prices). No refuel, no repair, no crew wages tick.

## Friendly rescue AI

Friendly ships now defend allies. Their engagement range against pirates
widened from 500u → 800u, and any friendly within 100u of an ally that's
being retaliated against will vector toward the aggressor — including the
player. Flying past a brawl no longer means the patrols ignore it.

## Xeno crew

Passive close-approach ticks against UFOs, thargoids, alien-swarm fighters,
and the UFO Mothership fill an internal `alienEncounters` counter. Once
you cross **5** encounters, every station's Crew page unlocks a
`Hire Xeno <Role>` entry at **2× the normal fee**. Xeno hires occupy a
regular berth and inherit their role's perk.

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

## Scripting (0.5.7 — Lua host + M2 mutation API)

A sandboxed Lua 5.3 runtime (fengari-web, ~200KB, bundled into the
offline HTML lazily on first enable) lives at `src/game/lua-host.ts`. It
wires user Lua directly into the `dispatchHook` callsites defined in
`voidwake.ts`.

Enable it from **Options ▸ Scripting**:

- `Scripting: ON/OFF` — toggles the runtime. Source and enable flag
  persist in `localStorage` (`voidwake.script.source` /
  `voidwake.script.enabled`).
- `Edit Script...` — opens a browser `prompt()` with the current
  source. Drag-drop `.lua` file loading arrives with M3 of the modding
  roadmap.
- `Reload Script` — re-runs the source (creates a fresh Lua state so
  every hook re-registers cleanly).
- `Clear Script` — wipes source and disposes the runtime.
- `Status:` — surfaces the last load or per-hook error.

The sandbox nulls `io`, `package`, `debug`, `require`, `dofile`,
`loadfile`, `load`, `loadstring`, `collectgarbage`, and replaces `os`
with a timing-only stub (`os.time` / `os.clock`). Errors from load,
top-level run, and per-hook invocation are trapped and echoed to the
Comms log — a bad script can never take down an engine tick.

### `frontier.*` API (M1)

```lua
print("engine version " .. frontier.version)

frontier.log("Hello from Lua!")
frontier.chat("Script", "Hooks online.", "#c4f")

frontier.on("onTick", function(payload)
  -- payload.dt : number  seconds since last tick
  -- payload.player : shallow table with pos, credits, xp, ...
end)

frontier.on("onPlayerDock", function(p)
  frontier.chat("Script", "Docked at " .. (p.entity.name or "?"))
end)
```

Payloads are depth-capped Lua tables with primitive leaves. Anything
past depth 2 is stringified so scripts never receive a live JS entity
handle. See "M2 mutation API" below for the writable surface added in
0.5.7 (credits, fuel, player snapshot). For copy-pasteable examples,
see [`lua-samples.md`](lua-samples.md) — 7 self-contained snippets
covering every hook shipped so far.

### Available hooks

| Hook                | Payload shape                              | Fired from                            |
| ------------------- | ------------------------------------------ | ------------------------------------- |
| `onWorldGenerate`   | `{ seed, entities }`                       | end of `generateUniverse()`           |
| `onTick`            | `{ dt, player, entities }`                 | top of `updatePlaying()`, post-pause  |
| `onPlayerFire`      | `{ weaponId, from, target }`               | pilot fire path                       |
| `onPlayerDock`      | `{ entity, kind: "station" \| "ship-trade" \| "planet" }` | inside `tryDock()` success paths  |
| `onEntityDestroyed` | `{ entity, byPlayer }`                     | ship/station → debris conversion      |
| `onChatter`         | `{ who, msg, color, channel }`             | end of `pushChatter()`                |
| `onSave`            | `{ slot, blob }`                           | after successful save (manual + auto) |
| `onLoad`            | `{ slot, blob }`                           | after successful load                 |
| `onPlanetLand`      | `{ entity }`                               | populated-planet landing (fires in addition to `onPlayerDock`) |

Payload shapes are stable — changes require a `VERSION` bump and a note
in this section. Additional hooks must land as no-op dispatchers first
so scripts written against them don't crash on older builds.

### Direct hook API (JS / devtools)

For non-Lua scripting (e.g. devtools poking), the same hooks are on
`window.ASCIIFrontier`:

```ts
window.ASCIIFrontier.registerScriptHook("onTick", ({ dt, player }) => {
  // ...
});
```



## Save format

Saves are plain JSON. They live in `localStorage` under
`voidwake.save.<slot>` and can also be exported/imported as `.json`
files from the menu. No encryption, no obfuscation — open them in any
text editor.

**0.5.2** adds an optional `chatter: ChatterLine[]` field so the Comms
feed survives Save / Load. Older saves that omit the field still load
cleanly — the engine backfills an empty feed.

## Wreckage sprites (0.5.2)

Ship and station kills convert the entity to `kind: "asteroid"` with
`name: "debris"` (ships) or `"wreckage"` (stations). The renderer now
detects wrecks via `isWreck(e)` and swaps in a dedicated palette
(`DEBRIS_FILLS` / `DEBRIS_TEX`) — cool grey scorched-hull colors and
angular `╱ ╲ ¦ · = / \ |` glyphs — plus a small per-cell spark flicker
(`*` / `+`) so wrecks read as "burning parts of a ship" rather than
just another rock. Salvage payout (mine the wreck to recover 1–3 ore,
+2 for former stations) is unchanged from 0.5.

## Populated planets (0.5.3)

~12% of `kind: "planet"` entities spawn as inhabited colonies. They
carry a `populated: true` flag and get a name prefixed with `◈` so
scanner labels, target panels, and chatter tags all read as inhabited
without a per-panel branch.

Land on one by targeting it and hitting `F` from within 300u at
throttle ≤ 5%. The dock screen opens directly on the `Market` page —
colonies expose ore/fuel trade only (no shipyard, no repair, no
weapon/module/crew shops) via the existing `isMini` branch in
`buildStationLines()`. Wages still tick per dock. Ambient chatter
routes populated planets through the new `planet_populated` template
with a `Colony {name}` speaker tag and an amber `#ffd28a` color so
comms cues match the market UI.

Fires `onPlayerDock` with `kind: "planet"` and the additional
`onPlanetLand` hook so scripts can distinguish colony landings from
station docks and ship-to-ship trades.

## How To Play overlay (0.5.7)

A six-page onboarding overlay is available from the main menu (between
`Load Game` and `Legend (Codex)`) and the pause menu. Pages cover:

1. **Premise** — high-level pitch and difficulty/cheat rules.
2. **Survive your first quest** — the 5-step "dock, buy work, complete,
   collect" loop with early-game warnings.
3. **Controls** — every bind, live from `options.keybinds` so rebinds
   render correctly.
4. **HUD & display** — cockpit, reticle, targeting brackets, radar,
   comms/log panes.
5. **Mouse-steer safety** — bold red warning explaining the
   "spinning cockpit" symptom and how to recover (center the mouse or
   disable Mouse-Steer under Options ▸ Controls).
6. **Tips & tricks** — credits, crew loadouts, hazards, and the new
   friendly-rescue interaction.

Content lives in `renderHowto()` and re-flows to the current viewport
width via an inline word-wrapper. ESC / the menu key closes back to
whichever screen opened it (`_howtoReturn`).

## NPC crit symmetry (0.5.7)

Hostile bullets that connect roll a crit at 6% base (10% for named
"boss" pirates), applying a 2× damage multiplier, a short screen shake,
and a red `‼` line in comms via the new `npc_crit` chatter pool. Cheat
Mode still short-circuits all damage before the crit roll, so the
sandbox stays safe.

## Morale perk attenuation (0.5.7)

Wage-shortfall morale decay now scales down per support role aboard,
with a floor of 3:

| Role          | Decay reduction |
| ------------- | --------------- |
| Recruiter     | −7              |
| Quartermaster | −3              |
| Merchant      | −2              |

A Recruiter + Quartermaster + Merchant crew still leaks 3 per short
paycheck (never zero — wages always matter). A bare crew loses the
full 15. Cheat Mode bypasses wages/morale entirely; Easy Mode floors
morale at 5 to prevent walkouts.

## Stranded-ship rescue (0.5.7)

Friendly / neutral hulls broadcasting `stranded_mayday` can now be
rescued directly by the player. Pull within 50u, cut throttle ≤ 5%,
and press `F`: you donate 15% of your fuel bar, the ship clears its
stranded flag, and you collect `+120cr / +40 XP / +3 rep` with its
faction plus a `stranded_thanks` chatter line. Requires at least 20%
of your own fuel remaining, so the interaction can't strand *you*.

SPD Patrols still auto-tow stranded lawful hulls (unchanged) — the
player rescue is an additional path, not a replacement.

## M2 mutation API (0.5.7)

The Lua host bridge now exposes a small, audited write surface:

```lua
local bal  = frontier.addCredits(500)   -- returns new balance, nil if no player
local fuel = frontier.addFuel(-10)      -- returns new fuel amount
local snap = frontier.player()          -- read-only snapshot table
if snap and snap.hull / snap.hullMax < 0.25 then
  frontier.chat("Script", "Hull critical: " .. snap.hull, "#ff5555")
end
```

Everything else — entities, missions, universe seed — remains read-only
until M3 (mod bundles + entity mutation). Bridge mutators are optional
so older host code keeps loading unchanged.

## Comms panel — System tab & wheel scroll (0.5.10)

The Comms panel now has four tabs, cycled by `\`:

- **All** — everything.
- **Crew** — crew-labeled voices (`Gunner`, `Pilot`, `Computer`, …).
- **Ext** — external (hostiles, patrol, stations, colonies, banter).
- **Sys** — ship computer output (`Sensors`, `Radio`).

Scrolling: mouse wheel scrolls the panel when the cursor is inside its
rect; anywhere else on the canvas the wheel still adjusts throttle.
PgUp / PgDn and Home keep working as before.

## Chatter pool depth (0.5.10)

Every speaker pool with lines received a broad expansion — hostiles,
boss captains, friendlies, neutrals, stations, planets, colonies,
patrol, patrol-tow, patrol-arrest, mayday, crit-hit, npc-crit,
walkout, stranded-thanks, every crew role's `*_idle`, and `banter`.
Aim: no repeats within a single long session at `Lively` frequency.


