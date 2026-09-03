# ASCII Frontier — Lua Sample Scripts

Drop any snippet below into **Options ▸ Scripting ▸ Edit Script…**, hit
`Reload Script`, and the sandbox will start firing hooks on the next tick.
All scripts run inside the fengari-web sandbox shipped in 0.5.5. See
`src/game/README.md ▸ Scripting hooks` for the full API surface.

Every sample is self-contained. Paste one at a time to see how it behaves;
the `Status:` row under Options ▸ Scripting surfaces any error.

---

## 1. Hello, cockpit

Confirms scripting is on and shows how `frontier.log` / `frontier.chat` differ.

```lua
frontier.log("scripting online — engine v" .. frontier.version)
frontier.chat("Computer", "All hands: helper script attached.", "#7fd0ff")
```

---

## 2. Distress beacon overlay

Whenever anyone posts a chatter line containing "mayday", echo a bold
computer-tagged summary into Comms.

```lua
frontier.on("onChatter", function(evt)
  local msg = tostring(evt.message or "")
  if msg:lower():find("mayday") then
    frontier.chat("Computer",
      "⚠ Mayday intercepted from " .. tostring(evt.speaker or "?") .. ".",
      "#ffcc55")
  end
end)
```

---

## 3. Double-credits mod (M2 mutation API)

Every time you dock at a station, top up 500 credits.

```lua
frontier.on("onPlayerDock", function(evt)
  if evt.kind == "station" then
    local newBalance = frontier.addCredits(500)
    frontier.log("dock bonus: +500cr → " .. tostring(newBalance))
  end
end)
```

---

## 4. Fuel-safety net

If a player-fired shot lands and the pilot's fuel is under 15%, refill 10%
of a full tank and warn the crew. Uses `frontier.player()` to read state and
`frontier.addFuel` to write it back.

```lua
frontier.on("onPlayerFire", function(_)
  local p = frontier.player()
  if not p then return end
  local fuel = tonumber(p.fuel) or 0
  local fuelMax = tonumber(p.fuelMax) or 100
  if fuel / fuelMax < 0.15 then
    local n = frontier.addFuel(fuelMax * 0.10)
    frontier.chat("Computer",
      "Emergency reserves tapped: fuel " .. string.format("%.0f", n),
      "#ffcc55")
  end
end)
```

---

## 5. Kill tracker

Counts destroyed hostiles killed by the player and posts a chatter line
every 5 kills.

```lua
local kills = 0
frontier.on("onEntityDestroyed", function(evt)
  if evt.byPlayer and evt.kind == "hostile" then
    kills = kills + 1
    if kills % 5 == 0 then
      frontier.chat("Computer",
        "Kill streak: " .. kills .. " hostiles down.",
        "#ff8a8a")
    end
  end
end)
```

---

## 6. Save-slot heartbeat

Log every save so you can spot autosave frequency while tuning.

```lua
frontier.on("onSave", function(evt)
  frontier.log("save@" .. tostring(evt.slot or "?") .. " " ..
               (evt.auto and "(auto)" or "(manual)"))
end)
```

---

## 7. Colony announcer

When you land on a populated planet, greet the colony over the ship
computer.

```lua
frontier.on("onPlanetLand", function(evt)
  local name = (evt.entity and evt.entity.name) or "the colony"
  frontier.chat("Computer",
    "Landing complete at " .. name .. ". Local time: " ..
    tostring(math.floor(os.time() % 86400 / 3600)) .. ":00.",
    "#ffd28a")
end)
```

---

## Notes

- Every hook payload is a shallow, read-only Lua table (depth 2). Nested
  entity handles are stringified — you cannot mutate live game state
  through them. Use the explicit `frontier.*` writers instead.
- `frontier.on` accumulates handlers across `Reload Script`; if you want
  a clean slate, use `Clear Script` first.
- Scripts do not persist across a `VERSION` bump if they reference a
  hook name that was removed. Existing hooks are treated as a stable
  API surface — see `src/game/README.md`.

