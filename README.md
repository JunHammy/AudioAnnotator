# AudioAnnotator

A web-based audio annotation platform. Annotators label speech segments with speaker identities, genders, transcriptions, and emotions. Admins manage files, assign work, review results, and export data.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Feature Reference](#2-feature-reference)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Environment Variables](#5-environment-variables)
6. [Local Setup — No Docker](#6-local-setup--no-docker)
7. [Local Setup — Docker](#7-local-setup--docker)
8. [EC2 Production Deployment](#8-ec2-production-deployment)
9. [EC2 Maintenance & Operations](#9-ec2-maintenance--operations)
10. [Database Management](#10-database-management)
11. [User & Account Management](#11-user--account-management)
12. [Annotation Conventions](#12-annotation-conventions)
13. [Export Format](#13-export-format)
14. [API Reference](#14-api-reference)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. System Overview

AudioAnnotator is a collaborative annotation tool for speech audio files. The workflow is:

1. **Admin uploads** audio files (WAV) and optional JSON sidecars for pre-existing speaker segments, transcriptions, and emotion labels.
2. **Admin assigns tasks** to annotators — each file can have up to four independent task types: `speaker`, `gender`, `transcription`, `emotion`.
3. **Annotators log in** and work through their assigned files in the Annotation View.
4. **Admin reviews** completed annotations in the Review & Finalize page, resolves emotion conflicts using a 3-tier system, and exports the final dataset.

### Roles

| Role | Access |
|------|--------|
| `admin` | All pages. Can manage accounts, upload files, assign tasks, review, export, lock/unlock tracks. |
| `annotator` | My Tasks and Annotation View only. |

### Collaborative vs. Independent Tasks

| Task | Type | Behaviour |
|------|------|-----------|
| Speaker labelling | Collaborative | All annotators share one set of speaker segments. Edits are visible to everyone. Optimistic locking prevents conflicts. |
| Gender labelling | Collaborative | Same shared segments as speaker. Gender is independently lockable. |
| Transcription | Collaborative | All annotators share one set of transcription segments. |
| Emotion | Independent | Each annotator has their own private copy of emotion segments. Admins see all and resolve conflicts. |

---

## 2. Feature Reference

### Admin Pages

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | `/admin` | Stat cards (files, annotators, tasks). Dataset progress bars. Per-annotator completion summary. |
| Upload Files | `/admin/upload` | Upload individual WAV files or a folder. Auto-detects `_speaker.json`, `_transcription.json`, `_emotion.json` sidecars. |
| Datasets | `/admin/datasets` | Group files into named datasets. Add/remove files from datasets. Export a full dataset as JSON or CSV. |
| Manage Files | `/admin/files` | Global file list with status badges, task pills, metadata editing (language, speaker count), per-track lock/unlock toggles, archive (soft delete), and restore archived files. |
| Manage Accounts | `/admin/annotators` | Create annotator accounts, reset passwords, view per-annotator trust scores. |
| Assign Tasks | `/admin/assignments` | Assign task types to annotators per file (single or bulk). Reopen completed tasks. |
| Review & Finalize | `/admin/review` | Per-file review. Emotion conflict resolution (3-tier). Collaborative segment history. Lock/unlock any track. |
| Bracket Words | `/admin/bracket-words` | Manage the list of filler/bracket words. Auto-detected on the transcription track when an annotator marks complete. |
| Activity Log | `/admin/activity` | Audit trail of all segment edits. |
| Help | `/admin/help` | Admin user guide with video walkthroughs. |

### Annotator Pages

| Page | URL | Description |
|------|-----|-------------|
| My Tasks | `/annotator` | Stat cards (pending, in-progress, completed). Task table grouped by file. Start/Continue button per task. |
| Annotation View | `/annotator/annotate?file=<id>` | Full annotation interface: waveform player, speaker accordion, segment tracks, emotion editor, gender pills, remarks, keyboard shortcuts. |
| Help | `/annotator/help` | Annotator user guide with video/image walkthroughs. |

### Key Annotation Features

- **Waveform player** — play/pause, seek, zoom (50–400 px/s), speed (0.5x–2x), click-drag to create a speaker segment.
- **Speaker picker** — when adding a speaker, choose between next auto-numbered label (`speaker_0`, `speaker_1`, ...), `speaker_unknown` (cannot identify), or `speaker_group` (multiple speakers simultaneously).
- **Gender labelling** — Male / Female / Mixed / Unknown per speaker lane; applies to all segments under that speaker.
- **Emotion annotation** — 7 standard emotions + free-text "Other:...". Ambiguous flag. Notes field. Keyboard shortcuts 1-7, A.
- **Bracket word detection** — scans transcription text for configured filler words when a transcription task is marked complete. Shows a preview dialog before applying.
- **Remarks** — annotators can send a free-text note to the admin per file. Admin can reply.
- **Notifications** — real-time bell icon shows new assignments and admin replies.
- **Undo** — Ctrl+Z undoes the last segment save (emotion and transcription).
- **Keyboard shortcuts** — Space (play/pause), left/right arrows (seek 2 s), S (save), N (next unannotated), ? (shortcuts panel).

---

## 3. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router, Turbopack) + Chakra UI v3 + TypeScript |
| Backend | FastAPI + SQLAlchemy 2.0 (async) + SQLite (aiosqlite) |
| Auth | JWT — python-jose + passlib/bcrypt 4.0.1 |
| Audio | WaveSurfer.js v7 (client-side waveform + regions plugin) |
| Migrations | Alembic (sync SQLite for migrations, aiosqlite at runtime) |
| Real-time | Server-Sent Events (SSE) for live segment updates and notifications |
| Container | Docker + Docker Compose (dev and production variants) |

---

## 4. Project Structure

```
AudioAnnotator/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI app entry point, CORS, router includes
│   │   ├── config.py             # pydantic-settings (reads .env / .env.prod)
│   │   ├── database.py           # Async engine, Base, get_db() dependency
│   │   ├── auth/
│   │   │   ├── jwt.py            # hash/verify password, create/decode JWT
│   │   │   └── dependencies.py   # get_current_user, require_admin, require_annotator
│   │   ├── models/models.py      # All ORM models
│   │   ├── schemas/schemas.py    # All Pydantic request/response schemas
│   │   ├── routers/              # One file per resource group
│   │   │   ├── auth.py
│   │   │   ├── users.py
│   │   │   ├── audio_files.py
│   │   │   ├── datasets.py
│   │   │   ├── assignments.py
│   │   │   ├── segments.py
│   │   │   ├── review.py
│   │   │   ├── export.py
│   │   │   ├── events.py         # SSE endpoint
│   │   │   └── admin.py
│   │   └── services/
│   │       ├── upload.py         # JSON sidecar parsing + segment creation
│   │       ├── export.py         # JSON / CSV export logic
│   │       └── trust_score.py    # Rolling 200-segment trust score
│   ├── alembic/
│   │   ├── env.py                # Strips +aiosqlite for sync URL, render_as_batch=True
│   │   └── versions/             # Migration history
│   ├── .env.example              # Template for local development
│   ├── .env.prod.example         # Template for production
│   ├── seed.py                   # Creates default admin account
│   ├── dbTools.py                # Dev tool: populate DB with test data
│   ├── entrypoint.sh             # Runs alembic upgrade head then starts uvicorn
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── public/
│   │   └── help-videos/          # Static help images and video recordings
│   │       ├── admin/            # Admin help media (01-dashboard.mp4, ...)
│   │       └── annotator/        # Annotator help media (01-my-tasks.mp4, ...)
│   ├── src/
│   │   ├── app/
│   │   │   ├── admin/            # Admin pages
│   │   │   ├── annotator/        # Annotator pages
│   │   │   ├── login/            # Login page
│   │   │   ├── api/[...path]/    # Next.js streaming proxy to backend
│   │   │   ├── layout.tsx        # Root layout (Providers, dark mode)
│   │   │   └── page.tsx          # Root redirect (by role)
│   │   ├── components/
│   │   │   ├── AuthGuard.tsx     # Role-based route protection
│   │   │   ├── NotificationBell.tsx
│   │   │   ├── Sidebar.tsx       # Role-aware navigation sidebar
│   │   │   └── WaveformPlayer.tsx
│   │   ├── context/
│   │   │   ├── auth.tsx          # AuthContext + AuthProvider
│   │   │   └── sse.tsx           # SSE context (real-time events)
│   │   └── lib/
│   │       ├── axios.ts          # Axios instance with JWT interceptor
│   │       ├── theme.ts          # Chakra v3 dark theme
│   │       └── toastWizard.ts    # Toast helper
│   ├── .env.example
│   ├── package.json
│   ├── Dockerfile                # Production multi-stage build
│   └── Dockerfile.dev            # Development (volume-mounted source)
├── docker-compose.yml            # Production Docker Compose
├── docker-compose.dev.yml        # Development Docker Compose (hot reload)
└── README.md
```

---

## 5. Environment Variables

### backend/.env — Local development

```
DATABASE_URL=sqlite+aiosqlite:///./audioannotator.db
SECRET_KEY=replace_with_output_of_openssl_rand_hex_32
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
UPLOAD_DIR=./uploads
ALLOWED_ORIGINS=http://localhost:3000
ENVIRONMENT=development
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

### backend/.env.prod — Production (EC2)

```
DATABASE_URL=sqlite+aiosqlite:////data/audioannotator.db
SECRET_KEY=replace_with_output_of_openssl_rand_hex_32
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
UPLOAD_DIR=/data/uploads
ALLOWED_ORIGINS=http://your-server-ip-or-domain:3000
ENVIRONMENT=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace_with_strong_password
```

Generate a secret key:

```bash
openssl rand -hex 32
```

### frontend/.env.local — Local development

```
BACKEND_URL=http://127.0.0.1:8000
```

`BACKEND_URL` is a server-side variable used by the Next.js proxy route. It is never exposed to the browser. In Docker, both Compose files automatically set it to `http://backend:8000` (Docker internal network).

---

## 6. Local Setup — No Docker

### Prerequisites

- Python 3.11+
- Node.js 18+ and npm
- Git

### Step 1 — Clone

```bash
git clone https://github.com/JunHammy/AudioAnnotator.git
cd AudioAnnotator
```

### Step 2 — Backend

```bash
# Create and activate virtual environment (from repo root)
python -m venv virt
source virt/Scripts/activate      # Windows Git Bash
# source virt/bin/activate         # macOS / Linux

cd backend
pip install -r requirements.txt

cp .env.example .env
# Edit .env: replace SECRET_KEY with output of: openssl rand -hex 32

alembic upgrade head              # apply migrations
python seed.py                    # create admin account
uvicorn app.main:app --reload     # start backend on port 8000
```

### Step 3 — Frontend

Open a new terminal:

```bash
source virt/Scripts/activate      # Windows Git Bash

cd frontend
cp .env.example .env.local
# .env.local must contain: BACKEND_URL=http://127.0.0.1:8000

npm install --legacy-peer-deps
npm run dev                       # start frontend on port 3000
```

Open `http://localhost:3000`. Log in with `admin` / `admin123`.

**Windows + Docker Desktop note:** Docker Desktop occupies port 8000 on IPv6. Always use `http://127.0.0.1:8000`, never `http://localhost:8000`, or the backend will not be reachable.

---

## 7. Local Setup — Docker

```bash
# First time — build images and start
docker compose -f docker-compose.dev.yml up --build

# Create the admin account (first time only)
docker compose -f docker-compose.dev.yml exec backend python seed.py

# Stop containers
docker compose -f docker-compose.dev.yml down

# Stop and wipe all data (DB + uploads)
docker compose -f docker-compose.dev.yml down -v
```

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- Swagger docs: `http://localhost:8000/docs`

Source code is volume-mounted — changes in `backend/` and `frontend/src/` reload automatically without rebuilding.

---

## 8. EC2 Production Deployment

### 8.1 — First-time server setup

SSH into the EC2 instance:

```bash
ssh -i your-key.pem ubuntu@<ec2-public-ip>
```

Install Docker and Docker Compose:

```bash
sudo apt update
sudo apt install -y docker.io
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose v2
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 8.2 — Clone the repository

```bash
git clone https://github.com/JunHammy/AudioAnnotator.git
cd AudioAnnotator
```

### 8.3 — Configure production environment

```bash
cp backend/.env.prod.example backend/.env.prod
nano backend/.env.prod
```

Set these values:

| Field | What to set |
|-------|-------------|
| `SECRET_KEY` | Output of `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | A strong password (minimum 12 characters) |
| `ALLOWED_ORIGINS` | The URL users will access, e.g. `http://54.x.x.x:3000` |

### 8.4 — Copy help media files

Help videos and images are binary files that may not be stored in git. Copy them from your local machine before building:

```bash
# Run this from your LOCAL machine
scp -i your-key.pem -r \
  frontend/public/help-videos/ \
  ubuntu@<ec2-public-ip>:~/AudioAnnotator/frontend/public/help-videos/
```

### 8.5 — Build and start

```bash
cd ~/AudioAnnotator

# Build images and start in the background
docker compose up --build -d

# Create the admin account (first time only)
docker compose exec backend python seed.py
```

The app is now running on `http://<ec2-public-ip>:3000`.

Ensure port **3000** is open in the EC2 Security Group (inbound TCP rule, source `0.0.0.0/0` or your IP range).

### 8.6 — Nginx + HTTPS (optional but recommended)

If you have a domain name, install Nginx and Certbot:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/audioannotator`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

Enable and obtain a certificate:

```bash
sudo ln -s /etc/nginx/sites-available/audioannotator /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
```

After HTTPS is active, update `ALLOWED_ORIGINS` in `backend/.env.prod` to the HTTPS domain, then restart:

```bash
docker compose down && docker compose up -d
```

---

## 9. EC2 Maintenance & Operations

### Deploying code updates

```bash
cd ~/AudioAnnotator
git pull

# Rebuild and restart all services
docker compose up --build -d

# Or rebuild one service only (faster)
docker compose build backend && docker compose up -d backend
docker compose build frontend && docker compose up -d frontend
```

The backend `entrypoint.sh` automatically runs `alembic upgrade head` on every container start, so database migrations are applied on deploy with no manual step.

### Viewing logs

```bash
# All services, follow
docker compose logs -f

# Backend only
docker compose logs -f backend

# Last 100 lines
docker compose logs --tail=100 backend
```

### Checking container status

```bash
docker compose ps
```

### Restarting without rebuilding

```bash
docker compose restart
docker compose restart backend    # backend only
```

### Full clean restart

```bash
docker compose down && docker compose up -d
```

---

## 10. Database Management

The production database is a SQLite file stored in the Docker volume `audioannotator_app_data` at `/data/audioannotator.db`. Uploaded audio files are at `/data/uploads/` in the same volume.

### Backup

```bash
# On the EC2 instance — exports volume to a compressed archive
docker run --rm \
  -v audioannotator_app_data:/data \
  -v $(pwd)/backup:/backup \
  alpine tar czf /backup/audioannotator_backup_$(date +%Y%m%d).tar.gz /data

ls backup/
```

Download to your local machine:

```bash
# Run from your LOCAL machine
scp -i your-key.pem \
  ubuntu@<ec2-ip>:~/AudioAnnotator/backup/audioannotator_backup_YYYYMMDD.tar.gz .
```

### Restore from backup

```bash
docker compose down

docker run --rm \
  -v audioannotator_app_data:/data \
  -v $(pwd)/backup:/backup \
  alpine sh -c "cd / && tar xzf /backup/audioannotator_backup_YYYYMMDD.tar.gz"

docker compose up -d
```

### Direct database access

```bash
docker compose exec backend sqlite3 /data/audioannotator.db

# Useful queries
.tables
SELECT id, filename, is_deleted FROM audio_files LIMIT 20;
SELECT username, role, trust_score FROM users;
.quit
```

### Full reset (wipes all data)

```bash
docker compose down -v
docker compose up -d
docker compose exec backend python seed.py
```

---

## 11. User & Account Management

### Create the admin account

```bash
docker compose exec backend python seed.py
```

Creates the account from `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env.prod`. Safe to run multiple times — skips if the account already exists.

### Create annotator accounts

Log in as admin -> **Manage Accounts** -> **Create Account**. Set username and password. Role defaults to `annotator`.

### Reset a password

Admin -> **Manage Accounts** -> **Reset PW** on the user row.

---

## 12. Annotation Conventions

### Speaker labels

| Label | Meaning |
|-------|---------|
| `speaker_0`, `speaker_1`, ... | Identified numbered speakers. Numbering starts at 0. |
| `speaker_unknown` | Speaker is audible but cannot be identified. |
| `speaker_group` | Multiple speakers talking simultaneously within the segment. |

Speaker labels are preserved exactly as in the source JSON on upload — they are not renumbered.

### Gender labels

`male`, `female`, `mixed`, `unk` (unknown). Applied per speaker lane, not per individual segment.

### Emotion labels

`Neutral`, `Happy`, `Sad`, `Angry`, `Surprised`, `Fear`, `Disgust`, `Other:<description>`. Multiple emotions can be selected per segment. The `is_ambiguous` flag marks segments where the emotion is unclear. A notes field is available on every segment.

### 3-tier emotion resolution (admin)

| Tier | Condition | Colour |
|------|-----------|--------|
| Tier 1 — Unanimous | All annotators agree | Green |
| Tier 2 — Confident | Weighted confidence >= 0.65 | Yellow |
| Tier 3 — Conflict | No consensus | Red — admin decides manually |

### Bracket words

Configured in Admin -> **Bracket Words**. When an annotator marks a transcription task complete, the system scans the transcription text and wraps matching filler words in square brackets (e.g. `[um]`, `[uh]`). A preview dialog is shown before applying.

---

## 13. Export Format

Exports are available from:
- **Datasets page** -> Export All (JSON or CSV) for the whole dataset.
- **Review page** -> Export on a specific file.

### JSON export structure

```json
{
  "file_id": 1,
  "filename": "my001005_9454.wav",
  "duration": 12.34,
  "language": "English",
  "num_speakers": 2,
  "segments": [
    {
      "speaker_label": "speaker_0",
      "gender": "male",
      "start_time": 0.0,
      "end_time": 3.5,
      "transcription": "Hello, how are you?",
      "emotion": ["Neutral"],
      "is_ambiguous": false,
      "notes": null
    }
  ]
}
```

---

## 14. API Reference

Base URL: `http://<host>:8000/api`

Interactive Swagger docs available at `http://<host>:8000/docs` when the backend is running.

| Endpoint | Description |
|----------|-------------|
| `POST /auth/login` | Obtain JWT token |
| `GET /auth/me` | Current user info |
| `GET/POST /users` | Account management (admin) |
| `PATCH /users/{id}` | Update account or reset password |
| `GET/POST /audio-files` | List files, upload file |
| `GET /audio-files/{id}` | File detail |
| `GET /audio-files/{id}/stream` | Stream audio |
| `PATCH /audio-files/{id}/lock` | Lock/unlock a track |
| `DELETE /audio-files/{id}` | Archive (soft delete) |
| `PATCH /audio-files/{id}/restore` | Restore archived file |
| `DELETE /audio-files/{id}/permanent` | Permanently delete file and audio |
| `GET/POST /datasets` | Dataset CRUD |
| `GET/POST /assignments` | Task assignments |
| `POST /assignments/batch` | Bulk assign |
| `PATCH /assignments/{id}/status` | Update task status |
| `GET/POST /segments/speaker` | Speaker segments |
| `PATCH /segments/speaker/{id}` | Update speaker label / gender / emotion / notes |
| `DELETE /segments/speaker/{id}` | Delete speaker segment |
| `DELETE /segments/speaker/by-label` | Delete all segments for a speaker label |
| `GET/POST /segments/transcription` | Transcription segments |
| `PATCH /segments/transcription/{id}` | Update transcription text or notes |
| `GET /segments/annotate/{file_id}` | Combined data for annotation view |
| `GET /review/files` | Files available for review |
| `GET /review/{file_id}/emotion` | Emotion results per file |
| `POST /review/{file_id}/emotion/decide` | Manual emotion decision (admin) |
| `GET /admin/bracket-words` | Get bracket word list |
| `PATCH /admin/bracket-words` | Update bracket word list |
| `GET /events` | SSE stream for real-time updates |

---

## 15. Troubleshooting

**Backend won't start — `bcrypt` import error**

The project requires `bcrypt==4.0.1`. Version 5.x breaks passlib 1.7.4.

```bash
pip install bcrypt==4.0.1
# Inside Docker: rebuild the image
docker compose build --no-cache backend
```

**Frontend shows "Backend unreachable" / 503**

- Confirm the backend container is running: `docker compose ps`
- Check backend logs: `docker compose logs backend`
- In production, `BACKEND_URL` must be `http://backend:8000` (Docker internal network name).

**Port 3000 not accessible on EC2**

Check the EC2 Security Group has an inbound rule for TCP port 3000, source `0.0.0.0/0` or your IP range.

**Alembic migration fails: "table already exists"**

The database was created before Alembic was set up. Reset:

```bash
docker compose down -v
docker compose up -d
docker compose exec backend python seed.py
```

**Docker port conflict on Windows (port 8000)**

Docker Desktop occupies port 8000 on IPv6. For local non-Docker development, always use `http://127.0.0.1:8000` and never `http://localhost:8000`.

**Help videos not showing on EC2**

Help media files may not be committed to git. Copy them manually then rebuild:

```bash
# From your LOCAL machine
scp -i your-key.pem -r \
  frontend/public/help-videos/ \
  ubuntu@<ec2-ip>:~/AudioAnnotator/frontend/public/help-videos/

# On EC2 — rebuild frontend to bake files into the image
docker compose build frontend && docker compose up -d frontend
```

**Real-time updates not working behind Nginx**

SSE requires long-lived connections with no buffering. Ensure the Nginx config includes:

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 86400s;
proxy_set_header Connection '';
proxy_http_version 1.1;
```

**Disk space growing — uploads directory too large**

```bash
# Check volume usage
docker compose exec backend du -sh /data/uploads/
```

Free space by permanently deleting archived files via Admin -> Manage Files -> Archived section -> Delete Permanently.

---

## Quick Command Reference

```bash
# ── EC2 / Production ──────────────────────────────────────────────────────────

# SSH in
ssh -i your-key.pem ubuntu@<ec2-ip>

# Pull latest code and redeploy
cd ~/AudioAnnotator && git pull && docker compose up --build -d

# View live logs
docker compose logs -f

# Restart backend only (no rebuild)
docker compose restart backend

# Open SQLite shell
docker compose exec backend sqlite3 /data/audioannotator.db

# Backup data volume
docker run --rm -v audioannotator_app_data:/data -v $(pwd)/backup:/backup \
  alpine tar czf /backup/backup_$(date +%Y%m%d).tar.gz /data


# ── Local Docker (development) ────────────────────────────────────────────────

# Start with hot reload
docker compose -f docker-compose.dev.yml up --build

# Seed admin account (first time only)
docker compose -f docker-compose.dev.yml exec backend python seed.py

# Wipe everything and start fresh
docker compose -f docker-compose.dev.yml down -v && \
  docker compose -f docker-compose.dev.yml up --build -d && \
  docker compose -f docker-compose.dev.yml exec backend python seed.py


# ── Local (no Docker) ─────────────────────────────────────────────────────────

source virt/Scripts/activate                  # activate venv (Windows Git Bash)
source virt/bin/activate                      # activate venv (macOS / Linux)
cd backend && uvicorn app.main:app --reload   # start backend
cd frontend && npm run dev                    # start frontend
alembic upgrade head                          # apply migrations
python seed.py                                # create admin account
```
