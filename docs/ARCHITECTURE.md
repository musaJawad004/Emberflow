# Emberflow Architecture

This document explains how Emberflow is put together: the components, the life
of a run from trigger to deploy, what each module owns, and the data model.
The normative server ↔ dashboard contract (exact API shapes, WS payloads,
schema DDL) lives in [SPEC.md](SPEC.md); this document is the guided tour.

## Components

| Component  | Tech                                            | Port |
| ---------- | ----------------------------------------------- | ---- |
| server     | Node.js + Fastify 5, BullMQ (Redis), SQLite     | 4100 |
| dashboard  | Next.js (App Router) + Tailwind + @xyflow/react | 3100 |
| sample-app | Guinea-pig app; when deployed it serves on      | 8200 |

```
                       ┌────────────────────────────────────────────┐
                       │                 server :4100               │
 dashboard :3100       │                                            │
 ┌──────────────┐ REST │  ┌─────────┐   ┌────────┐   ┌───────────┐  │
 │ Next.js app  │─────▶│  │ Fastify │──▶│ BullMQ │──▶│  runner   │  │
 │  runs / dag  │  WS  │  │ routes  │   │ queue  │   │ (worker)  │  │
 │ logs / deploy│◀─────│  └─────────┘   └───┬────┘   └─────┬─────┘  │
 └──────────────┘      │        │           │              │        │
        ▲              │        ▼        ┌──▼───┐          ▼        │
        │              │   ┌────────┐    │Redis │   docker run per  │
   GitHub push ───────▶│   │ SQLite │    └──────┘   stage (ember-*) │
   (HMAC webhook)      │   └────────┘                      │        │
                       │        ▲          ┌───────────────┼─────┐  │
                       │        └──────────┤ analyst (Groq)│     │  │
                       │                   │ deploy/rollback     │  │
                       │                   └─────────────────────┘  │
                       └────────────────────────────────────────────┘
```

Design principles (enforced by the folder conventions in SPEC.md):

- **Modular layout** — each feature is a self-contained module under
  `modules/`; shared plumbing lives in `core/`; entrypoints only wire things
  together.
- **Single config source** — only `server/src/config/index.js` reads
  `process.env` (and loads `server/.env`). Everything else imports `config`.
- **Everything observable** — every state transition is both persisted to
  SQLite and broadcast over WebSocket, so the dashboard can render live state
  and reconstruct it after a refresh from REST alone.

## Life of a run

### 1. Trigger

All trigger paths — local path, git URL, and GitHub webhook — converge on the
same "create run" service:

- **Dashboard / REST** — `POST /api/runs` with `{ localPath }` (a directory on
  the server machine containing `emberflow.yml`) or `{ gitUrl, ref? }`.
- **GitHub webhook** — `POST /webhook/github`. The webhook module verifies the
  `x-hub-signature-256` HMAC against `EMBER_WEBHOOK_SECRET` (401 on mismatch;
  accepted-with-warning when no secret is configured, for dev), ignores
  non-push events, and extracts `clone_url`, the pushed sha (`after`), and
  `ref`.

Input is validated (existing directory / `^(https://|git@)` URL), a `runs` row
is inserted with status `queued`, and a BullMQ job is enqueued. The API
answers `202 { runId }` immediately — execution is fully asynchronous.

### 2. Queue → worker

`core/queue.js` wires the BullMQ queue and worker (currently in the same
process as the API — see
[issues/007](issues/007-split-api-server-and-queue-worker.md)). The worker
picks up the job and hands it to the pipeline runner.

### 3. Workdir preparation

The runner materializes the code at `/tmp/emberflow-runs/<runId>/repo`:

- `localPath` trigger → copy the directory (excluding `node_modules`, `.git`,
  `dist`).
- `gitUrl` / webhook trigger → `git clone`, then checkout of the requested
  `ref`/commit sha.

Workdirs are retained for the **last 20 runs** (rollback restarts a container
from a retained workdir) and pruned beyond that.

### 4. Parse + plan the DAG

The pipeline module parses `emberflow.yml` (yaml + validation: unique stage
ids, known `needs`, required fields) and topo-sorts the stages. A `stages` row
is inserted per stage. The DAG planner repeatedly answers "which stages have
all their needs satisfied?" — those run **in parallel**. When a stage fails,
skip-propagation marks all transitive dependents `skipped` and the run
`failed`.