---

## 8. Batched grant (0.7.0)

Reward a mission-style flourish in one call.

```lua
frontier.on("onPlayerDock", function(evt)
  if evt.kind == "station" then
    local snap = frontier.grant{ credits = 250, xp = 10, fuel = 5 }
    if snap then
      frontier.chat("Computer",
        "Docking bonus paid. Balance: " .. tostring(snap.credits) .. "cr.",
        "#7fd0ff")
    end
  end
end)
```

---

## 9. Scan the sector (0.7.0)

Poll nearby entities every world tick and log each hostile once.

```lua
local seen = {}
frontier.on("onTick", function(_)
  local hostiles = frontier.entities.list{ kind = "hostile", max = 32 }
  for _, e in ipairs(hostiles) do
    if not seen[e.name] then
      seen[e.name] = true
      frontier.log("scanner: " .. e.name .. " logged at " ..
        string.format("%.0f,%.0f,%.0f", e.x or 0, e.y or 0, e.z or 0))
    end
  end
end)
```

---

## 10. Content pack: extra gunner chatter (0.7.0)

Append flavor lines to the existing `gunner_idle` pool. Ships alongside
core content — no engine edit required.

```lua
local lines = {
  "Reticle's a little sticky today.",
  "Barrel temp nominal. Barely.",
  "I taught the autoloader a new trick. Don't ask.",
}
for _, l in ipairs(lines) do
  frontier.chatter.add("gunner_idle", l)
end
frontier.log("mod: +" .. #lines .. " gunner lines")
```

---

## Mods vs user scripts

The 0.7.0 **Options ▸ Mods** submenu accepts multi-script bundles as
JSON `{ id, name, script?, chatter? }`. Every enabled mod is
concatenated ahead of the "Edit Script..." user source and loaded into
the same sandbox, so the snippets above work equally well as a mod
script or a user script. Wrap `local` state you want private to a mod
in a `do ... end` block — the loader already does this per-mod, but
doubling up is safe.

Editing:
- **Edit Script...** and **Edit Highlighted Mod...** open a full-canvas
  textarea overlay. Ctrl+S saves and reloads the Lua host; Esc cancels.
  There is no 2 KB paste limit — drop a `.lua` file or paste a full
  bundle.
- **Remove Highlighted Mod** deletes whichever mod row your cursor last
  touched, even if you have scrolled down to the action rows.

## 11. Data-only content pack (no Lua) (0.7.0)

A mod with only a `chatter` block adds lines to existing crew/NPC pools
without any script. Save this as `.json` and drop it on the game window
(or paste it into **Add Mod...**):

```json
{
  "id": "salty-gunner",
  "name": "Salty Gunner Voice Pack",
  "chatter": {
    "gunner_idle": [
      "Reticle wants blood.",
      "Ammunition: yes.",
      "I've named the guns. Left one bites."
    ],
    "pilot_idle": [
      "Nav's clear. Suspiciously clear."
    ]
  }
}
```

Enabled data-only packs are applied on install, on **Reload All Mods**,
and every time the Lua host reloads — a script-only mod set does not
strip these lines.




---

## 12. Contract triage (0.8.7)

`frontier.contracts()` returns the whole log (max 3). This bark warns you when
a passenger deadline is inside two minutes.

```lua
frontier.on("onTick", function(_)
  for _, c in ipairs(frontier.contracts()) do
    if c.deadlineIn and c.deadlineIn < 120 and not c._warned then
      frontier.chat("Computer",
        "Deadline in " .. string.format("%.0f", c.deadlineIn) .. "s: " .. c.description,
        "#ffcc55")
    end
  end
end)
```

## 13. Holdings ledger (0.8.7)

`frontier.holdings()` reports every station you own, its tier, treasury, lane
count and current income rate.

