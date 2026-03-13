# Contributing to Software City

Welcome! This project is open to improvements. Before you start, read the architecture overview in [README.md](./README.md).

## Development Setup

```bash
git clone <repo>
cd software-city
pnpm install
pnpm dev
```

Both services start: API on `:8080`, frontend on `:5173`.

## Code Quality

Before submitting a PR:

```bash
pnpm run typecheck   # Must be zero errors
pnpm run build       # Must succeed
```

TypeScript errors block merging. There are no exceptions.

## Project Layout

```
libs/
  db/                     Drizzle schema, migrations, client
  api-client-react/       Generated React hooks (do not edit by hand)
artifacts/
  api-server/src/
    lib/agentEngine.ts    NPC agent loop — core game logic
    lib/wsServer.ts       WebSocket broadcast with 50ms batching
    lib/cityAnalyzer.ts   Repo → city layout conversion
    lib/codeAnalyzer.ts   File metrics with LRU cache
    routes/               One file per API resource
  software-city/src/
    components/city/      CityMap, HUD, BuildingInspector
    pages/                CityView, Agents, Knowledge, Metrics, Settings
    hooks/                useWebSocket (batch-aware)
```

## Adding a New Building Type

1. Add `FileType` in `libs/db/src/schema/types.ts`
2. Add detection rule in `artifacts/api-server/src/lib/codeAnalyzer.ts` → `detectFileType()`
3. Add color mapping in `artifacts/api-server/src/lib/cityAnalyzer.ts` (building.color)
4. Add visual in `artifacts/software-city/src/components/city/CityMap.tsx` building renderer

## Adding a New Agent Role

1. Add the role to `AGENT_NAMES`, `AGENT_COLORS`, `IDLE_DIALOGUES` in `agentEngine.ts`
2. Add role bonus score in `roleBonusScore()`
3. Add role to the DB schema enum in `libs/db/src/schema/agents.ts`

## WebSocket Events

The server sends batched messages every 50ms. All `npc_move` events for the same NPC are deduped to the latest. Client-side batch handling is in `useWebSocket.ts`.

Event types: `npc_move`, `npc_thought`, `bug_found`, `escalation`, `season_change`, `event_log`, `city_patch`, `test_result`

## PR Guidelines

- `pnpm run typecheck` must pass before submitting
- Describe what your change adds to the city metaphor
- Prefer extending existing systems over adding new ones
- Keep PRs focused — one feature or fix per PR
