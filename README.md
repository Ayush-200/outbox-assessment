# ReachInbox — Full-stack Email Job Scheduler

A production-style slice of a cold-email platform: accept email batches over an API, run them
through **BullMQ delayed jobs** (no cron anywhere), deliver them over **Ethereal SMTP** with
pacing and hourly rate limits, and manage it all from a React dashboard.

| Layer | Choice |
|-------|--------|
| Backend | TypeScript, Express 5, BullMQ + Redis, PostgreSQL, Elasticsearch, nodemailer (Ethereal), bull-board |
| Frontend | React 19 + Vite, TypeScript, Tailwind CSS v4 |
| Infra | `docker-compose` → Redis, PostgreSQL, Elasticsearch |

```
backend/    Express API + BullMQ worker (one process, split into modules)
frontend/   React dashboard (Vite)
docker-compose.yml
```

---

## 1. Run it

### Prerequisites
Node 20+ and Docker (with the Compose plugin).

### 1. Infrastructure

```bash
docker compose up -d      # redis :6379, postgres :5432, elasticsearch :9200
```

### 2. Backend

```bash
cd backend
cp .env.example .env      # fill in the values described in section 2
npm install
npm run dev               # API + worker → http://localhost:3001
```

The same process hosts:

- the REST API (`/api/...`)
- the BullMQ worker (concurrency, limiter, rate limiting)
- the **live queue dashboard** → http://localhost:3001/admin/queues

### 3. Frontend

```bash
cd frontend
cp .env.example .env      # VITE_API_URL + VITE_GOOGLE_CLIENT_ID
npm install
npm run dev               # → http://localhost:5173
```

---

## 2. Environment variables

`backend/.env`

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | API port | `3001` |
| `FRONTEND_URL` | CORS origin + OAuth redirect target | `http://localhost:5173` |
| `DATABASE_URL` | Postgres connection string | `postgresql://postgres:postgres@localhost:5432/scheduler` |
| `REDIS_URL` | Redis for BullMQ + counters | `redis://localhost:6379` |
| `ELASTICSEARCH_URL` | Search node | `http://localhost:9200` |
| `GOOGLE_CLIENT_ID` | Google OAuth client (verifies ID tokens) | — |
| `JWT_SECRET` | Signs session + OAuth state tokens | `change-me` |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_REDIRECT_URI` | Slack OAuth app | — |
| `WORKER_CONCURRENCY` | Jobs processed in parallel by the worker | `5` |
| `DELAY_BETWEEN_SENDS_MS` | Minimum gap between two sends (global) | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Default hourly cap per sender | `200` |
| `MAX_SEND_ATTEMPTS` | Retry budget per email job | `100` |

`frontend/.env`

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Backend origin, e.g. `http://localhost:3001` |
| `VITE_GOOGLE_CLIENT_ID` | Same Google client ID as the backend |

### Google OAuth (real, not mocked)
1. <https://console.cloud.google.com/apis/credentials> → **Create credentials → OAuth client ID (Web)**.
2. Authorized JavaScript origin: `http://localhost:5173`.
3. Paste the client ID into **both** `.env` files.

### Slack app (real OAuth, live message)
1. <https://api.slack.com/apps> → Create New App → **From scratch**.
2. OAuth & Permissions → Bot Token Scopes: `chat:write`, `incoming_webhook`.
3. Redirect URL: `http://localhost:3001/api/slack/callback`.
4. Copy Client ID / Client Secret into `backend/.env`.
5. Dashboard → **Connect Slack** → pick a channel. When a sender hits its hourly limit,
   a message is posted to that channel's incoming webhook (once per sender per hour).

### Ethereal Email (fake SMTP)
No account needed: on first use of a sender address the backend calls
`nodemailer.createTestAccount()`, which provisions an Ethereal SMTP account and stores the
credentials in the `senders` table (one account per sender → "multiple senders"). Mail is
accepted by `smtp.ethereal.email` and never delivered anywhere; open <https://ethereal.email>
and log in with the `smtp_user`/`smtp_pass` from the `senders` row to read it.