```lua
frontier.on("onMissionAccepted", function(m)
  frontier.log("signed: " .. tostring(m.description))
  for _, h in ipairs(frontier.holdings()) do
    frontier.log(string.format("%s T%d — %dcr banked, %d lanes, %dcr/min",
      h.name, h.tier, h.treasury, h.routes, h.incomePerMinute))
  end
end)

frontier.on("onMissionAbandoned", function(m)
  frontier.chat("Computer", "Contract voided: " .. tostring(m.description), "#ff8a8a")
end)

frontier.on("onTradeRouteEstablished", function(r)
  frontier.log("lane open: " .. r.station .. " <-> " .. r.partner .. " (" .. r.commodity .. ")")
end)
```

## Frontier event watcher (0.9.0)

Announce every advisory as it lands, and hand the pilot a nudge when a boom is
close enough to be worth the burn.

```lua
frontier.on("onFrontierEvent", function(ev)
  if ev.phase == "start" then
    frontier.chat("Broker", ev.title .. " at " .. ev.station .. " — " .. (ev.minutes or 0) .. " min window.", "#ffd28a")
  else
    frontier.log("Advisory closed: " .. ev.title .. " (" .. ev.station .. ")")
  end
end)

frontier.on("onPlayerDock", function()
  for _, e in ipairs(frontier.events()) do
    if e.distance < 20000 then
      frontier.chat("Broker", e.title .. " still live at " .. e.station
        .. " (" .. math.floor(e.secondsLeft / 60) .. " min): " .. e.advice, "#9fe")
    end
  end
end)
```

## Navigation assistant (0.9.1)

Uses the 0.9.1 navigation surface: read the tracked contact, file waypoints, and
only act while the pilot is actually flying.

```lua
-- Feature-detect first: older builds have no frontier.hooks().
local available = {}
if frontier.hooks then
  for _, name in ipairs(frontier.hooks()) do available[name] = true end
end

-- Drop a breadcrumb every time you pass something interesting.
frontier.on("onEntitySpawned", function(e)
  if e.kind == "wormhole" then
    frontier.bookmark("Gate " .. e.id, e.x, e.y, e.z)
  end
end)

-- Range callouts, but only in flight (never over a menu).
local lastBand = nil
frontier.on("onTick", function()
  if frontier.screen() ~= "playing" then return end
  local t = frontier.target()
  if not t then lastBand = nil; return end
  local band = math.floor(t.distance / 1000)
  if band ~= lastBand then
    lastBand = band
    frontier.chat("Computer", t.name .. " at " .. t.distance .. "u", "#7fd0ff")
  end
end)

-- Snap to the nearest hostile when one turns up inside 3000u.
frontier.on("onPlayerDamaged", function()
  local near = frontier.entities.list({ kind = "hostile", radius = 3000, max = 1 })
  if near[1] then frontier.setTarget(near[1].id) end
end)
```

## Payroll and cargo auditor (0.9.2)

Uses the 0.9.2 hooks and read surfaces: watch the wage bill, warn before a
shortfall wrecks morale, and keep a running note of manifest changes.

```lua
frontier.on("onCrewPaid", function(p)
  if p.short then
    frontier.chat("Purser", "Payroll short by " .. (p.bill - p.paid)
      .. " cr at " .. p.station .. ". Morale will bite.", "#ff9a9a")
  else
    frontier.log(("Payroll settled: %d cr for %d crew (%d cr wing)")
      :format(p.paid, p.crew, p.wingBill or 0))
  end
end)

frontier.on("onCargoChanged", function(c)
  for _, row in ipairs(c.changed) do
    local sign = row.delta > 0 and "+" or ""
    frontier.log("Hold: " .. sign .. row.delta .. " " .. row.id
      .. " (now " .. row.qty .. ", hold " .. c.total .. ")")
  end
end)

frontier.on("onBookmarkRemoved", function(b)
  frontier.log("Nav Log cleared: " .. b.name)
end)

-- Read surfaces: roster, holdings and engine load in one status line.
frontier.on("onPlayerDock", function()
  local best, lvl = nil, -1
  for _, c in ipairs(frontier.crew()) do
    if (c.level or 0) > lvl then best, lvl = c.name, c.level or 0 end
  end
  local perf = frontier.perf()
  frontier.log(("Top crew: %s (L%d) · fps %s · entities %s")
    :format(best or "none", lvl, tostring(perf.fps), tostring(perf.entities)))
end)
```

