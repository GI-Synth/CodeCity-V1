# Software City

Walk through your codebase like a city. Buildings are files, districts are folders, and AI agents patrol the streets to surface bugs, test gaps, and risky patterns.

## Quick Start

Requirements:

- Node.js 20+
- pnpm 10+

Install and run:

```bash
pnpm install
pnpm dev
```

Open:

- UI: `http://127.0.0.1:5173`
- API health: `http://127.0.0.1:3000/api/healthz`

## CLI Commands

```bash
pnpm check-ai      # AI provider availability (Ollama/Groq/OpenRouter/Anthropic)
pnpm analyze       # Repository and DB summary
pnpm seed-kb       # Seed built-in anonymized KB patterns (20+)
pnpm train-kb      # Optional repo-driven KB training pass
pnpm validate      # End-to-end agent->escalation->KB validation loop
pnpm run typecheck # Full workspace type checking
```

## What It Does

- Converts repository structure into an explorable city map.
- Computes building health from complexity, coverage, and quality signals.
- Runs role-based AI agents (QA inspector, API fuzzer, load tester, edge explorer, UI navigator).
- Escalates hard questions through a provider chain and stores learnings in a persistent KB.
- Streams live events and agent activity to the frontend.

## AI Tiers

- Tier 0: local Ollama (offline-first)
- Tier 1: free cloud providers (Groq/OpenRouter)
- Tier 2: paid cloud provider (Anthropic)

If no provider is available, the system still runs with fallback behavior and deterministic local logic.

## Architecture

- `artifacts/api-server`: Express API, WebSocket server, orchestrator, escalation engine
- `artifacts/software-city`: React + Vite city UI and dashboards
- `lib/db`: Drizzle schema + SQLite/libsql client
- `lib/api-spec`: OpenAPI source
- `lib/api-client-react`: generated query hooks

## Key API Routes

- `GET /api/healthz`
- `GET /api/city/layout`
- `GET /api/city/health`
- `GET /api/city/metrics`
- `GET /api/agents/list`
- `POST /api/agents/spawn`
- `POST /api/agents/:agentId/chat`
- `GET /api/knowledge/stats`
- `GET /api/knowledge/session-stats`
- `GET /api/events/stream`

## End-to-End Validation

`pnpm validate` performs an automated integration loop:

- verifies API health
- seeds a temporary KB pattern
- spawns an agent
- runs chat + escalation handshake
- confirms knowledge-base cache hit behavior
- confirms live session telemetry (`/api/knowledge/session-stats`)
- cleans up temporary artifacts

This command is the fastest way to prove the core loop is functioning on your machine.

## Contributing

See `CONTRIBUTING.md` for development guidelines.

## License

MIT
