-- ASCII Frontier 0.9.5 — sample user script: Faction Ledger
--
-- Demonstrates the 0.9.5 faction-contract surfaces:
--   * onHailWork      → offers now carry `faction` and `issuer`
--   * onMissionAccepted / onMissionCompleted → same two fields
--   * frontier.contracts()  → per-contract `faction` / `issuer`
--   * frontier.reputation() → standing per faction, to show the payoff
--
-- Paste into Options ▸ Scripting ▸ Edit Script…, then Reload Script.

local ISSUER_COLOR = {
  federation = "#7fd0ff",
  spd        = "#9fd8ff",
  guild      = "#ffd28a",
  aquila     = "#b9ffb0",
  pirate     = "#ff8a8a",
}

local function tag(m)
  return (m.issuer or "Unaffiliated") .. (m.faction and (" [" .. m.faction .. "]") or "")
end

-- 1. Work handed out over comms: name the house and the fattest offer.
frontier.on("onHailWork", function(w)
  local best
  for _, m in ipairs(w.offers or {}) do
    if not best or (m.reward or 0) > (best.reward or 0) then best = m end
  end
  if not best then return end
  frontier.chat(best.issuer or "Broker",
    ("%s%s — best on the board: %s (%dcr)"):format(
      w.priority and "PRIORITY " or "", tag(best), best.description, best.reward or 0),
    ISSUER_COLOR[best.faction or ""] or "#9fe")
end)

-- 2. Ledger: which house each signed job belongs to.
frontier.on("onMissionAccepted", function(m)
  frontier.log(("signed for %s: %s (%dcr)"):format(tag(m), m.description, m.reward or 0))
end)

-- 3. Payout: report the standing the writ just bought.
frontier.on("onMissionCompleted", function(m)
  if not m.faction then
    frontier.log(("paid %dcr — no issuing house, no standing gained"):format(m.reward or 0))
    return
  end
  local rep = frontier.reputation() or {}
  frontier.chat("Purser",
    ("%s settled. Standing with %s now %d."):format(tag(m), m.faction, rep[m.faction] or 0),
    ISSUER_COLOR[m.faction] or "#9fe")
end)

-- 4. On dock, summarise the log by house so mixed allegiances are obvious.
frontier.on("onPlayerDock", function(evt)
  if evt.kind ~= "station" then return end
  local byHouse, any = {}, false
  for _, c in ipairs(frontier.contracts()) do
    local key = c.faction or "freelance"
    byHouse[key] = (byHouse[key] or 0) + 1
    any = true
  end
  if not any then frontier.log("contract log empty — ask around over comms (H)."); return end
  local parts = {}
  for house, n in pairs(byHouse) do parts[#parts + 1] = house .. "x" .. n end
  frontier.log("log by house: " .. table.concat(parts, ", "))
end)