## Conversation coach (0.9.3)

Watches the hail conversation tree: logs each node you walk, warns when the
channel is going cold, and pays a small bonus for talking a hostile down.

```lua
frontier.on("onHailTopic", function(h)
  frontier.log(("[comms] %s ▸ %s (mood %d, %s)")
    :format(h.target or "?", h.topic, h.mood or 0, h.disposition or "?"))
  if (h.mood or 0) <= -2 then
    frontier.chat("Comms Officer", "They're about to stop talking, Captain.", "#ffd28a")
  end
end)

frontier.on("onHailClosed", function(h)
  if h.tone == "warm" then
    frontier.chat("Comms Officer", "Channel closed on good terms. Rare.", "#7CFC00")
  elseif h.tone == "cold" then
    frontier.grant{ credits = 0 }  -- no reward; just note it
    frontier.log("[comms] " .. (h.target or "contact") .. " signed off hostile.")
  end
end)

-- Probe a contact before you open a channel at all.
frontier.on("onTick", function()
  local t = frontier.target()
  if t and frontier.disposition(t.id) == "hostile" and (t.distance or 9e9) < 1500 then
    frontier.log("[comms] hostile in comms range — bribe or bluff, your call.")
  end
end)
```

## Priority broker (0.9.4)

Reacts to reputation-gated work handed out over a hail: logs the gate you
cleared, calls out the fattest offer, and nudges the crew when a priority
contract lands.

```lua
frontier.on("onHailWork", function(w)
  local best = nil
  for _, m in ipairs(w.offers or {}) do
    if not best or (m.reward or 0) > (best.reward or 0) then best = m end
  end
  frontier.log(("[work] %s offered %d job(s) — standing %d, rank %s%s")
    :format(w.target or "?", #(w.offers or {}), w.standing or 0,
            w.rank or "?", w.priority and ", PRIORITY" or ""))
  if best then
    frontier.chat("Quartermaster",
      ("Best of the batch: %s for %dcr."):format(best.description, best.reward),
      w.priority and "#ffe066" or "#9fe")
  end
end)
```

## Faction ledger (0.9.5)

Contracts now carry `faction` and `issuer` on `onMissionAccepted`,
`onMissionCompleted`, `onHailWork` offers, and every `frontier.contracts()` row.
Full versions of both files ship in the repo:

- `src/game/samples/faction-ledger.lua` — user script for **Edit Script…**
- `src/game/samples/faction-broker.mod.json` — installable bundle for
  **Options ▸ Mods ▸ Add Mod…** (script + chatter pack in one file)

```lua
frontier.on("onMissionAccepted", function(m)
  frontier.log(("signed for %s [%s]: %s (%dcr)")
    :format(m.issuer or "no house", m.faction or "freelance", m.description, m.reward or 0))
end)

frontier.on("onMissionCompleted", function(m)
  if not m.faction then return end
  local rep = frontier.reputation() or {}
  frontier.chat("Purser",
    ("%s settled — standing with %s now %d."):format(m.issuer, m.faction, rep[m.faction] or 0),
    "#9fe")
end)

-- Summarise the log by issuing house whenever you dock.
frontier.on("onPlayerDock", function(evt)
  if evt.kind ~= "station" then return end
  local byHouse = {}
  for _, c in ipairs(frontier.contracts()) do
    local k = c.faction or "freelance"
    byHouse[k] = (byHouse[k] or 0) + 1
  end
  local parts = {}
  for house, n in pairs(byHouse) do parts[#parts + 1] = house .. "x" .. n end
  frontier.log("log by house: " .. table.concat(parts, ", "))
end)
```

## Fleet & refit logbook (0.9.6)

