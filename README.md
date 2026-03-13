# Software City

> Visualize any GitHub repository as a living pixel-art city. AI agents patrol the code, hunt bugs shown as fires and alarms, and save learnings to a persistent knowledge base.

![Software City Screenshot](https://placehold.co/1200x600/0a0e1a/00fff7?text=Software+City)

## What is this?

Software City converts a GitHub repository into an interactive city map:

- **Buildings** = source files, sized by lines of code, colored by file type
- **Districts** = logical groups (source, tests, config, API, database)
- **Roads** = import/dependency connections between files
- **NPC Agents** = AI workers that patrol buildings, generate tests, find bugs
- **Fires** = buildings with detected issues
- **Seasons** = reflect overall code health (summer = healthy, winter = troubled)

## Quick Start

```bash
git clone <this-repo>
cd software-city
pnpm install
pnpm dev
```

Open `http://localhost:5173` (frontend) or `http://localhost:8080/api/health` (API).

For one-command start (both services):

```bash
pnpm dev
```

## Requirements

- Node.js 20+
- pnpm 10+
- Optional: [Ollama](https://ollama.ai) for local AI analysis
- Optional: Groq or Anthropic API key for cloud AI escalation

## Features

| Feature | Status |
|---------|--------|
| Repository visualization | ✅ |
| AI NPC agents | ✅ |
| Bug detection (fire/alarm) | ✅ |
| Knowledge base | ✅ |
| Agent escalation (Ollama → Groq → Anthropic) | ✅ |
| City health score + seasons | ✅ |
| Real-time WebSocket updates | ✅ |
| Metrics history & dashboard | ✅ |
| Settings panel | ✅ |
| Agent leaderboard | ✅ |
| Export (JSON / SVG / Markdown) | ✅ |
| Docker support | ✅ |

## Project Structure

```
software-city/
├── artifacts/
│   ├── api-server/          # Express + WebSocket backend
│   │   ├── src/
│   │   │   ├── lib/         # Core logic (agents, WS, analysis, city)
│   │   │   └── routes/      # REST API routes
│   │   └── data/city.db     # SQLite database (auto-created)
│   └── software-city/       # React + Vite frontend
│       └── src/
│           ├── components/  # City map, HUD, panels
│           ├── pages/       # City, Agents, Knowledge, Metrics, Settings
│           └── hooks/       # WebSocket, data fetching
└── libs/
    ├── db/                  # Drizzle ORM schema + client
    └── api-client-react/    # Generated API client (orval)
```

## AI Setup

Software City uses a tiered AI system:

1. **Ollama (local)** — Runs `deepseek-coder-v2:16b` locally. Free, private, slower.
2. **Groq (cloud)** — Free tier, very fast. Set `GROQ_API_KEY` in `.env`.
3. **Anthropic (cloud)** — Highest quality. Set `ANTHROPIC_API_KEY` in `.env`.

Copy `.env.template` to `.env` and fill in keys as needed. Without any AI, agents still run in simulation mode.

## Docker

```bash
# Build and run
docker compose up --build

# With AI keys
GROQ_API_KEY=your-key docker compose up --build
```

The city data persists in a named Docker volume (`city-data`).

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health + DB size |
| `GET /api/city/layout` | City map layout |
| `GET /api/city/health` | Health score + season |
| `GET /api/city/snapshot` | Full city JSON export |
| `POST /api/city/report` | Generate Markdown report |
| `GET /api/agents` | List all NPC agents |
| `GET /api/metrics/history` | Historical metrics |
| `GET /api/settings` | App settings |
| `PUT /api/settings` | Update settings |
| `WS /ws` | Real-time event stream |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `G` | City view |
| `A` | Agents |
| `K` | Knowledge base |
| `L` | Leaderboard |
| `T` | Start tour |
| `F3` | Debug HUD |
| `?` | Shortcuts panel |
| `Esc` | Deselect / close |

## Architecture

- **Backend**: Express + ws + Drizzle ORM on SQLite via `@libsql/client`
- **Frontend**: React 18 + Vite + Tailwind CSS + shadcn/ui
- **Transport**: REST for data, WebSocket for real-time events (50ms batched)
- **AI**: Ollama (local) with Groq/Anthropic escalation fallback
- **Monorepo**: pnpm workspaces with shared `libs/db` and `libs/api-client-react`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
# CodeCity-V1