---

## 3. Architecture

### Scheduling
```
POST /api/emails/schedule
  → validate + get-or-create sender (Ethereal account lazily created)
  → single INSERT INTO emails ... ON CONFLICT (batch_id, recipient) DO NOTHING
  → queue.addBulk(jobs)   jobId = "email:<id>", delay = scheduledAt - now
  → bulk index the new rows into Elasticsearch
```
Each recipient is **one delayed job** whose payload only carries `emailId`; the worker reads
the row from Postgres. Per-batch spacing (`delaySeconds`) is baked into each job's delay:
`startTime + index × delay`.

### Worker pipeline (per job)
```
load row ─ already sent/other state? → stop (idempotent)
   ↓
claim row: UPDATE ... SET status='sending' WHERE status='scheduled'
   ↓ rowCount = 0 → another worker owns it → stop
   ↓
Redis hourly slot for this sender  ── over limit? → Slack notify + throw HourlyLimitError
   ↓
send via Ethereal → status = 'sent' (+ re-index in ES)
   on error → status back to 'scheduled' + error text → BullMQ retry
```

Statuses: `scheduled → sending → sent | failed` (a job that exhausts its attempts is marked
`failed`; a job interrupted by a crash mid-send is surfaced as `failed / interrupted while
sending` rather than silently stuck).

### Persistence across restarts
- **Postgres is the source of truth** for every email; **Redis holds the delayed jobs**
  (docker volume), so restarting the server does not lose or reset the schedule — the worker
  simply picks the delayed jobs up at their original time.
- **No duplicate sends**: `jobId = email:<id>` makes re-adding a job a no-op, the
  `status='scheduled'` guard makes a second concurrent run a no-op, and the
  `(batch_id, recipient)` unique index makes a retried API call a no-op.
- No cron: scheduling is exclusively BullMQ delayed jobs.

### Concurrency, delay, rate limiting
| Requirement | Mechanism | Where configured |
|-------------|-----------|------------------|
| Worker concurrency | BullMQ `Worker({ concurrency })`, safe because the `scheduled → sending` claim is a single atomic UPDATE | `WORKER_CONCURRENCY` |
| Min delay between sends | BullMQ `limiter: { max: 1, duration: DELAY_BETWEEN_SENDS_MS }` — enforced in Redis, so it holds across multiple worker instances | `DELAY_BETWEEN_SENDS_MS` (default **2 s**) |
| Batch spacing | job delay = `startTime + i × delaySeconds` | Compose form "Delay" |
| Emails per hour | `INCR rate:{senderId}:{hourWindow}` in Redis with `EXPIRE`; the increment is rolled back when we don't send, so counts are exact and shared by every instance | `MAX_EMAILS_PER_HOUR_PER_SENDER`, per-sender override from the Compose form |

**When the hourly limit is hit** the job is *not* dropped: the worker sends a Slack
notification (only if that user connected Slack, at most once per sender per hour) and throws
`HourlyLimitError`. A custom backoff strategy computes *ms until the next hour window* and
BullMQ re-queues the job there, keeping the batch together instead of failing it.

Trade-off: this consumes from the job's retry budget (`MAX_SEND_ATTEMPTS`, default 100 ≈ 41
days of hourly retries) rather than using BullMQ's `queue.rateLimit()`, which pauses the
**whole queue** — wrong when several senders have independent limits.

### Behaviour under load (1000+ emails at ~the same time)
- One `INSERT` + one `addBulk` for the batch; no per-email round trips.
- The limiter drains jobs at `1 / DELAY_BETWEEN_SENDS_MS` regardless of how many are queued.
- Jobs beyond the sender's hourly cap are pushed into the next window; they share that
  window's timestamp, so they keep their relative order in the delayed set ("as much as
  possible") rather than being dropped or failed.
- Nothing is held in process memory, so a restart mid-burst loses nothing.

