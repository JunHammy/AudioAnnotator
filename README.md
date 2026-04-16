# AudioAnnotator

A web-based audio annotation platform. Annotators label speech segments with speaker identities, genders, transcriptions, and emotions. Admins manage files, assign work, review results, and export data.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) + Chakra UI v3 + TypeScript |
| Backend | FastAPI + SQLAlchemy 2.0 (async) + SQLite |
| Auth | JWT (python-jose + passlib) |
| Audio | WaveSurfer.js v7 |
| Migrations | Alembic |

---

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** and **npm**
- Git

---

## Local Setup (No Docker)

### 1. Clone the repo

```bash
git clone https://github.com/JunHammy/AudioAnnotator.git
cd AudioAnnotator
```

### 2. Backend

```bash
# Create and activate a virtual environment (run from repo root)
python -m venv virt
source virt/Scripts/activate      # Windows (Git Bash)
# source virt/bin/activate         # macOS / Linux

# Move into the backend folder
cd backend

# Install dependencies
pip install -r requirements.txt

# Create your .env file from the template
cp .env.example .env
```

Open `backend/.env` and replace the `SECRET_KEY` placeholder with a real value:

```bash
# Run this to generate one — copy the output into .env
python -c "import secrets; print(secrets.token_hex(32))"
```

Then finish the backend setup:

```bash
# Apply database migrations
alembic upgrade head

# Create the default admin account
python seed.py

# Start the backend server
uvicorn app.main:app --reload
```

Backend is running at `http://127.0.0.1:8000` — leave this terminal open.

> **Windows note:** If Docker Desktop is installed, always use `http://127.0.0.1:8000`, not `http://localhost:8000`.

---

### 3. Frontend

Open a **new terminal** at the repo root, then:

```bash
# Activate the venv again in the new terminal
source virt/Scripts/activate      # Windows (Git Bash)
# source virt/bin/activate         # macOS / Linux

# Move into the frontend folder
cd frontend

# Create your .env.local file from the template
cp .env.example .env.local

# Install dependencies
npm install --legacy-peer-deps

# Start the dev server
npm run dev
```

Open `http://localhost:3000` in your browser.

Log in with the default admin account:
- **Username:** `admin`
- **Password:** `admin123`

> Change this password after first login via Admin → Accounts → Reset PW.

---

## Docker Setup

Docker Compose bundles both services and handles the database and uploads automatically.

### Development (with hot reload)

```bash
# Start
docker compose -f docker-compose.dev.yml up --build

# Stop
docker compose -f docker-compose.dev.yml down

# Wipe database and uploads
docker compose -f docker-compose.dev.yml down -v
```

After first start, create the admin account:

```bash
docker compose -f docker-compose.dev.yml exec backend python seed.py
```

The app runs at `http://localhost:3000`. The backend is also exposed at `http://localhost:8000` for direct API testing.

### Production

Create `backend/.env.prod` (copy from `.env.prod.example` and fill in real values):

```bash
cp backend/.env.prod.example backend/.env.prod
# Edit backend/.env.prod — set SECRET_KEY, ADMIN_PASSWORD, ALLOWED_ORIGINS
```

```bash
# Build and start
docker compose up --build -d

# Seed on first run
docker compose exec backend python seed.py

# Stop
docker compose down

# Wipe data
docker compose down -v
```

The app runs at `http://localhost:3000`. Put Nginx or an ALB in front for HTTPS in production.

---

## Project Structure

```
AudioAnnotator/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI app entry point
│   │   ├── config.py             # Settings (pydantic-settings)
│   │   ├── database.py           # Async SQLAlchemy engine + session
│   │   ├── auth/                 # JWT helpers, dependency guards
│   │   ├── models/models.py      # All ORM models
│   │   ├── schemas/schemas.py    # All Pydantic schemas
│   │   ├── routers/              # API route handlers
│   │   └── services/             # Business logic (export, upload, …)
│   ├── alembic/
│   │   └── versions/             # 13 migration files
│   ├── .env.example              # Template — copy to .env
│   ├── seed.py                   # Creates default admin account
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/                  # Next.js App Router pages
│   │   │   ├── admin/            # Admin pages (dashboard, files, review, …)
│   │   │   └── annotator/        # Annotator pages (tasks, annotation view)
│   │   ├── components/           # Shared UI components
│   │   ├── context/              # Auth + SSE context providers
│   │   └── lib/                  # Axios instance, theme, toaster
│   ├── .env.example              # Template — copy to .env.local
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml            # Production Docker Compose
├── docker-compose.dev.yml        # Development Docker Compose
└── README.md
```

