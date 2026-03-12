# VS Code + GitHub Copilot Handoff Prompt

## Project: Software City

You are taking over development of **Software City** — a full-stack web application that visualizes GitHub repositories as interactive pixel-art cities. This document is the complete, up-to-date reference for the project as of the final Replit session.

---

## What This Project Does

Software City converts any GitHub repository into a **living city**:

- **Files** become **buildings** (height and color by file type and size)
- **Folders** become **districts** (neighborhoods on the city map)
- **Import statements** become **roads** connecting buildings
- **AI NPC agents** patrol the city, simulate finding bugs, and save learnings to a knowledge base
- **City season** reflects overall code health: Spring/Summer = healthy, Autumn/Winter = critical

---

## Current Capabilities (Complete Feature List)

### Repository Loading
| Feature | Status | Notes |
|---------|--------|-------|
| Load public GitHub repos by URL | Working | No auth needed |
| Load **private** GitHub repos | Working | Requires Personal Access Token (PAT) |
| GitHub PAT input on landing page | Working | Collapsible "Private repo?" section |
| Token passed as `Authorization: Bearer` header | Working | Never stored in DB |
| Demo city with seeded data (37 files, 11 districts) | Working | POST /api/repo/demo |
| Branch selection | Working | Defaults to `main` |
| Auto-redirect to city after load | Working | |

### City Map (SVG Renderer)
| Feature | Status | Notes |
|---------|--------|-------|
| Districts rendered as labeled zones | Working | Color-coded by type |
| Buildings as colored blocks (by file type) | Working | Opacity reflects file age |
| Season-aware background color | Working | 4 seasons |
| Dependency roads between buildings | Working | Lines between import relationships |
| **Color-coded roads on selection** | Working | Green=import, Yellow=high coupling, Red=circular |
| Non-connected buildings dim on selection | Working | Opacity drops to 0.3 |
| Connected buildings get green outline | Working | |
| Dependency legend (bottom-left) | Working | Visible only when a building is selected |
| Hover tooltip with quick stats | Working | Coverage shown as % |
| Click building → opens inspector | Working | |
| **Collapsible district minimap** | Working | Bottom-right, shows all districts + building counts |
| NPC agent dots with animated movement | Working | Framer Motion spring physics |
| **NPC activity icons above agents** | Working | 🔥🔬🧪🌐📊⚠️ based on task/status |
| Agent ping ring animation when working | Working | |

### HUD & Overlays
| Feature | Status | Notes |
|---------|--------|-------|
| Health score + season badge | Working | Top-center |
| Live metrics bar (agents, bugs, CPU) | Working | Polls every 2s |
| **F3 Performance Debug HUD** | Working | Toggle with F3 key; shows FPS, CPU, RAM, agents |
| "Press F3" hint | Working | Bottom-center, hidden when HUD is open |
| City loading skeleton with progress bar | Working | Shown during initial layout fetch |

### Building Inspector (Right Panel)
| Feature | Status | Notes |
|---------|--------|-------|
| File name, path, language, age | Working | |
| Lines of code + complexity stats | Working | |
| Test coverage bar (0–100%) | Working | Fixed: API returns 0–1, displayed as % |
| Active event / health status badge | Working | HEALTHY or ACTIVE FIRE/ALARM etc. |
| Commit count | Working | |
| **Analyze** action button | Working | Dispatches `analyze_bug` task to agent |
| **Generate Tests** action button | Working | Dispatches `generate_tests` task |
| **Fuzz** action button | Working | Dispatches `fuzz_test` task |
| Dispatch status indicator | Working | "Agent dispatched..." pulse while pending |
| Agent chat panel | Working | Send messages, get agent replies |

### Agents Dashboard
| Feature | Status | Notes |
|---------|--------|-------|
| Agent roster with role, level, status | Working | 5 roles |
| Current agent thought / dialogue | Working | Updates on poll |
| Bugs found + accuracy stats | Working | |
| Spawn agent dialog (5 roles) | Working | |
| Agent status color coding | Working | idle/working/escalating |
| Auto-refresh every 3s | Working | |

### Knowledge Base
| Feature | Status | Notes |
|---------|--------|-------|
| Stats dashboard (entries, hits, rate, avg bugs) | Working | |
| Searchable entry table | Working | Search by pattern, question, or language |
| **Confidence filter buttons** | Working | all / high / medium / low |
| Result count display when filtered | Working | |
| Entry detail on hover | Working | Full question visible |
| Auto-refresh every 10s | Working | |

