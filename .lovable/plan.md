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
