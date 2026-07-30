# Emberflow — Design Spec (v1)

Emberflow is a self-hosted CI/CD platform: push code (or trigger manually), and Emberflow runs a
pipeline of stages in isolated Docker containers, streams logs live over WebSockets,
diagnoses failures with an LLM (Groq), deploys green builds, and can roll back — all
visible on a mission-control dashboard.

This document is the binding contract between the server and the dashboard.
v1 = v0 + folder-structure conventions + Day 2–5 features (webhooks, cancel, Groq
failure analyst, deploy/rollback, hardening).

## Components & ports

| Component  | Tech                                            | Port |
|------------|-------------------------------------------------|------|
| server     | Node.js + Fastify 5, BullMQ (Redis), SQLite     | 4100 |
| dashboard  | Next.js (App Router) + Tailwind + @xyflow/react | 3100 |
| sample-app | Guinea pig app; when deployed it serves on      | 8200 |

## Folder structure (mandatory conventions)

Modular layout — features live in self-contained modules, shared plumbing in core.
No feature logic in entrypoints; entrypoints only wire modules together.

```
server/src/
  index.js                 # bootstrap ONLY: config → db → queue → http, graceful shutdown
  config/index.js          # all env parsing with defaults; nothing else reads process.env
  core/
    db.js                  # sqlite init + schema migration + tiny query helpers
    ws.js                  # WS client set + broadcast()
    queue.js               # BullMQ queue + worker wiring
    docker.js              # shared docker helpers (spawn wrapper, container naming, rm -f)
  modules/
    runs/                  # routes.js (REST), service.js (create/list/cancel logic)
    pipeline/              # emberfile.js (parse+validate emberflow.yml), dag.js (toposort,
                           #   depth, skip propagation), runner.js (orchestrates a run),
                           #   executor.js (docker|local stage execution)
    webhook/               # routes.js (POST /webhook/github), github.js (HMAC verify,
                           #   payload parsing), git.js (clone/checkout helpers)
    analyst/               # groq.js (raw Groq chat call), service.js (collect failed
                           #   logs → prompt → store + broadcast diagnosis)
    deploy/                # routes.js, service.js (start/stop/rollback containers)

dashboard/src/
  app/                     # routes only; pages compose module components
    page.tsx  runs/[id]/page.tsx  deployments/page.tsx  layout.tsx
  theme/                   # theme.css (all design tokens: colors, glow, status palette,
                           #   keyframes) — NO hardcoded hex values inside components
  components/ui/           # generic: StatusPill, Panel, Button, OfflineBanner, Spinner
  modules/
    runs/                  # RunList, RunRow, TriggerMenu, CancelButton
    dag/                   # StageDag + custom node
    logs/                  # LogTerminal
    analyst/               # DiagnosisCard
    deploy/                # DeploymentList, RollbackButton
  lib/                     # types.ts, api.ts, useEmberSocket.ts, format.ts
```

## Pipeline definition — `emberflow.yml`

```yaml
name: sample-app
image: node:20-alpine        # default docker image for all stages
stages:
  - id: install
    run: npm install
  - id: lint
    needs: [install]
    run: npm run lint
  - id: test
    needs: [install]
    run: npm test
  - id: build
    needs: [lint, test]
    run: npm run build
deploy:                      # OPTIONAL — Day 4
  needs: [build]             # deploy fires only if these (and the whole run) passed
  start: node src/server.js  # command run inside the container
  port: 8080                 # container port
  hostPort: 8200             # host port to publish
  healthPath: /health        # optional — HTTP probe target, default "/"
```

Rules (unchanged from v0): unique stage `id`s; `needs` default `[]`; stages whose needs
are satisfied run in parallel; failure marks transitive dependents `skipped`, run
`failed`; a stage may override `image`.

## Execution model

1. Trigger (manual API / GitHub webhook) enqueues a BullMQ job.
2. Worker prepares the workdir at `/tmp/emberflow-runs/<runId>/repo`:
   - `localPath` trigger → copy (exclude node_modules/.git/dist)
   - `gitUrl` trigger / webhook → `git clone`, checkout `ref`/commit sha