`frontier.fleet()` returns the frame you are flying (`active == true`) followed
by every frame berthed in a hangar, each with its refit levels. Combined with
the new hangar hooks it makes a small fleet ledger:

```lua
local function describe(f)
  local bits = {}
  for stat, lvl in pairs(f.refit or {}) do
    if lvl > 0 then table.insert(bits, stat .. " L" .. lvl) end
  end
  return string.format("%s — hull %d, fuel %du, cargo %d, berths %d%s%s",
    f.name, f.hull, f.fuel, f.cargoMax, f.berths,
    #bits > 0 and (" [" .. table.concat(bits, ", ") .. "]") or "",
    f.active and " (flying)" or (" @ " .. tostring(f.station)))
end

frontier.on("onHullRefit", function(r)
  frontier.chat("Yard", string.format("%s refit to level %d for %dcr.", r.stat, r.level, r.cost), "#6f9")
end)

frontier.on("onFleetStored", function(f)
  frontier.log("berthed " .. f.name .. " at " .. f.station .. " (" .. f.fleetSize .. " in hangar)")
end)

frontier.on("onFleetSwapped", function(f)
  frontier.chat("Computer", "Now flying the " .. f.name .. "; " .. f.previous .. " berthed.", "#9fe")
  for _, ship in ipairs(frontier.fleet()) do frontier.log(describe(ship)) end
end)

frontier.on("onFleetSold", function(f)
  frontier.log("sold the berthed " .. f.name .. " for " .. f.paid .. "cr")
end)
```

## Fleet payroll watcher (0.9.7)

Berthed frames on a standing duty settle a pay period every minute. This script
logs each settlement, nags you when an account fills, and calls out an incident.

```lua
frontier.on("onFleetDuty", function(f)
  frontier.log(("[fleet] %s -> %s @ %s"):format(f.name, f.duty, f.station or "?"))
end)

frontier.on("onFleetIncome", function(f)
  frontier.log(("[fleet] %s banked %dcr (%dcr total, fuel %d)")
    :format(f.name, f.paid or 0, f.banked or 0, f.fuel or 0))
  if (f.banked or 0) >= 20000 then
    frontier.chat("Purser", f.name .. "'s account is nearly full — collect it.", "#ffcc55")
  end
end)

frontier.on("onFleetIncident", function(f)
  if f.reason then
    frontier.chat("Purser", f.name .. " stood down: " .. f.reason .. ".", "#ffcc55")
  else
    frontier.chat("Purser", ("%s took %d damage on duty (hull %d)")
      :format(f.name, f.damage or 0, f.hull or 0), "#ff9a9a")
  end
end)

-- Dock report: what the whole fleet is up to.
frontier.on("onPlayerDock", function()
  for _, s in ipairs(frontier.fleet()) do
    if not s.active then
      frontier.log(("%s @ %s — %s, %dcr/min net, %dcr banked%s")
        :format(s.name, s.station, s.duty, s.netPerPeriod or 0, s.earned or 0,
                (s.note ~= "" and (" (" .. s.note .. ")") or "")))
    end
  end
end)
```

### 0.9.8 — berth rent and seconded officers

```lua
-- Warn before arrears build up, and celebrate a good officer.
frontier.on("onFleetRent", function(r)
  if (r.arrears or 0) > 0 then
    frontier.chat("Purser",
      ("%s is %dcr behind on berth fees at %s."):format(r.name, r.arrears, r.station or "dock"),
      "#ff9a9a")
  else
    frontier.log(("[rent] %s paid %dcr from %s"):format(r.name, r.paid or 0, r.source or "account"))
  end
end)

frontier.on("onFleetOfficer", function(o)
  frontier.chat("Purser",
    ("%s %s the %s (L%d %s)"):format(o.officer, o.action, o.name, o.level or 0, o.role or "hand"),
    "#8cf")
end)

frontier.on("onFleetPresence", function(e)
  if e.phase == "arrived" then
    frontier.log(("[fleet] %s is working nearby out of %s"):format(e.name, e.station or "dock"))
  end
end)

-- Rent watchdog: stand a frame down if it is bleeding money.
frontier.on("onPlayerDock", function()
  for _, s in ipairs(frontier.fleet()) do
    if not s.active and (s.netPerPeriod or 0) < (s.rentPerPeriod or 0) then
      frontier.log(("%s nets %dcr/min but costs %dcr/min in rent — reconsider."):
        format(s.name, s.netPerPeriod or 0, s.rentPerPeriod or 0))
    end
  end
end)
```

