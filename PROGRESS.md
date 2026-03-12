# Software City — Build Progress

## Session 2 (2026-03-12) — Phase 2: Brain Wired

### What Was Implemented

- Real AST analysis via `codeAnalyzer.ts` (regex-based LOC, cyclomatic complexity, imports, exports, functions, classes)
- Real city metrics: building height from LOC, building width from complexity
- Real dependency graph from actual import paths (not random roads)
- Real health scoring via `healthScorer.ts` (test coverage 40%, clean ratio 30%, complexity 20%, test file ratio 10%)
- Real season determination from health score (Summer ≥80, Spring ≥60, Autumn ≥40, Winter <40)
- WebSocket server (`wsServer.ts`) replacing HTTP polling for NPC movement
- Ollama integration (`ollamaClient.ts`) — graceful degradation if not running
- Prompt templates (`ollamaPrompts.ts`) for test generation and dialogue
- Real escalation chain (`escalationEngine.ts`): Knowledge Base → Groq → Anthropic → Ollama → fallback
- Knowledge base persistence (similarity search saves/loads from `knowledge` table)
- Real NPC agent loop (`agentEngine.ts` rewrite): chooseTarget scoring, 3-attempt Ollama, escalation, leveling
- Real agent chat with source badges (local/KB/groq/claude) + escalation offer button
- Local file watcher via `chokidar` (`fileWatcher.ts`)
- Git history reading via `simple-git` (`gitHistory.ts`)
- City snapshot export (`GET /api/city/snapshot`)
- Programmatic SVG image generation (`assetGenerator.ts`) for hero background and logo
- Images served at `/api/assets/hero` and `/api/assets/logo`
- Landing page local folder watcher input
- HUD CPU decimal fix (`.toFixed(1)`)
- BuildingInspector: uses real first available agent instead of hardcoded "agent-1"
- React error boundary around `<CityMap />` 
- WebSocket hook (`useWebSocket.ts`) for live NPC movement + bug flash animations
- Color-coded event stream (red=bugs, green=tests, orange=escalation, cyan=promotions)
- Ollama status indicator in HUD
- Export button in city toolbar

### API Endpoints Added

- `GET /api/assets/hero` — SVG city skyline image
- `GET /api/assets/logo` — SVG logo image
- `GET /api/ollama/status` — Ollama availability + model list
- `POST /api/repo/watch` — Start chokidar file watcher on local path
- `GET /api/repo/watch/status` — Watcher status
- `DELETE /api/repo/watch` — Stop watcher
- `GET /api/city/snapshot` — Full JSON export of current city state

### Current Status: FUNCTIONAL CORE COMPLETE

All services run with zero TypeScript errors. WebSocket established. Real analysis produces
non-random, file-content-derived metrics. Escalation chain falls through gracefully when
AI APIs not configured.

### Next Phase Recommendations

1. Godot integration — embed the city as a proper game engine scene
2. Git history timeline slider in city view
3. Real test execution (not just generation) with pass/fail results
4. Multi-repo support — load several repos and compare their cities
5. User authentication (Replit Auth) for saved city sessions
6. Mobile responsive layout