3. Parse + validate emberflow.yml, topo-sort, execute DAG via docker CLI (spawn):
   `docker run --rm --name ember-<runId>-<stageId> -v <workdir>:/app -w /app <image> sh -c "<run>"`
   Containers are NAMED so cancel can `docker rm -f` them. `EMBER_EXECUTOR=local`
   remains the dev fallback.
4. Log lines + status transitions → SQLite + WS broadcast (as v0).
   If the run dies before stage rows exist (clone failure, missing or invalid
   emberflow.yml), the runner creates a single synthetic stage with
   `stage_id: "pipeline"`, marks it `failed`, and attaches the error as a
   system log line — so config errors are visible on the run page, not only
   in the server console.
5. Run finishes:
   - **failed** → analyst module fires (see below).
   - **passed + emberflow.yml has `deploy`** → deploy module fires (see below).
6. Workdir retention: keep the last 20 run workdirs (needed for rollback); prune older.

## Cancel (Day 2)

`POST /api/runs/:id/cancel` — valid while queued/running. Marks run `canceled`,
kills the BullMQ job's containers (`docker rm -f ember-<runId>-*`), marks
running/pending stages `canceled`/`skipped`, broadcasts updates. New run/stage status
value: `canceled` (dashboard: grey-orange pill).

## GitHub webhook (Day 2)

`POST /webhook/github` — GitHub push-event receiver.
- Verifies `x-hub-signature-256` HMAC with `EMBER_WEBHOOK_SECRET` (reject 401 if bad;
  if no secret configured, accept with a server-side warning log — dev mode).
- Uses `repository.clone_url`, `after` (sha), `ref`; ignores non-push events (200, ignored).
- Creates a run with trigger `webhook`, then same flow as manual git runs.
- Docs must note: local machines need a tunnel for real GitHub; testable with curl.

## Groq failure analyst (Day 3)

When a run reaches `failed` (not canceled):
- Collect per failed stage: stage id, command, exit code, last 80 log lines.
- Call Groq chat completions (`https://api.groq.com/openai/v1/chat/completions`,
  plain fetch, no SDK) — `GROQ_MODEL` env, default `llama-3.3-70b-versatile`,
  `GROQ_API_KEY` env. Prompt: senior CI engineer, diagnose the failure in 2–4 sentences,
  then a "Likely fix:" line. Temperature 0.2, max ~500 tokens.
- Store in `analyses` table, broadcast `analysis` WS event.
- No `GROQ_API_KEY` → skip gracefully: system log line on the run
  ("analyst skipped: GROQ_API_KEY not set"), no crash. API/network errors likewise.

## Deploy + rollback (Day 4)

On a passed run whose emberflow.yml has `deploy` (and all `deploy.needs` passed):
- Stop the previous deployment for the same repo_name (docker rm -f, mark `stopped`).
- `docker run -d --name ember-deploy-<repoName> -p <hostPort>:<port>
  -v <runWorkdir>:/app -w /app <image> sh -c "<start>"`
