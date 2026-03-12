# Software City — Migration Report

## 1. Project Architecture Overview

Software City is a full-stack web application that visualizes a GitHub repository as a living pixel-art city. Files become buildings, folders become districts, imports become dependency roads, and AI NPC agents patrol the city finding bugs.

**Stack:** React 18 + Vite + TailwindCSS (frontend) / Express.js + Drizzle ORM + PostgreSQL (backend)  
**Monorepo:** pnpm workspaces  
**Key libraries:** framer-motion, lucide-react, react-query (TanStack Query), wouter, date-fns

---

## 2. Backend Module Structure

```
artifacts/api-server/src/
├── index.ts               — Express server entry point (port from env)
├── db.ts                  — Drizzle + PostgreSQL connection
├── routes/
│   ├── repo.ts            — POST /api/repo, POST /api/repo/demo
│   ├── city.ts            — GET /api/city/layout, /health, /metrics
│   ├── agents.ts          — CRUD + task assignment + agent chat
│   ├── knowledge.ts       — GET /api/knowledge/stats + entries
│   └── events.ts          — GET /api/events (live event stream)
└── lib/
    ├── cityAnalyzer.ts    — GitHub repo → city layout JSON
    ├── agentEngine.ts     — NPC creation, dialogue, simulation
    └── githubFetcher.ts   — GitHub API integration (public repos)
```

---

## 3. Frontend Structure

```
artifacts/software-city/src/
├── App.tsx                — Router (wouter), QueryClient provider
├── pages/
│   ├── Landing.tsx        — Hero + repo URL input + demo button
│   ├── CityView.tsx       — Main city canvas + HUD + inspector
│   ├── Agents.tsx         — Agent roster + spawn dialog
│   └── KnowledgeBase.tsx  — Knowledge library with search/filter
├── components/
│   ├── city/
│   │   ├── CityMap.tsx        — SVG city renderer (districts, buildings, roads, agents)
│   │   ├── BuildingInspector.tsx — Right-panel inspector for selected building
│   │   └── HUD.tsx            — Top bar health/season/metrics overlay
│   ├── layout/
│   │   └── AppLayout.tsx      — Sidebar nav + live event stream
│   └── ui/                    — shadcn/ui components
└── lib/
    └── api-spec → generated OpenAPI client
```

---

## 4. Communication Design

No WebSockets — uses HTTP polling:

| Endpoint | Interval | Purpose |
|----------|----------|---------|
| `/api/city/layout` | 5s | Districts, buildings, roads |
| `/api/city/health` | 5s | Season, health score |
| `/api/city/metrics` | 2s | CPU, RAM, bug counts |
| `/api/agents` | 2–3s | Agent positions, status, dialogue |
| `/api/events` | 2s | Live event stream for sidebar |
| `/api/knowledge/*` | 10s | Knowledge base stats and entries |

---

## 5. NPC Agent System

Five agent roles, each with distinct behaviors:

| Role | Icon | Behavior |
|------|------|---------|
| `qa_inspector` | Shield | Reviews test coverage, flags low coverage files |
| `api_fuzzer` | Flame | Sends malformed requests, finds edge cases |
| `load_tester` | Zap | Simulates high load, reports CPU spikes |
| `edge_explorer` | Compass | Explores unusual code paths |
| `ui_navigator` | MousePointer | Navigates UI flows, finds broken interactions |

Agents:
- Spawn at a random building position on the city map
- Move between buildings every few seconds (simulated)
- Generate contextual dialogue based on current task
- Escalate findings to the knowledge base
- Display task icons above their avatar in the city (🔥🔬🧪🌐📊)

---

## 6. Knowledge Base Architecture

**Table:** `knowledge_entries`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| problemType | text | Category (sql_injection, memory_leak, etc.) |
| question | text | The question the agent was solving |
| answer | text | The solution found |
| language | text | Programming language context |
| confidence | enum(high/medium/low) | Agent confidence level |
| useCount | int | How many times this solution was reused |
| bugsFound | int | Bugs resolved via this entry |
| createdAt | timestamp | When stored |

**Cache hit:** Agents check knowledge base before running full analysis. A hit increments `useCount`.

---

## 7. Dependency Graph System

Roads are generated in `cityAnalyzer.ts` by analyzing import statements in files:

- Each `import` statement → a road between two buildings
- Road types: `import`, `circular`, `dependency`
- Roads with many connections → flagged as `high` coupling
- Circular imports → detected and colored red in UI

In the SVG, roads are rendered as `<line>` elements with color coding:
- Green = normal import
- Yellow = high coupling
- Red = circular dependency

---

## 8. Development Workflow

```bash
# Install
pnpm install

# Start all services
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/software-city run dev

# Database (Drizzle)
pnpm --filter @workspace/db run db:push    # Apply schema
pnpm --filter @workspace/db run db:studio  # Drizzle Studio UI

# Code generation (after editing openapi.yaml)
pnpm --filter @workspace/api-client run generate
```

Environment variables needed:
```
DATABASE_URL=postgresql://...
PORT=<assigned per service>
```

---

## 9. Known Limitations

1. **No real GitHub API auth** — only works with public repos; rate-limited to 60 req/hr unauthenticated
2. **No WebSocket** — polling-based; not suitable for very fast event rates
3. **Agent simulation is random** — agents don't actually analyze code; dialogue and positions are simulated
4. **City layout is static per load** — no incremental update on file changes
5. **No authentication** — anyone with the URL can access the dashboard
6. **No real code analysis** — complexity/coverage metrics are estimated, not from actual tools like Jest/ESLint

---

## 10. Recommended Future Improvements

1. **Real code analysis** — Integrate `ts-morph`, `ast-grep`, or `semgrep` for actual import parsing, complexity, and coverage
2. **WebSocket streaming** — Replace polling with WebSocket for real-time agent movement
3. **GitHub OAuth** — Allow private repo access via GitHub App
4. **File watcher** — Watch local repo via chokidar for live city patching without full reload
5. **Agent persistence** — Save agent memory across sessions in PostgreSQL
6. **3D city view** — Upgrade SVG renderer to Three.js/WebGL for depth and animations
7. **Dependency cycle detection** — Use Tarjan's algorithm for real circular dependency detection
8. **Export city snapshot** — Allow saving city state as PNG or JSON