## Turret mounts and duty rotation (1.0.2)

`onTurretFired` fires once per shot per mount, so keep the handler cheap — log a
running tally rather than a chat line per shot. `onFleetRotate` covers both the
roster toggle (`rotating` present) and an automatic change-over (`from` / `to`).

```lua
-- Turret tally: report how much chip damage the mounts contributed, on docking.
local pdShots, pdDamage = 0, 0
frontier.on("onTurretFired", function(t)
  pdShots = pdShots + 1
  pdDamage = pdDamage + (t.damage or 0)
end)

frontier.on("onPlayerDock", function()
  if pdShots > 0 then
    frontier.chat("Gunnery", ("Mounts fired %d times for about %d damage this run.")
      :format(pdShots, pdDamage), "#ffcc55")
    pdShots, pdDamage = 0, 0
  end
end)

-- Rotation log: note every automatic change-over and what it cost.
frontier.on("onFleetRotate", function(r)
  if r.rotating ~= nil then
    frontier.log(("[fleet] %s rotation %s"):format(r.name, r.rotating and "ON" or "OFF"))
  else
    frontier.chat("Purser",
      ("%s rotated %s → %s for %dcr (%dcr from its account)."):
        format(r.name, r.from, r.to, r.fee or 0, r.fromAccount or 0), "#8cf")
  end
end)

-- Nudge frames onto the roster once they are earning well.
frontier.on("onPlayerDock", function()
  for _, s in ipairs(frontier.fleet()) do
    if not s.active and s.duty ~= "idle" and not s.rotating
       and (s.periodsOnDuty or 0) >= (s.rotatePeriods or 5) then
      frontier.log(("%s has worked %d periods of %s — consider rotating it.")
        :format(s.name, s.periodsOnDuty, s.duty))
    end
  end
end)
```


## Point-defence status (1.0.2.1)

`frontier.turrets()` reports the mounts on the frame you are flying and the
`Options ▸ Gameplay ▸ Point Defence` mode, so a script can nag you when you
left the mounts switched off.

```lua
frontier.on("onPlayerDamaged", function()
  local t = frontier.turrets and frontier.turrets()
  if t and (t.mounts or 0) > 0 and t.mode == "off" then
    frontier.chat("Gunnery",
      ("%d mounts idle, Captain — point defence is switched off."):format(t.mounts),
      "#ffcc55")
  end
end)
```


## Stereo output switcher (1.0.4)

Cycles the 3D output format from a script, eases depth off while docked (menus
sit on the screen plane anyway) and logs whatever changed it.

```lua
frontier.on("onRender3DChanged", function(v)
  frontier.log(("[3d] %s (%s) depth %d, convergence %du")
    :format(v.label, v.kind, v.strength or 0, v.convergence or 0))
end)

-- Walk to the next format in the registry — no hard-coded id list.
local function next3d()
  local v = frontier.render3d()
  local ids = {}
  for _, m in ipairs(v.modes or {}) do ids[#ids + 1] = m.id end
  for i, id in ipairs(ids) do
    if id == v.mode then
      frontier.setRender3d{ mode = ids[(i % #ids) + 1] }
      return
    end
  end
end

-- Comfort pass: shallower depth in a fight, deeper while cruising.
frontier.on("onPlayerDamaged", function()
  local v = frontier.render3d()
  if v.enabled and (v.strength or 0) > 2 then frontier.setRender3d{ strength = 2 } end
end)

frontier.on("onPlayerDock", function(evt)
  if evt.kind == "station" then next3d() end
end)
```