- Probe `http://127.0.0.1:<hostPort><healthPath>` (default `/`) with retries
  (15 attempts, 2s apart, per-attempt 2s timeout; any HTTP status < 400 =
  healthy; fast-fail if the container exits between attempts) → deployment
  `running`, else `failed` (probe progress and container logs land in the
  run's system logs).
- `POST /api/deployments/:id/rollback` — target must be a `stopped` deployment whose
  workdir still exists; stops the current one, restarts the target's container from its
  workdir, new row with status `running` + `rolled_back_from` set. 409 if workdir pruned.

## SQLite schema (v1 — additions marked ★)

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY, repo_name TEXT NOT NULL, repo_path TEXT NOT NULL,
  repo_url TEXT,                -- ★ git URL when cloned
  trigger TEXT NOT NULL,        -- 'manual' | 'webhook'
  commit_sha TEXT,
  status TEXT NOT NULL,         -- queued|running|passed|failed|canceled ★
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);
CREATE TABLE stages (           -- unchanged; status gains 'canceled' ★
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
  stage_id TEXT NOT NULL, needs TEXT NOT NULL, command TEXT NOT NULL,
  image TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER,
  started_at INTEGER, finished_at INTEGER
);
CREATE TABLE logs (             -- unchanged
  id INTEGER PRIMARY KEY AUTOINCREMENT, stage_pk TEXT NOT NULL REFERENCES stages(id),
  ts INTEGER NOT NULL, stream TEXT NOT NULL, line TEXT NOT NULL
);
CREATE TABLE analyses (         -- ★ Day 3
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
  model TEXT NOT NULL, diagnosis TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE deployments (      -- ★ Day 4
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
  repo_name TEXT NOT NULL, container_name TEXT NOT NULL,
  image TEXT NOT NULL, start_cmd TEXT NOT NULL,
  port INTEGER NOT NULL, host_port INTEGER NOT NULL,
  health_path TEXT NOT NULL DEFAULT '/',  -- ★ HTTP probe target
  status TEXT NOT NULL,         -- running|stopped|failed
  rolled_back_from TEXT,        -- deployment id this was restored from
  created_at INTEGER NOT NULL, stopped_at INTEGER
);
```

Migration: `core/db.js` must ALTER/CREATE-IF-MISSING so an existing v0 emberflow.db upgrades
in place without data loss.

## REST API (v1)

Unchanged from v0: `GET /api/health`, `GET /api/runs`, `GET /api/runs/:id`,
`GET /api/runs/:id/logs?stage=`.

- `POST /api/runs` body `{ localPath }` **or** `{ gitUrl, ref? }` → `202 { runId }`
- `POST /api/runs/:id/cancel` → `200 { ok: true }` | 409 if already finished
- `GET  /api/runs/:id/analysis` → `{ analysis: Analysis | null }`
- `POST /webhook/github` → `202 { runId }` | `200 { ignored: true }` | 401
- `GET  /api/deployments` → `{ deployments: Deployment[] }` newest first
- `POST /api/deployments/:id/rollback` → `202 { deploymentId }` | 409

## WebSocket events (v1)

v0 events unchanged (`hello`, `run:update`, `stage:update`, `log`). New:

```jsonc
{ "type": "analysis",          "runId": "...", "analysis": { /* analyses row */ } }
{ "type": "deployment:update", "deployment": { /* deployments row */ } }
```

## Dashboard (v1)

- `/` run list (as v0) + trigger button becomes a small menu: "sample-app" or
  "custom…" (input for git URL or local path). Canceled pill style.
- `/runs/[id]` (as v0) plus:
  - **Cancel button** (visible while queued/running).
  - **DiagnosisCard** below the DAG when the run failed: shows the Groq diagnosis
    (arrives live via `analysis` WS event, or REST on load); shows a subtle
    "analyst skipped — no GROQ_API_KEY" note if the run failed, no analysis exists
    after finish, and the system log line says skipped.
  - Deploy result strip when the run deployed (link to /deployments).
- `/deployments` — active deployment card (repo, port, uptime, link to
  http://localhost:<hostPort>) + history table with Rollback buttons on stopped rows.
  Live via `deployment:update`.
- Nav in header: Runs · Deployments. All colors/glows from `theme/theme.css` tokens.

## Hardening (Day 5)

- Per-stage timeout 10 min (SIGTERM→KILL + `docker rm -f`); per-run timeout 30 min.
- Log cap: 5000 lines per stage; then one system line "log limit reached, output
  truncated" and further lines dropped (process keeps running).
- All child processes via spawn with arg arrays — never shell-interpolate user input.
- `localPath` must be an existing directory containing emberflow.yml; `gitUrl` must match
  `^(https://|git@)`. Reject otherwise with 400.
- `server/.env` loaded at boot if present (tiny hand-rolled loader or dotenv);
  `server/.env.example` documents: EMBER_PORT, EMBER_DB, REDIS_URL, EMBER_EXECUTOR,
  EMBER_WEBHOOK_SECRET, GROQ_API_KEY, GROQ_MODEL.
- Graceful shutdown: SIGINT stops queue worker, closes WS + db.
- `scripts/demo.sh` at repo root: checks docker+redis, starts nothing itself, prints
  the 3 commands + curl one-liners to trigger a passing run, a failing run, and show
  the deployment.

## Environment

`EMBER_PORT` (4100) · `EMBER_DB` · `REDIS_URL` (redis://127.0.0.1:6379) ·
`EMBER_EXECUTOR` (docker|local) · `EMBER_WEBHOOK_SECRET` · `GROQ_API_KEY` ·
`GROQ_MODEL` (llama-3.3-70b-versatile)