### Live Event Stream (Sidebar)
| Feature | Status | Notes |
|---------|--------|-------|
| Real-time event feed | Working | Polls every 2s |
| Color-coded event types | Working | FIRE=red, KNOWLEDGE_HIT=green, etc. |
| Timestamp + location per event | Working | |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TailwindCSS, Framer Motion |
| Routing | wouter |
| Data fetching | TanStack Query v5 (React Query) |
| API contract | OpenAPI 3.0 (handwritten TypeScript client in `lib/api-client-react`) |
| Backend | Express.js + TypeScript (tsx dev server) |
| Database | PostgreSQL + Drizzle ORM |
| Monorepo | pnpm workspaces |
| UI components | shadcn/ui |
| Icons | lucide-react |

---

## Repository Structure

```
/
├── artifacts/
│   ├── software-city/                  — React + Vite frontend
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Landing.tsx         — Hero page with repo URL + PAT input
│   │       │   ├── CityView.tsx        — Main city canvas + HUD + F3 debug HUD
│   │       │   ├── Agents.tsx          — Agent roster + spawn dialog
│   │       │   └── KnowledgeBase.tsx   — Knowledge library with search/filter
│   │       └── components/
│   │           ├── city/
│   │           │   ├── CityMap.tsx         — SVG renderer (districts, buildings, roads, agents, minimap)
│   │           │   ├── BuildingInspector.tsx — Right-panel inspector for selected building
│   │           │   └── HUD.tsx             — Top bar health/season/metrics overlay
│   │           ├── layout/
│   │           │   └── AppLayout.tsx       — Sidebar nav + live event stream
│   │           └── ui/                     — shadcn/ui components
│   └── api-server/                     — Express.js backend
│       └── src/
│           ├── index.ts                — Server entry (reads PORT from env)
│           ├── db.ts                   — Drizzle + PostgreSQL connection
│           ├── routes/
│           │   ├── repo.ts             — POST /api/repo/load, POST /api/repo/demo
│           │   ├── city.ts             — GET /api/city/layout, /health, /metrics
│           │   ├── agents.ts           — CRUD + task assignment + agent chat
│           │   ├── knowledge.ts        — GET /api/knowledge/stats + entries
│           │   └── events.ts           — GET /api/events (live event stream)
│           └── lib/
│               ├── cityAnalyzer.ts     — GitHub repo → city layout JSON
│               ├── agentEngine.ts      — NPC creation, dialogue, simulation
│               └── githubFetcher.ts    — GitHub API (supports PAT auth for private repos)
├── lib/
│   ├── db/                             — Drizzle schema + migrations (4 tables)
│   ├── api-spec/                       — openapi.yaml (source of truth for API)
│   └── api-client-react/               — Handwritten TypeScript API client + React Query hooks
│       └── src/generated/
│           ├── api.schemas.ts          — All request/response TypeScript types
│           └── api.ts                  — fetch wrappers + useQuery/useMutation hooks
├── MIGRATION_REPORT.md                 — Full architecture documentation
└── VSCODE_COPILOT_HANDOFF_PROMPT.md    — This file
```

---

## Database Schema

Four tables managed by Drizzle ORM:

| Table | Purpose |
|-------|---------|
| `repos` | Loaded repo metadata + full city layout JSON |
| `agents` | NPC agent state (role, position, level, status, dialogue) |
| `knowledge_entries` | Saved bug patterns + solutions with confidence + use counts |
| `events` | Live event log (fire, alarm, flood, smoke, sparkle, etc.) |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/repo/load` | Load a GitHub repo (accepts `repoUrl`, `branch`, `githubToken`) |
| POST | `/api/repo/demo` | Load demo city with seeded data |
| GET | `/api/city/layout` | Current city layout (districts, buildings, roads) |
| GET | `/api/city/health` | Health score + season |
| GET | `/api/city/metrics` | Live CPU, RAM, bug counts, agent counts |
| GET | `/api/agents` | List all agents with positions + dialogue |
| POST | `/api/agents/spawn` | Create a new agent by role |
| POST | `/api/agents/:id/task` | Assign a task to an agent |
| POST | `/api/agents/:id/chat` | Send a message to an agent |
| GET | `/api/knowledge/stats` | Knowledge base summary stats |
| GET | `/api/knowledge/entries` | All knowledge entries |
| GET | `/api/events` | Recent city events (last 20) |

---

## Private Repo Support

The GitHub PAT flow works as follows:

1. User enters a GitHub URL + their PAT in the Landing page (collapsible "Private repo?" section)
2. Frontend sends `{ repoUrl, githubToken }` to `POST /api/repo/load`
3. Backend passes token as `Authorization: Bearer <token>` on all GitHub API calls
4. Token is **never stored** — used only for the duration of the request
5. Requires PAT with `repo` scope (classic) or `Contents: Read` (fine-grained)
6. Authenticated requests get 5,000 GitHub API calls/hour vs. 60 unauthenticated

---

## Polling Intervals

| Data | Interval |
|------|----------|
| City layout | 5s |
| City health + season | 5s |
| Live metrics (CPU, RAM, bugs) | 2s |
| Agents (positions, dialogue, status) | 2–3s |
| Events (sidebar stream) | 2s |
| Knowledge base | 10s |

---

## Development Setup

```bash
# Install all workspace dependencies
pnpm install

