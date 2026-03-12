# Software City

## Overview

**Software City** — A living, breathing visualization of any code repository as an explorable pixel-art city. AI NPC agents patrol the codebase, find bugs (shown as fires/alarms on buildings), and escalate hard problems to external AI when needed. Everything they learn is saved to a persistent knowledge base so the city gets smarter over time.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + Tailwind CSS
- **UI Libraries**: framer-motion, recharts, date-fns, lucide-react
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (all backend routes)
│   └── software-city/      # React + Vite frontend (city visualization)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Core Concepts

### City Mapping

| Code Concept | City Element |
|---|---|
| Root project | Capital city |
| Folders | Named districts |
| Files | Buildings |
| Functions/Classes | Building floors |
| Imports | Roads between buildings |
| API endpoints | Orange buildings |
| Databases | Purple buildings (vault style) |
| Config files | Yellow buildings |
| Test files | Mint-green buildings |

### Building Properties

- **Lines of code** → Building height (floors)
- **Cyclomatic complexity** → Complexity score shown in inspector
- **Commit count** → Visual age (New/Modern/Aged/Ancient)
- **Test coverage** → Status (healthy/warning/dark/glowing)

### Season System (Health Score → Season)

- 80–100% → **Summer** (bright, busy)
- 60–79% → **Spring** (fresh, hopeful)
- 40–59% → **Autumn** (muted, quieter)
- 0–39% → **Winter** (dark, dim)

### Health Score Formula

- Test coverage across all files (40%)
- Ratio of clean to bugged buildings (30%)
- Average cyclomatic complexity (20%)
- Recent commit frequency (10%)

### Building Event Overlays

| Event | Trigger |
|---|---|
| 🔥 fire | High CPU / failed tests |
| 💧 flood | Memory leak |
| 💨 smoke | High latency |
| 🚨 alarm | Unhandled exceptions |
| ✨ sparkle | High coverage + clean |
| 🌑 dark | Zero test coverage |

### NPC Agent Roles

| Role | Color | Specialization |
|---|---|---|
| qa_inspector | Blue | Test generation |
| api_fuzzer | Orange | API endpoint abuse |
| load_tester | Yellow | Traffic simulation |
| edge_explorer | Green | Property-based testing |
| ui_navigator | Purple | Browser automation |

### Escalation System

1. Agent tries task locally (simulated AI) 
2. If fails 3x or too complex → escalates to external AI (Claude/Groq)
3. Answer saved permanently to knowledge base SQLite
4. Next time same pattern appears → knowledge base hit (no API call needed)
5. Escalation rate drops over time as knowledge base fills up

## Database Schema

### `knowledge` table
Persistent AI knowledge base — every escalation answer is stored and reused.

### `agents` table
NPC agent state — roles, stats, accuracy, level, current task.

### `city_events` table
Real-time city event stream — fires, bug finds, escalations, season changes.

### `repos` table
Analyzed repository cache — stores the generated city layout JSON.

## API Routes

| Method | Path | Description |
|---|---|---|
| POST | `/api/repo/load` | Load and analyze a GitHub repository |
| POST | `/api/repo/demo` | Load the demo repository |
| POST | `/api/repo/watch` | Start watching a local folder with chokidar |
| GET | `/api/repo/watch/status` | File watcher status |
| DELETE | `/api/repo/watch` | Stop file watcher |
| GET | `/api/city/layout` | Get city layout (districts + buildings + roads) |
| GET | `/api/city/health` | Get health score + season |
| GET | `/api/city/metrics` | Get live CPU/memory/agent metrics |
| GET | `/api/city/snapshot` | Export full city state as JSON file |
| GET | `/api/agents/list` | List all NPC agents |
| POST | `/api/agents/spawn` | Spawn a new NPC agent |
| POST | `/api/agents/:id/task` | Assign a task to an agent |
| POST | `/api/agents/:id/chat` | Chat with an NPC agent (escalation chain) |
| GET | `/api/knowledge/stats` | Knowledge base statistics |
| GET | `/api/knowledge/entries` | Recent knowledge base entries |
| GET | `/api/events/stream` | Recent city events (polled every 5s) |
| GET | `/api/assets/hero` | SVG hero city skyline image |
| GET | `/api/assets/logo` | SVG logo image |
| GET | `/api/ollama/status` | Ollama availability + model list |

## Frontend Pages

1. **Landing** (`/`) — Hero with GitHub URL input and demo button
2. **City View** (`/city`) — Interactive 2D city map with canvas rendering, HUD, agent dots, building inspector
3. **Agents Dashboard** (`/agents`) — NPC agent cards with status, dialogue, stats
4. **Knowledge Base** (`/knowledge`) — Learned AI patterns table + stats

## Key Files

- `artifacts/api-server/src/lib/cityAnalyzer.ts` — Real regex AST → city layout
- `artifacts/api-server/src/lib/codeAnalyzer.ts` — LOC, cyclomatic complexity, imports, exports analysis
- `artifacts/api-server/src/lib/healthScorer.ts` — Multi-factor health score → season mapping
- `artifacts/api-server/src/lib/agentEngine.ts` — Real async NPC agent loop with Ollama 3-attempt fallback
- `artifacts/api-server/src/lib/escalationEngine.ts` — KB→Groq→Anthropic→Ollama→fallback chain
- `artifacts/api-server/src/lib/ollamaClient.ts` — Ollama HTTP client with concurrency semaphore
- `artifacts/api-server/src/lib/ollamaPrompts.ts` — Test generation + dialogue prompt templates
- `artifacts/api-server/src/lib/wsServer.ts` — WebSocket server with typed broadcast methods
- `artifacts/api-server/src/lib/fileWatcher.ts` — Chokidar local file watcher → city re-analysis
- `artifacts/api-server/src/lib/gitHistory.ts` — simple-git commit age + frequency reader
- `artifacts/api-server/src/lib/assetGenerator.ts` — SVG hero background + logo generation
- `artifacts/api-server/src/lib/githubFetcher.ts` — GitHub API integration + demo data
- `artifacts/software-city/src/components/city/CityMap.tsx` — SVG city renderer: flash animations, coverage bars, NPC thought bubbles
- `artifacts/software-city/src/components/city/BuildingInspector.tsx` — Real agent chat + source badges
- `artifacts/software-city/src/components/city/HUD.tsx` — Health/metrics/WS/Ollama status bar
- `artifacts/software-city/src/components/layout/AppLayout.tsx` — WS-powered color-coded event stream + Leaderboard nav
- `artifacts/software-city/src/hooks/useWebSocket.ts` — WebSocket hook with auto-reconnect
- `artifacts/software-city/src/pages/CityView.tsx` — City page with error boundary, WS NPC moves, thought bubbles, Share button
- `artifacts/software-city/src/pages/Landing.tsx` — Hero with GitHub input + local folder watcher
- `artifacts/software-city/src/pages/Leaderboard.tsx` — Agent leaderboard with rank badges and stat pills
- `artifacts/software-city/src/pages/SharedCity.tsx` — Read-only shared city snapshot viewer (token-based)
- `artifacts/software-city/src/pages/KnowledgeBase.tsx` — Sortable, paginated knowledge table with quality stars, delete, export
- `lib/api-client-react/src/generated/api.schemas.ts` — Handwritten TypeScript types (update manually)
- `lib/api-spec/openapi.yaml` — Full API contract

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. Run `pnpm run typecheck` from root to typecheck everything.

## Development

- `pnpm --filter @workspace/api-server run dev` — Start API server
- `pnpm --filter @workspace/software-city run dev` — Start frontend  
- `pnpm --filter @workspace/db run push` — Push DB schema changes
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API client
