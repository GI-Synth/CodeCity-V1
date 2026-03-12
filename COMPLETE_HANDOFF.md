# Software City — Complete Handoff Document
Generated: 2026-03-12

---

## 1. WHAT WAS BUILT — Every File Created

### Root / Monorepo Config
| File | Description |
|------|-------------|
| `package.json` | pnpm workspace root; defines typecheck + build scripts |
| `pnpm-workspace.yaml` | Declares workspace packages: `artifacts/*`, `lib/*`, `scripts` |
| `tsconfig.base.json` | Shared TypeScript compiler base config (strict, ESNext, bundler resolution) |
| `tsconfig.json` | Root tsconfig referencing lib packages for project-level type checking |
| `.npmrc` | Forces pnpm usage; sets shamefully-hoist=true |
| `MIGRATION_REPORT.md` | Architecture overview document for migration to local dev |
| `VSCODE_COPILOT_HANDOFF_PROMPT.md` | Full handoff guide for VS Code + Copilot continuation |
| `COMPLETE_HANDOFF.md` | This file |

---

### Backend — `artifacts/api-server/`
| File | Description |
|------|-------------|
| `package.json` | Express + Drizzle + tsx dev deps; defines `dev` and `build` scripts |
| `tsconfig.json` | TypeScript config extending tsconfig.base.json |
| `build.ts` | esbuild-based production build script |
| `src/index.ts` | Server entry point; reads PORT env, starts Express app |
| `src/app.ts` | Express app factory; mounts CORS, JSON body parser, all routers |
| `src/routes/index.ts` | Central router; registers /api/repo, /api/city, /api/agents, /api/knowledge, /api/events, /api/health |
| `src/routes/repo.ts` | POST /api/repo/load (accepts repoUrl, branch, githubToken); POST /api/repo/demo |
| `src/routes/city.ts` | GET /api/city/layout; GET /api/city/health; GET /api/city/metrics |
| `src/routes/agents.ts` | GET /api/agents; POST /api/agents/spawn; POST /api/agents/:id/task; POST /api/agents/:id/chat |
| `src/routes/knowledge.ts` | GET /api/knowledge/stats; GET /api/knowledge/entries |
| `src/routes/events.ts` | GET /api/events — returns last 20 city events |
| `src/routes/health.ts` | GET /api/health — simple uptime ping |
| `src/lib/githubFetcher.ts` | Fetches file tree + contents from GitHub API; supports PAT auth for private repos; generates demo repo data |
| `src/lib/cityAnalyzer.ts` | Converts flat file list into city layout (districts, buildings, roads); assigns file types, colors, positions |
| `src/lib/agentEngine.ts` | NPC agent creation, dialogue generation, task simulation, knowledge base escalation |
| `src/lib/types.ts` | Shared TypeScript types used across backend modules |

---

### Frontend — `artifacts/software-city/`
| File | Description |
|------|-------------|
| `package.json` | React + Vite + TailwindCSS + Framer Motion + shadcn/ui deps |
| `vite.config.ts` | Vite config; sets host 0.0.0.0, reads PORT env, configures path aliases |
| `tsconfig.json` | TypeScript config for the frontend |
| `index.html` | HTML entry point; loads JetBrains Mono font from Google Fonts |
| `src/main.tsx` | React entry; wraps App with QueryClientProvider + Toaster |
| `src/App.tsx` | Root router (wouter); defines routes: / → Landing, /city → CityView, /agents → Agents, /knowledge → KnowledgeBase |
| `src/index.css` | Global TailwindCSS styles; defines glass-panel, glass-card, text-glow, neon shadow utilities |
| `src/pages/Landing.tsx` | Hero page; GitHub URL input + collapsible PAT field for private repos + demo button |
| `src/pages/CityView.tsx` | Main city view; polls layout/health/metrics/agents; renders HUD + CityMap + BuildingInspector; F3 debug HUD |
| `src/pages/Agents.tsx` | Agent roster; polls agents list; spawn dialog with 5 role options |
| `src/pages/KnowledgeBase.tsx` | Knowledge library; stats dashboard; searchable + filterable entry table |
| `src/components/city/CityMap.tsx` | SVG city renderer: districts, buildings, color-coded roads, NPC agents with activity icons, district minimap, hover tooltip |
| `src/components/city/BuildingInspector.tsx` | Right-panel inspector: file stats, coverage bar, status badge, Analyze/Gen Tests/Fuzz actions, agent chat |
| `src/components/city/HUD.tsx` | Top-center overlay: health score, season badge, active agents, bugs found, CPU load |
| `src/components/layout/AppLayout.tsx` | Main layout shell: sidebar nav, live event stream feed |
| `src/components/ui/*` | Full shadcn/ui component library (button, input, dialog, table, toast, etc.) |
| `src/hooks/use-toast.ts` | Toast notification hook (shadcn) |
| `src/lib/utils.ts` | `cn()` class name utility (clsx + tailwind-merge) |
| `public/images/hero-city.png` | Cyberpunk city background image for landing page |
| `public/images/logo.png` | Software City logo used in landing page header |