### 5. Execute stages in Docker

Each ready stage runs as:

```
docker run --rm --name ember-<runId>-<stageId> \
  -v /tmp/emberflow-runs/<runId>/repo:/app -w /app \
  <image> sh -c "<run>"
```

Key properties:

- Containers are **named**, so cancel/timeout can `docker rm -f` them —
  killing the docker CLI process alone would leave the container running.
- All processes are spawned with argument arrays; user input never reaches a
  shell string.
- Stage stdout/stderr is line-buffered and capped at 5000 lines per stage
  (then one system line notes the truncation).
- Per-stage timeout: 10 min (SIGTERM → SIGKILL + container removal). Per-run
  timeout: 30 min. `EMBER_EXECUTOR=local` swaps `docker run` for a plain
  `sh -c` in the workdir (dev fallback, no isolation).

### 6. Persist + broadcast

Every log line and status transition is written to SQLite **and** broadcast to
all WebSocket clients (`log`, `stage:update`, `run:update` events). The
dashboard fetches history over REST on load and splices live WS lines on top.

### 7. Finish: analyst or deploy

- **Run failed** (not canceled) → the **analyst** module collects, per failed
  stage: stage id, command, exit code, and the last 80 log lines; sends them
  to Groq chat completions (plain `fetch`, no SDK; temperature 0.2) with a
  "senior CI engineer" prompt; stores the diagnosis in `analyses` and
  broadcasts an `analysis` event. No `GROQ_API_KEY` → a system log line notes
  the skip and nothing crashes.
- **Run passed and `emberflow.yml` has `deploy`** → the **deploy** module
  stops the previous deployment for the same repo (marked `stopped`), then
  starts `docker run -d --name ember-deploy-<repoName> -p <hostPort>:<port>`
  from the run's workdir. After 2 s it verifies the container is still alive
  (a known-weak health check — see
  [issues/009](issues/009-real-http-health-probe-for-deployments.md)) and
  records the deployment `running` or `failed`. A `deployment:update` event
  goes out either way.
- **Rollback** — `POST /api/deployments/:id/rollback` targets a `stopped`
  deployment whose workdir still exists: current deployment is stopped, the
  target's container is restarted from its retained workdir, and a new row is
  written with `rolled_back_from` set. If the workdir was pruned, the API
  answers 409 (see
  [issues/006](issues/006-rollback-fails-when-workdir-pruned.md)).

### Cancellation

`POST /api/runs/:id/cancel` is valid while the run is queued or running: the
run is marked `canceled`, all `ember-<runId>-*` containers are force-removed,
running stages become `canceled` and pending ones `skipped`, and updates are
broadcast. The runner polls run status between scheduling steps and stops
issuing new stages.

## Server module map — `server/src/`

| Path | Responsibility |
| --- | --- |
| `index.js` | Bootstrap **only**: registers CORS/WS/routes, starts the worker, listens, graceful shutdown (SIGINT/SIGTERM → close worker, queue, WS clients, HTTP, DB). |
| `config/index.js` | Loads `server/.env` (real env wins), parses every env var with defaults, exposes constants (timeouts, log cap, workdir retention). The only file that touches `process.env`. |
| `core/db.js` | better-sqlite3 init, schema creation + in-place migration, small typed query helpers (`getRun`, `insertLog`, …). |
| `core/ws.js` | WebSocket client set, `broadcast()`, `hello` handshake, route registration. |
| `core/queue.js` | BullMQ queue + worker wiring against `REDIS_URL`. |
| `core/docker.js` | Shared docker helpers: spawn wrapper (`runCommand`), container-name sanitization, `ember-<runId>-<stageId>` / `ember-deploy-<repo>` naming, `docker rm -f` for one container or a whole run. |
| `modules/runs/` | `routes.js` — health, run CRUD-ish REST (list/detail/logs/analysis/cancel/create). `service.js` — trigger validation, run creation + enqueue, cancel logic. |
| `modules/pipeline/` | The pipeline-definition parser (`emberflow.yml` parse + validate), `dag.js` (topo-sort, depth, skip propagation), `runner.js` (orchestrates one run end-to-end), `executor.js` (docker\|local stage execution with line streaming + timeout). |
| `modules/webhook/` | `routes.js` (`POST /webhook/github`), `github.js` (HMAC verification, payload parsing), `git.js` (clone/checkout helpers). |
| `modules/analyst/` | `groq.js` (raw Groq chat-completions call via fetch), `service.js` (collect failed-stage logs → prompt → store + broadcast). |
| `modules/deploy/` | `routes.js` (list deployments, rollback), `service.js` (start/stop/rollback deploy containers, health verdict). |

