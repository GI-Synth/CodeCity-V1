# VS Code + GitHub Copilot Handoff Prompt

## Project: Software City

You are taking over development of **Software City** — a full-stack web application that visualizes GitHub repositories as interactive pixel-art cities. This document will orient you to the codebase and guide your next development phase.

---

## What This Project Does

Software City converts any GitHub repository into a **living city**:

- **Files** become **buildings** (colored by file type)
- **Folders** become **districts** (neighborhoods on the city map)
- **Import statements** become **roads** connecting buildings
- **AI NPC agents** patrol the city, simulate finding bugs, and save learnings to a knowledge base
- **City season** reflects overall code health: Spring/Summer = healthy, Autumn/Winter = degraded

---

## Current Capabilities

| Feature | Status |
|---------|--------|
| GitHub repo loading (public) | Working |
| Demo city with seeded data | Working |
| SVG city map with districts/buildings | Working |
| NPC agents with animated movement | Working |
| Color-coded dependency roads | Working |
| Building inspector panel | Working |
| Test coverage display (0–100%) | Working |
| Agent task icons (🔥🔬🧪🌐📊) | Working |
| District minimap | Working |
| F3 Performance Debug HUD | Working |
| Live event stream (sidebar) | Working (polling 2s) |
| Knowledge base library with search | Working |
| Agents dashboard with spawn dialog | Working |
| Season-based city background | Working |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TailwindCSS, Framer Motion |
| Routing | wouter |
| Data fetching | TanStack Query (React Query) |
| API contract | OpenAPI 3.0 → generated TypeScript client |
| Backend | Express.js + TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| Monorepo | pnpm workspaces |
| UI components | shadcn/ui |
| Icons | lucide-react |

---

## Repository Structure

```
/
├── artifacts/
│   ├── software-city/          — React + Vite frontend
│   │   └── src/
│   │       ├── pages/          — Landing, CityView, Agents, KnowledgeBase
│   │       └── components/     — CityMap, BuildingInspector, HUD, AppLayout
│   └── api-server/             — Express backend
│       └── src/
│           ├── routes/         — /repo, /city, /agents, /knowledge, /events
│           └── lib/            — cityAnalyzer, agentEngine, githubFetcher
├── lib/
│   ├── db/                     — Drizzle schema + migrations
│   └── api-spec/               — openapi.yaml (source of truth for API)
├── MIGRATION_REPORT.md         — Full architecture documentation
└── VSCODE_COPILOT_HANDOFF_PROMPT.md
```

---

## Development Setup

```bash
# Install dependencies
pnpm install

# Start the API server (port set via PORT env var)
pnpm --filter @workspace/api-server run dev

# Start the frontend dev server
pnpm --filter @workspace/software-city run dev

# Push DB schema changes
pnpm --filter @workspace/db run db:push

# Regenerate API client after editing openapi.yaml
pnpm --filter @workspace/api-client run generate
```

Set environment variable `DATABASE_URL` to your PostgreSQL connection string.

---

## Priorities for Next Development Phase

### Priority 1 — Real Code Analysis (High Impact)
Replace simulated metrics with real analysis:
- Use `ts-morph` or `@typescript-eslint/parser` to parse actual TypeScript AST
- Compute real import graphs for dependency roads
- Detect real circular dependencies with Tarjan's algorithm
- Report real line counts, complexity (cyclomatic), and function counts
- Integrate with Jest/Vitest coverage reports (LCOV format)

### Priority 2 — GitHub OAuth for Private Repos
- Add GitHub OAuth App or GitHub App authentication
- Store tokens in session/DB
- Allow loading private repositories
- Rate limit handling (authenticated = 5000 req/hr)

### Priority 3 — WebSocket Real-Time Updates
- Replace polling with a WebSocket server (ws or socket.io)
- Push city patches when files change
- Stream agent movements in real time
- Eliminate 2–10s latency from polling intervals

### Priority 4 — Local File Watcher Mode
- Add `chokidar` to watch a local directory
- Emit `city_patch` events on file save
- Only re-render affected buildings (not full reload)
- Enable live coding visualization

### Priority 5 — Real AI Agent Analysis
- Connect agents to an LLM (GPT-4, Claude, or local model via Ollama)
- Agents actually read file contents and find real issues
- Store findings in knowledge base with code snippets
- Let agents communicate with each other (multi-agent coordination)

### Priority 6 — 3D City Upgrade
- Replace SVG renderer with Three.js / React Three Fiber
- Buildings become 3D skyscrapers (height = LOC, glow = health)
- Camera flies between districts
- Particle effects for bugs (fire, smoke, rain)

---

## Known Issues to Fix

1. `agent.currentTask` is not consistently populated — task icons above NPCs may not always show
2. Agent `x,y` positions are random on spawn — need path-finding between buildings
3. `testCoverage` from API is 0–1 fraction — ensure all display code uses `* 100`
4. Chat in BuildingInspector uses hardcoded `"agent-1"` agent ID — should use real agent ID from list
5. No error boundary — a crash in CityMap will blank the whole page

---

## Design Language

Keep these conventions when adding UI:
- **Background:** `#0a0e1a` (deep navy)
- **Primary:** `#00fff7` (neon cyan), with `text-glow` class for emphasis
- **Accent:** `#b026ff` (neon purple)
- **Font:** JetBrains Mono (monospace throughout)
- **Panels:** `glass-panel` utility class (backdrop-blur + semi-transparent dark bg)
- **Status colors:** `text-success` (green) / `text-warning` (amber) / `text-destructive` (red)
- All new UI must feel like a terminal / command center — no rounded pastel cards

---

Good luck! The codebase is clean, modular, and ready for the next phase.