---

### API Client — `lib/api-client-react/`
| File | Description |
|------|-------------|
| `package.json` | Package config; exports from src/index.ts |
| `src/index.ts` | Re-exports all types, functions, and hooks from generated/ |
| `src/generated/api.schemas.ts` | All TypeScript interfaces: Building, District, CityLayout, Agent, LoadRepoRequest (with githubToken), etc. |
| `src/generated/api.ts` | All fetch wrappers + TanStack Query hooks: useGetCityLayout, useListAgents, useLoadRepo, useChatWithAgent, etc. |

---

### Database — `lib/db/`
| File | Description |
|------|-------------|
| `package.json` | Drizzle ORM + pg driver; defines db:push and db:studio scripts |
| `drizzle.config.ts` | Drizzle config pointing to DATABASE_URL |
| `src/index.ts` | Exports the Drizzle `db` client instance |
| `src/schema/index.ts` | Exports all 4 table schemas: repos, agents, knowledge_entries, events |
| `src/schema/repos.ts` | `repos` table: repoUrl, repoName, branch, fileCount, districtCount, healthScore, season, layoutData (JSON), analysisTime |
| `src/schema/agents.ts` | `agents` table: name, role, level, status, x, y, color, dialogue, currentTask, bugsFound, accuracy |
| `src/schema/knowledge.ts` | `knowledge_entries` table: problemType, question, answer, language, confidence, useCount, bugsFound |
| `src/schema/events.ts` | `events` table: type, message, location, severity, buildingId |

---

### API Spec — `lib/api-spec/`
| File | Description |
|------|-------------|
| `package.json` | Package metadata |
| `openapi.yaml` | Full OpenAPI 3.0 specification; source of truth for all API contracts |

---

### Scripts — `scripts/`
| File | Description |
|------|-------------|
| `post-merge.sh` | Runs after task agent merges: installs deps, runs db:push, restarts workflows |
| `package.json` | Package metadata for scripts workspace |
| `src/hello.ts` | Placeholder script file |
| `tsconfig.json` | TypeScript config for scripts |

---

## 2. WHAT IS WORKING — Verified Functionality

All three services start cleanly and run without errors:

| Service | Command | Port | Status |
|---------|---------|------|--------|
| API Server | `pnpm --filter @workspace/api-server run dev` | 8080 | RUNNING — "Server listening on port 8080" |
| Frontend (Vite) | `pnpm --filter @workspace/software-city run dev` | 25205 | RUNNING — "VITE v7.3.1 ready in 1215ms" |
| Mockup Sandbox | `pnpm --filter @workspace/mockup-sandbox run dev` | 8081 | RUNNING (unused for this project) |

**Browser console:** Zero errors. Zero warnings. Only Vite HMR connect messages.

### Features confirmed working (visually verified by screenshot):

**Landing Page**
- [x] Hero city background renders
- [x] GitHub URL input field
- [x] "Private repo? — add GitHub token" toggle expands/collapses smoothly
- [x] PAT password input with link to GitHub token generation page
- [x] "Run Demo Simulation" button
- [x] Animated entry (Framer Motion)

