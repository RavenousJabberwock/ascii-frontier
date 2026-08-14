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
