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

- Player-station cosmetic customization.
- NPC trade AI actually moving cargo between stations.
- Faction-specific commodity bans beyond the relic rep hint.
- Route-hint HUD ("Buy X here, sell at Industrial +42%").