## Dashboard module map — `dashboard/src/`

| Path | Responsibility |
| --- | --- |
| `app/` | Routes only: `/` (run list), `/runs/[id]` (DAG + logs + diagnosis + deploy strip), `/deployments`, shared `layout.tsx` with the Runs · Deployments nav. Pages compose module components; no feature logic here. |
| `theme/theme.css` | **Every** design token — surfaces, status palette (queued/running/passed/failed/skipped/canceled/stopped), ember accent, glows, keyframes. Components never hardcode hex values. |
| `components/ui/` | Generic building blocks: `Panel`, `StatusPill`, `Button`, `Spinner`, `OfflineBanner`, `NavLink`. |
| `modules/runs/` | `RunList`, `RunRow`, `RunDetail` (per-run state assembly: REST history + WS splicing), `TriggerMenu` (sample-app preset or custom git URL/local path), `CancelButton`. |
| `modules/dag/` | `StageDag` + `StageNode` — the animated pipeline graph (@xyflow/react), status-colored, laid out by DAG depth. |
| `modules/logs/` | `LogTerminal` — ANSI-aware (anser → styled spans, no `dangerouslySetInnerHTML`), stream-tinted, auto-follows while pinned to bottom. |
| `modules/analyst/` | `DiagnosisCard` — shows the Groq diagnosis (live WS or REST with short retries), or a subtle "analyst skipped" note. |
| `modules/deploy/` | `DeploymentList`, `RollbackButton`, `DeployStrip` (run page banner linking to `/deployments`). |
| `lib/` | `types.ts` (mirrors the API/WS contract), `api.ts` (REST client, API/WS base URLs), the shared WebSocket hook (auto-reconnect with backoff, per-event callback), `format.ts` (durations, clocks). |

## Data model

Five tables in one SQLite database (default `server/data/emberflow.db`).
`core/db.js` migrates older databases in place (ALTER/CREATE-IF-MISSING).

| Table | One row per | Notable columns |
| --- | --- | --- |
| `runs` | pipeline run | `trigger` (`manual`\|`webhook`), `repo_name`, `repo_url`, `commit_sha`, `status` (`queued`\|`running`\|`passed`\|`failed`\|`canceled`), created/started/finished timestamps |
| `stages` | stage within a run | `stage_id` (from the yml), `needs` (JSON), `command`, `image`, `status` (adds `pending`/`skipped`), `exit_code`, timings |
| `logs` | log line | `stage_pk` → stages, `ts` (ms), `stream` (`stdout`\|`stderr`\|`system`), `line`. Append-only and currently unpruned — see [issues/010](issues/010-logs-table-unbounded-growth.md) |
| `analyses` | Groq diagnosis | `run_id`, `model`, `diagnosis` text |
| `deployments` | deploy attempt | `run_id`, `repo_name`, `container_name`, ports, `status` (`running`\|`stopped`\|`failed`), `rolled_back_from` (deployment id it was restored from) |

Relationships: `runs 1—N stages 1—N logs`; `runs 1—0..1 analyses`;
`runs 1—0..N deployments` (a run can be re-deployed via rollback rows).

## WebSocket contract (summary)

One endpoint, JSON messages, fan-out to all clients:

- `hello` — handshake on connect
- `run:update` / `stage:update` — full updated row
- `log` — `{ runId, stageId, ts, stream, line }`
- `analysis` — the stored diagnosis row
- `deployment:update` — full deployment row

The dashboard treats WS as an accelerator, not a source of truth: pages load
consistent state from REST and apply WS deltas on top, so a refresh (or a
missed event) never corrupts what you see.