**City View**
- [x] City loads from demo data (37 files, 11 districts)
- [x] Health score (55/100), season (Autumn), active agents (5), bugs (2), CPU load displayed in HUD
- [x] All districts rendered as labeled cyan-bordered zones
- [x] Buildings rendered as colored blocks per file type
- [x] NPC agent dots animated with spring movement
- [x] NPC activity icons (🔥⚙️) appear above agents
- [x] "Press F3 for debug metrics" hint shown at bottom
- [x] District minimap (bottom-right) lists all districts with building counts, collapsible
- [x] Live event stream in sidebar showing timestamped events (AGENT_PROMOTED, ESCALATION, TEST_PASSED, BUILDING_COLLAPSE)
- [x] Dependency roads visible between buildings
- [x] Building click → inspector panel opens from right side

**Building Inspector**
- [x] File name, path, language, age displayed
- [x] LOC + complexity stats
- [x] Test coverage progress bar (correctly shows 0–100% from 0–1 API value)
- [x] HEALTHY / ACTIVE FIRE badge
- [x] Commit count
- [x] Analyze / Gen Tests / Fuzz action buttons (3-column grid)
- [x] "Agent dispatched..." pulse indicator on action pending
- [x] Agent chat panel with input + send button

**Agents Dashboard**
- [x] Agent cards with role, level, status, dialogue, bugs found, accuracy
- [x] 5 role types available for spawning
- [x] "Spawn Agent" dialog opens and closes
- [x] Auto-refresh every 3s

**Knowledge Base**
- [x] Stats cards: total entries, cache hits, escalation rate, avg bugs/entry
- [x] Search input filters entries by pattern/question/language in real time
- [x] Confidence filter buttons (all / high / medium / low)
- [x] Filtered result count shown
- [x] Entry table with pattern, language, question, confidence badge, uses, date

**Private Repo Support**
- [x] `githubToken` field added to `LoadRepoRequest` TypeScript interface
- [x] `Authorization: Bearer <token>` header sent on all GitHub API requests when token provided
- [x] Token used in both tree-fetch and all file-content fetch requests
- [x] Better error messages for 401 (bad token), 404 (not found/private), 403 (rate limit)
- [x] Token never written to database

---

## 3. WHAT IS BROKEN OR MISSING

### Known Bugs
| # | Issue | Location | Severity |
|---|-------|----------|----------|
| 1 | Agent chat uses hardcoded `"agent-1"` ID | `BuildingInspector.tsx` lines 35, 52 | Medium — chat may fail if no agent with that ID exists; should pick a real agent ID from the list |
| 2 | `agent.currentTask` not always populated by backend | `agentEngine.ts` | Low — task icons above NPCs may be empty for some agents; falls back to status icon |
| 3 | Agent positions are random, not path-based | `agentEngine.ts` | Low — agents teleport between random buildings rather than walking roads |
| 4 | No React error boundary around CityMap | `CityView.tsx` | Medium — an unhandled JS error in the SVG renderer blanks the entire city view |
| 5 | CPU load number has excessive decimal places in HUD | `HUD.tsx` line 48 | Low — shows `48.007318...%` instead of `48.0%`; needs `toFixed(1)` |
| 6 | Hero background image 404 | `public/images/hero-city.png` | Low — image not found at that path so landing hero has no background image (overlay still renders fine) |
| 7 | Logo image 404 | `public/images/logo.png` | Low — logo above the title is broken; shows alt text placeholder |

### Missing Features (Not Yet Implemented)
| Feature | Notes |
|---------|-------|
| Real code analysis | Complexity, imports, and coverage are all estimated/random — not from actual AST parsing |
| WebSocket streaming | All data uses HTTP polling; agent movement is jerky at 2–5s intervals |
| Local file watcher | No `chokidar` integration; can't watch a local repo directory for live updates |
| Real AI agents | NPC dialogue is templated/random; agents don't actually read code or call an LLM |
| User authentication | No login system; anyone with the URL can use the app |
| City history | No time-series tracking of health score changes |
| Repo comparison | Can only view one repo at a time |
| Export / share | No way to export a city snapshot as image or shareable URL |
| Mobile layout | UI is desktop-only; no responsive breakpoints for small screens |