---

## Environment Variables

### `backend/.env` (copy from `backend/.env.example`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./audioannotator.db` | SQLite connection string |
| `SECRET_KEY` | *(required)* | JWT signing key — generate with `openssl rand -hex 32` |
| `ALGORITHM` | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | Token lifetime (24 h) |
| `UPLOAD_DIR` | `./uploads` | Directory for uploaded audio files |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins (comma-separated) |
| `ENVIRONMENT` | `development` | Set to `production` for stricter startup checks |
| `ADMIN_USERNAME` | `admin` | Username created by `seed.py` |
| `ADMIN_PASSWORD` | `admin123` | Password created by `seed.py` — change before deploying |

### `frontend/.env.local` (copy from `frontend/.env.example`)

| Variable | Value |
|----------|-------|
| `BACKEND_URL` | `http://127.0.0.1:8000` (local) or `http://backend:8000` (Docker) |

> **Note:** `BACKEND_URL` is a server-side variable used by the Next.js API proxy. It is never exposed to the browser.

---

## Default Accounts

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Admin |

Created by running `seed.py`. Additional annotator accounts are created through the Admin → Accounts UI.

---

## Common Commands

```bash
# Activate Python venv (from repo root)
source virt/Scripts/activate        # Windows Git Bash
source virt/bin/activate            # macOS / Linux

# Apply all database migrations
cd backend && alembic upgrade head

# Check current migration state
alembic current

# Start backend (from backend/)
uvicorn app.main:app --reload

# Start frontend (from frontend/)
npm run dev

# Docker — rebuild after code changes
docker compose -f docker-compose.dev.yml up --build

# Docker — hard reset (wipes DB + uploads)
docker compose -f docker-compose.dev.yml down -v && \
docker compose -f docker-compose.dev.yml up --build -d && \
docker compose -f docker-compose.dev.yml exec backend python seed.py
```

---

## API Reference

Base URL: `http://127.0.0.1:8000/api`

Interactive docs at `http://127.0.0.1:8000/docs` (Swagger UI) when the backend is running.

| Prefix | Description |
|--------|-------------|
| `/auth` | Login, token refresh |
| `/users` | Account management (admin) |
| `/datasets` | Dataset CRUD (admin) |
| `/audio-files` | File upload, stream, lock, archive |
| `/assignments` | Task assignment and status |
| `/segments` | Speaker, transcription, emotion segment CRUD |
| `/review` | Admin review and edit history |
| `/export` | JSON / CSV export (per-file or per-dataset) |
| `/admin` | Bracket words, activity log, dashboard stats |
| `/events` | Server-sent events (real-time updates) |

---

## Troubleshooting

**Backend returns connection errors on Windows**  
Docker Desktop listens on port 8000 on IPv6. Use `http://127.0.0.1:8000` — never `localhost:8000`.

**`bcrypt` import error at startup**  
The project requires `bcrypt==4.0.1`. Version 5.x breaks passlib. Run:
```bash
pip install bcrypt==4.0.1
```

**Alembic migration fails: "table already exists"**  
The database was created outside of Alembic. Delete `backend/audioannotator.db` and re-run `alembic upgrade head`.

**Frontend shows 503 "Backend unreachable"**  
The backend is not running or `BACKEND_URL` in `.env.local` is wrong. Confirm the backend is up and the URL uses `127.0.0.1`, not `localhost`.

**VSCode Source Control shows thousands of untracked files**  
This is a VSCode display issue — the `.gitignore` is correct. Add `"git.statusLimit": 50000` to your VSCode `settings.json` to fix the display.