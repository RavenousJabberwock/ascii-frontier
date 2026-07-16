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
- The mutation API is intentionally narrow in 0.5.7+: `addCredits`,
  `addFuel`, and a read-only `player()` snapshot. Entity spawn/despawn
  and mission mutation ship with M3.