# Start the API server
pnpm --filter @workspace/api-server run dev

# Start the frontend
pnpm --filter @workspace/software-city run dev

# Apply DB schema changes (Drizzle)
pnpm --filter @workspace/db run db:push

# Open Drizzle Studio (DB UI)
pnpm --filter @workspace/db run db:studio
```

**Required environment variable:**
```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

**Note on API client:** The TypeScript client in `lib/api-client-react/src/generated/` is handwritten (not auto-generated from the OpenAPI spec). When you add new API endpoints, update both `openapi.yaml` and the generated files manually, or set up `orval` / `openapi-typescript` to automate this.

---

## Known Issues (Carry Forward)

1. **Agent task icons may not show** — `agent.currentTask` is not always populated by the backend; the icon logic falls back to `agent.status` but may show nothing for idle agents
2. **Agent positions are random** — agents teleport to random buildings rather than pathfinding between them; implement proper A* or grid-based movement for realism
3. **Agent chat uses hardcoded ID** — `BuildingInspector.tsx` sends chat to `"agent-1"` hardcoded; should use a real agent ID from the agents list
4. **No React error boundary** — an unhandled render error in `CityMap.tsx` will blank the entire city view; add `<ErrorBoundary>` wrapping the main canvas
5. **City layout not incremental** — loading a new repo replaces the entire layout; there's no diffing or patching of existing buildings
6. **Simulated metrics** — CPU/RAM/bug counts in `GET /api/city/metrics` are randomly generated, not real system metrics

---

## Priorities for Next Development Phase

### Priority 1 — Real Code Analysis
Replace estimated metrics with actual AST-based analysis:
- Use `ts-morph` or `@typescript-eslint/parser` to parse TypeScript/JavaScript imports for real dependency graphs
- Detect circular dependencies with Tarjan's SCC algorithm
- Compute real cyclomatic complexity per function
- Ingest Jest/Vitest LCOV coverage reports for real `testCoverage` values
- Count actual LOC excluding comments and blank lines

### Priority 2 — WebSocket Real-Time Updates
Replace HTTP polling with WebSocket streaming:
- Use `ws` or `socket.io` for the backend
- Push agent movement updates at 10–30 FPS
- Stream city patch events on file change
- Eliminate the 2–10s polling lag for agent animations

### Priority 3 — Local File Watcher Mode
Watch a local directory and update the city live as you code:
- Add `chokidar` file watcher to the backend
- Emit `city_patch` WebSocket events on file save
- Only re-analyze and re-render affected buildings (not full reload)
- This turns Software City into a real-time coding companion

### Priority 4 — Real AI Agent Analysis
Connect NPC agents to an actual LLM:
- Use OpenAI, Anthropic, or a local Ollama model
- Agents read real file contents and produce real findings
- Store actual code snippets and fix suggestions in the knowledge base
- Enable agent-to-agent communication for multi-agent workflows

### Priority 5 — 3D City Renderer
Upgrade the SVG renderer to Three.js / React Three Fiber:
- Buildings become 3D skyscrapers (height = LOC, glow intensity = health)
- Camera flies smoothly between districts
- GPU particle effects for bugs (fire sparks, smoke plumes, rain on critical files)
- Ambient city sounds tied to health score

### Priority 6 — Persistent Sessions & Auth
- Add user accounts (GitHub OAuth) so cities persist across sessions
- Save multiple repos per user
- Share city links publicly
- Track city health history over time (charts)

---

## Design Language

All new UI must match the existing terminal/command-center aesthetic:

| Token | Value |
|-------|-------|
| Background | `#0a0e1a` (deep navy) |
| Primary / neon | `#00fff7` (cyan) — use `text-glow` CSS class for emphasis |
| Accent | `#b026ff` (neon purple) |
| Font | JetBrains Mono (monospace throughout — no sans-serif) |
| Panels | `glass-panel` utility (backdrop-blur + semi-transparent dark bg + border) |
| Cards | `glass-card` utility (same but slightly different border treatment) |
| Success | `text-success` / `bg-success` (green) |
| Warning | `text-warning` / `bg-warning` (amber) |
| Error | `text-destructive` / `bg-destructive` (red) |

No rounded pastel cards. No light mode. No system fonts. Everything should feel like a live ops dashboard running in a dark server room.

---

Good luck. The codebase is stable, well-structured, and ready for the next phase of development.
