# TunisIA Invest

AI-assisted investment-analysis platform for African and emerging-market startups. Screen companies, score them against regional benchmarks, and analyse pitch decks — with or without an LLM.

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐
│   Frontend (5173)   │     │   Backend (8001)          │
│  React + Vite + TS  │────▶│  FastAPI + SQLAlchemy     │
│  Tailwind + Recharts │     │  SQLite + APScheduler     │
└─────────────────────┘     └──────────┬───────────────┘
                                       │
                          ┌────────────┴──────────────┐
                          │  Ollama (optional, 11434)  │
                          │  Local LLM for AI features │
                          └───────────────────────────┘
```

The Vite dev server proxies `/api` requests to the backend, so frontend calls use relative paths.

## Features

- **Mode 1 — Startup Screening** — Filter the seeded startup database by sector, country, stage, or natural-language prompts. Each startup is scored against African benchmarks using a weighted pillar system (Growth 40%, Financial 30%, Risk 20%, ESG 10%).
- **Mode 2 — Pitch Deck Analysis** — Upload a pitch deck (PDF), extract its content, find comparable startups in the database, and get a viability verdict with an AI-generated commentary.
- **AI Assistant** — Chat interface backed by a local Ollama LLM or an OpenRouter model. Maintains conversation context per session.
- **Monitoring Dashboard** — Track portfolio health, deal flow, and sector allocation with interactive charts (Recharts).
- **Weekly Agents** — Portfolio Watchdog (Mon 08:00) and Sector Thesis Scout (Mon 08:30) run as background APScheduler jobs. The Scout generates market-trend newsletters stored in the DB.
- **JWT Authentication** — Login/register with hashed passwords, 7-day token expiry. All private routes require authentication.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Python, FastAPI, SQLAlchemy, SQLite |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Charts | Recharts |
| State | Zustand (auth), TanStack Query (server) |
| Forms | react-hook-form + zod |
| LLM | Ollama (local) or OpenRouter (cloud) |
| Scheduler | APScheduler |
| Auth | JWT (python-jose, HS256) |

## Prerequisites

- Python 3.10+
- Node.js 18+
- Ollama (optional — the app works without it using fallback responses)

## Quick Start

### 1. Clone and set up

```bash
git clone <repo-url>
cd tunIA
```

### 2. Backend

```bash
python -m venv myvenvv
#source myvenvv/bin/activate.sh     # Linux/macOS
# myvenvv\Scripts\activate.bat      # Windows

pip install -r requirements.txt
cd backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

API docs available at `http://localhost:8001/docs`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`.

### 4. Ollama (optional)

```bash
ollama serve
```

Set which model to use via environment variables (defaults: `qwen3.6`, `http://localhost:11434`):

```bash
export OLLAMA_MODEL=qwen3.6
export OLLAMA_BASE_URL=http://localhost:11434
```

### 5. One-command scripts

| Platform | Command |
| --- | --- |
| Windows | `start_all.bat` |
| Linux/macOS | `./start.sh` |

Both scripts check that the virtualenv and npm are ready, install frontend deps if missing, and launch both servers in parallel.

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | No | `qwen3.6` | Ollama model name |
| `DATABASE_URL` | No | `sqlite:///./tunisia_invest.db` | SQLite database path |
| `SECRET_KEY` | Yes | — | JWT signing key (generate with `secrets.token_urlsafe(48)`) |
| `SMTP_HOST` | No | — | SMTP server for weekly newsletters (leave blank to skip email) |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP app password |

## Project Structure

```
tunisia-invest/
├── backend/
│   ├── main.py              # FastAPI app assembly, lifespan, scheduler
│   ├── database.py          # SQLite engine, session, migrations
│   ├── models.py            # SQLAlchemy ORM models
│   ├── schemas.py           # Pydantic request/response models
│   ├── seed_data.py         # Demo startup database seeder
│   ├── routers/             # API route handlers (one per feature)
│   │   ├── auth.py          # Registration, login, JWT
│   │   ├── mode1.py         # Startup screening
│   │   ├── mode2.py         # Pitch deck upload & analysis
│   │   ├── startups.py      # CRUD for startup profiles
│   │   ├── chat.py          # AI assistant chat
│   │   ├── monitoring.py    # Dashboard data endpoints
│   │   ├── benchmarks.py    # Metric benchmark CRUD
│   │   ├── settings.py      # User settings
│   │   └── memory.py        # Context memory
│   └── services/
│       ├── scoring_engine.py        # Deterministic company scoring
│       ├── ollama_service.py        # Ollama LLM client
│       ├── openrouter_service.py    # OpenRouter LLM client
│       ├── gemini_service.py        # Google Gemini client
│       ├── doc_parser.py            # PDF/document extraction
│       ├── prompt_filter_service.py # NL → filter translation
│       ├── watchdog_agent.py        # Weekly portfolio watchdog
│       ├── thesis_scout_agent.py    # Weekly market-trends scout
│       ├── email_service.py         # SMTP newsletter delivery
│       └── web_search_service.py    # DuckDuckGo search/scrape
├── frontend/
│   ├── src/
│   │   ├── api/             # Axios modules (one per backend area)
│   │   ├── components/      # Shared UI components
│   │   ├── pages/           # Route page components
│   │   ├── store/           # Zustand stores
│   │   ├── types/           # TypeScript type definitions
│   │   └── utils/           # Utility functions
│   ├── index.html
│   ├── vite.config.ts       # Dev server + API proxy config
│   └── package.json
├── .env.example             # Environment variable template
├── .gitignore
├── start_all.bat            # Windows launcher
├── start.sh                 # Linux/macOS launcher
├── requirements.txt         # Python dependencies
└── LICENSE
```

## API Overview

All routes are prefixed with `/api/v1/`. The full OpenAPI spec is available at `http://localhost:8001/docs` when the backend is running.

| Endpoint Group | Description |
| --- | --- |
| `POST /api/v1/auth/register`, `/login` | User registration and authentication |
| `GET /api/v1/startups` | List/search startups with filters |
| `POST /api/v1/mode1/filter` | Natural-language startup filtering |
| `POST /api/v1/mode1/scores` | Get AI-explained scores for startups |
| `POST /api/v1/mode2/upload` | Upload and analyse a pitch deck |
| `POST /api/v1/chat` | AI assistant chat with history |
| `GET /api/v1/monitoring/dashboard` | Dashboard aggregate data |
| `GET /api/v1/monitoring/portfolio-history` | Portfolio performance over time |
| `GET /api/v1/benchmarks` | Metric benchmark values |
| `GET /api/v1/health` | Health check + Ollama status |

## License

MIT