### Search (Elasticsearch)
Every row is bulk-indexed into the `emails` index when scheduled and re-indexed (upsert by id)
on each status change. `GET /api/emails/search?status=&q=` queries recipient/subject/body and
is what the dashboard's search box uses.

### Slack install flow
`GET /api/slack/install` → browser follows the real Slack authorize URL (signed `state`
carries the user id) → `GET /api/slack/callback` exchanges the code for a bot token +
incoming webhook and stores them per user → the dashboard redirects back with `?slack=connected`.
Notification lookups read the DB at hit time, so connecting/disconnecting Slack needs no redeploy.

### Google login
Google Identity Services button → ID token → verified server-side with `google-auth-library`
→ upsert user → 7-day JWT returned to the SPA, stored in `localStorage`, sent as a
`Bearer` header.

---

## 4. Features implemented

**Backend**
- [x] Schedule API backed by a relational DB (Postgres)
- [x] BullMQ delayed jobs, **no cron**
- [x] Multiple senders, each with its own Ethereal SMTP account
- [x] Elasticsearch indexing + search endpoint
- [x] Live BullMQ dashboard at `/admin/queues`
- [x] Restart-safe scheduling, idempotent (no duplicate sends)
- [x] Configurable worker concurrency + safe parallel claiming
- [x] Minimum delay between sends (BullMQ limiter, env-configurable)
- [x] Per-sender hourly rate limit with Redis counters (multi-instance safe)
- [x] Rate-limited jobs rescheduled into the next window — never dropped
- [x] Slack OAuth + live rate-limit notification (once per sender per hour)
- [x] Google OAuth verification + JWT auth middleware

**Frontend**
- [x] Real Google login → dashboard, header with name / email / avatar / logout
- [x] Tabs: Scheduled Emails, Sent Emails
- [x] Compose New Email: subject, body, CSV/TXT upload with detected-address count,
      start time, delay between emails, hourly limit, sender address
- [x] Scheduled table: email, subject, scheduled time, status
- [x] Sent table: email, subject, sent time, status (`sent` / `failed`)
- [x] Loading spinners, empty states, error banner, toasts
- [x] Search (Elasticsearch), 5 s auto-refresh, Slack connect, queue-dashboard link
- [x] Reusable components (`Button`, `Field`, `Modal`, `DataTable` columns, `StatusPill`),
      typed API layer, clean folder structure

---

## 5. Assumptions, shortcuts, trade-offs

1. **No Figma link** was included in `requirements.md`, so the UI follows the written
   spec (header, tabs, compose modal, two tables) with a clean custom design.
2. **Google and Slack credentials are yours to create** — they can't be committed, so the
   app starts without them (login/Slack button show a clear error until set).
3. **Frontend polling (5 s) instead of websockets** — simplest thing that makes the
   dashboard feel live; the queue dashboard is already real-time.
4. **A "failed" email is shown in the Sent tab** so failures are visible; only rows with a
   `sent_at` are counted as delivered.
5. **Rate-limited retries consume the attempt budget** (see trade-off above) instead of
   pausing the shared queue.
6. **Worker runs in-process with the API** (`startWorker()` in `src/index.ts`) — one command
   for the demo; it is a separate module, so splitting it into its own deployment is a
   one-line change.
7. **Demo video, private repo, and collaborator access** are the remaining submission steps:
   record the walkthrough (schedule → dashboard → restart → rate limit) and share the repo
   with `Mitrajit` and `Yadav036`.

## 6. API summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/google` | — | Verify Google ID token, issue JWT |
| GET | `/api/senders` | JWT | List the user's senders |
| POST | `/api/emails/schedule` | JWT | Schedule a batch |
| GET | `/api/emails?status=scheduled\|sent` | JWT | List (Postgres) |
| GET | `/api/emails/search?status=&q=` | JWT | Search (Elasticsearch) |
| GET | `/api/slack/status` | JWT | Connected? |
| GET | `/api/slack/install` | JWT | Slack authorize URL |
| GET | `/api/slack/callback` | — | OAuth code exchange |
| GET | `/admin/queues` | — | Live BullMQ dashboard |