### No `requirements.txt` — This Is Not a Python Project
This is a Node.js/TypeScript monorepo managed by pnpm. There is no `requirements.txt`.

### No `project.godot` — This Is Not a Godot Project
Despite references to Godot in some planning documents, the final implementation uses React + SVG for the city renderer. There is no Godot engine file in this project.

---

## 4. CURRENT FILE TREE

```
.
├── artifacts/
│   ├── api-server/
│   │   ├── build.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── app.ts
│   │       ├── index.ts
│   │       ├── lib/
│   │       │   ├── agentEngine.ts
│   │       │   ├── cityAnalyzer.ts
│   │       │   ├── githubFetcher.ts
│   │       │   └── types.ts
│   │       ├── middlewares/   (empty, .gitkeep)
│   │       └── routes/
│   │           ├── agents.ts
│   │           ├── city.ts
│   │           ├── events.ts
│   │           ├── health.ts
│   │           ├── index.ts
│   │           ├── knowledge.ts
│   │           └── repo.ts
│   ├── mockup-sandbox/        (Replit scaffold — unused for this project)
│   └── software-city/
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── components.json    (shadcn/ui config)
│       ├── tailwind.config.ts
│       ├── postcss.config.js
│       ├── public/
│       │   └── images/
│       │       ├── hero-city.png   ⚠️ 404 — file missing
│       │       └── logo.png        ⚠️ 404 — file missing
│       └── src/
│           ├── App.tsx
│           ├── main.tsx
│           ├── index.css
│           ├── hooks/
│           │   └── use-toast.ts
│           ├── lib/
│           │   └── utils.ts
│           ├── pages/
│           │   ├── Landing.tsx
│           │   ├── CityView.tsx
│           │   ├── Agents.tsx
│           │   └── KnowledgeBase.tsx
│           └── components/
│               ├── city/
│               │   ├── CityMap.tsx
│               │   ├── BuildingInspector.tsx
│               │   └── HUD.tsx
│               ├── layout/
│               │   └── AppLayout.tsx
│               └── ui/
│                   └── [full shadcn/ui component library]
├── lib/
│   ├── api-client-react/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── generated/
│   │           ├── api.schemas.ts
│   │           └── api.ts
│   ├── api-spec/
│   │   ├── package.json
│   │   └── openapi.yaml
│   └── db/
│       ├── package.json
│       ├── drizzle.config.ts
│       └── src/
│           ├── index.ts
│           └── schema/
│               ├── index.ts
│               ├── agents.ts
│               ├── events.ts
│               ├── knowledge.ts
│               └── repos.ts
├── scripts/
│   ├── package.json
│   ├── post-merge.sh
│   ├── tsconfig.json
│   └── src/
│       └── hello.ts
├── COMPLETE_HANDOFF.md
├── MIGRATION_REPORT.md
├── VSCODE_COPILOT_HANDOFF_PROMPT.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── tsconfig.json
```

---

## 5. CURRENT `requirements.txt`

**Does not exist.** This is a Node.js/TypeScript project. Dependencies are declared in `package.json` files per workspace package and locked in `pnpm-lock.yaml`.

Key runtime dependencies:

**Backend (`artifacts/api-server/package.json`):**
```
express ^5.x
drizzle-orm
pg (postgres)
cors
tsx (dev)
typescript
```

**Frontend (`artifacts/software-city/package.json`):**
```
react ^18
react-dom ^18
vite ^7
@tanstack/react-query
framer-motion
wouter
lucide-react
date-fns
tailwindcss
@radix-ui/* (via shadcn/ui)
clsx
tailwind-merge
```

---

## 6. CURRENT `project.godot`

**Does not exist.** This project does not use the Godot engine. The city renderer is built entirely in React using SVG — no game engine is involved.

