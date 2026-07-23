# 0.7.2 — Trade UX + Modding Completeness

Ships as **0.7.2**. Focus: compact commodities UI, faction-relevant filtering, and finishing the modding/scripting surface for the 0.7.x economy.

## 1. Compact Commodities menu

- One row per commodity instead of two (was: `Buy 10 …` + `Sell 10 …`).
- Page header row + a **Mode toggle row** (`◀ BUY ▶` / `SELL`). LEFT/RIGHT keys or ENTER on the toggle row flip the mode.
- Row action tag mirrors the current mode: `[BUY 10]` or `[SELL10]`.
- Faction filter (`stationCommodityFilter`) trims the 18-commodity table to what makes sense at each station:
  - Federation Gate → relics + tech
  - Miner / Industrial → elements + tech
  - Nature colony → food + elements
  - Pirate → relics + tech (fenced)
  - Trade Hub → all four classes
- Result: typical station shows 4–8 rows and everything fits without scrolling off the bottom.

## 2. Scripting / Modding surface

New Lua hooks dispatched from the engine:

- `onCommodityTrade { action, id, name, qty, price, [total], stationId }`
- `onPassengerBoard { name, vip, destStationId, fare }`
- `onPassengerDeliver { name, vip, stationId, station }`
- `onPlayerStationTierUp { stationId, name, tier, unlocks }`

New reader table:

- `frontier.economy.price(id, stationId?) → { buy, sell, stock } | nil`

New content-pack chatter kinds mods can extend via `frontier.chatter.add`:

- `passenger_smalltalk` — ambient VIP/guest lines while ferrying.
- `player_station_report` — status pings from player-owned stations.

## 3. Docs / bundle

- Bump `VERSION` to `0.7.2`.
- Rebuild the offline bundle after all edits land.

## Deferred (stays on the backlog)

- Player-station cosmetic customization.
- NPC trade AI actually moving cargo between stations.
- Faction-specific commodity bans beyond the relic rep hint.
- Route-hint HUD ("Buy X here, sell at Industrial +42%").