---

## 7. BUILD ERRORS SEEN (Verbatim)

### Crash that was fixed during this session:
```
[RUNTIME_ERROR] {
  "type": "runtime-error",
  "name": "Error",
  "message": "ShieldCheck is not defined",
  "loc": {
    "line": 110,
    "column": 18,
    "file": "artifacts/software-city/src/components/city/BuildingInspector.tsx"
  },
  "frame": "108|              ) : (\n109|                <span ...>\n110|                  <ShieldCheck size={14} /> HEALTHY\n   |                   ^\n111|                </span>"
}
```
**Root cause:** `ShieldCheck` was used in JSX but not included in the `lucide-react` import on line 5.
**Fix applied:** Added `ShieldCheck` (and `FlaskConical`, `X`, `Network`) to the import statement.

### Current build/runtime errors:
**None.** All three workflows start and run without errors. Browser console shows zero errors.

---

## 8. WHAT THE APP DOES RIGHT NOW

### When you open the app at `/`
You land on a **dark cyberpunk hero page** with an animated title "SOFTWARE CITY" in neon cyan. There is a form with:
- A GitHub URL input field
- A collapsible "Private repo? — add GitHub token" section that reveals a password field for your GitHub PAT
- A "Run Demo Simulation" button

### When you click "Run Demo Simulation"
The backend generates a hardcoded demo repository structure (37 files across 11 districts, representing a typical full-stack app). It saves this to the PostgreSQL database and redirects you to `/city`.

### At `/city` — The City View
A full-screen **SVG city map** renders showing:
- **11 colored district zones** labeled with folder paths (e.g. `/SRC/DB`, `/TESTS/UNIT`, `/APPS/WEBVIEW/SRC`)
- **Buildings** as colored rectangles within each district — cyan for classes, green for functions, orange for APIs, purple for database files, magenta for test files
- **Roads** as thin cyan lines connecting buildings that import each other
- **3–5 NPC agent dots** that float across the city with spring-physics animation; they display emoji above them (🔥, ⚙️) based on their current task
- **Top HUD bar** showing: health score (e.g. "55/100"), season ("Autumn"), active agents count, bugs found, CPU load percentage
- **Bottom-right minimap** listing all districts as clickable rows with building counts — collapsible
- **Left sidebar** with navigation and a live event stream showing events like "Building collapse detected: legacy.js has 0% test coverage" and "QA Quinn promoted to Level 3"
- **Bottom-center hint**: "Press F3 for debug metrics"

### When you click a building
A **right-panel inspector** slides in showing:
- File name, path, language, age
- LOC and complexity numbers
- Test coverage progress bar (correctly scaled 0–100%)
- Status badge (HEALTHY or ACTIVE FIRE/ALARM)
- Commit count
- Three action buttons: **Analyze**, **Gen Tests**, **Fuzz** — these dispatch tasks to a simulated agent
- A chat panel where you can type messages and get agent replies

### When you press F3
A **debug overlay** appears in the top-right corner showing real-time: browser FPS (measured with requestAnimationFrame), CPU %, RAM usage (from backend metrics), active/escalating agent counts, and bugs found.

### At `/agents`
An agent roster showing all NPC agents with their role type, level badge, current dialogue thought bubble, status (idle/working/escalating), bugs found, and accuracy. A "Spawn Agent" button opens a dialog to create a new agent by role.

### At `/knowledge`
A knowledge base library showing stats (total entries, cache hits, escalation rate) and a searchable/filterable table of all patterns the agents have "learned." You can filter by confidence level (high/medium/low) and search across patterns, questions, and languages.

### When you load a real GitHub repo
You enter a URL like `https://github.com/your-org/your-repo`. If it's private, you expand the token section and paste a GitHub PAT (needs `repo` scope for classic tokens, or `Contents: Read` for fine-grained tokens). The backend fetches the file tree and up to 500 source files, analyzes them into a city layout, and redirects to the city view showing your actual repository structure.

---

*Document generated from live system state on 2026-03-12. All three services verified running with zero console errors.*
