# Emberflow Server

Fastify HTTP/WS API + BullMQ worker + pipeline runner, in one Node.js process.
Plain JavaScript, ESM, no build step.

## Run

```bash
npm install
cp .env.example .env   # optional — defaults work for local dev
npm start              # API + worker on :4100
```

| Script | What it does |
| --- | --- |
| `npm start` | `node src/index.js` |
| `npm run dev` | `node --watch src/index.js` (restarts on change) |

Requires Redis (default `redis://127.0.0.1:6379`) and, with the default
executor, a running Docker daemon.

## Module map

```
src/
  index.js          bootstrap ONLY: config → db → queue → http; graceful shutdown
  config/index.js   loads .env, parses ALL env vars with defaults, exposes
                    constants (timeouts, log cap, workdir retention).
                    The only file that reads process.env.
  core/
    db.js           better-sqlite3 init + in-place schema migration + query helpers
    ws.js           WebSocket client set + broadcast()
    queue.js        BullMQ queue + worker wiring
    docker.js       spawn wrapper, container naming (ember-<runId>-<stageId>,
                    ember-deploy-<repo>), docker rm -f helpers
  modules/
    runs/           routes.js (REST: health, create/list/get/logs/analysis/cancel)
                    service.js (trigger validation, create + enqueue, cancel)
    pipeline/       emberflow.yml parser (parse + validate), dag.js (topo-sort,
                    depth, skip propagation), runner.js (orchestrates one run),
                    executor.js (docker|local stage execution, line streaming,
                    per-stage timeout)
    webhook/        routes.js (POST /webhook/github), github.js (HMAC verify,
                    payload parsing), git.js (clone/checkout)
    analyst/        groq.js (raw Groq chat call via fetch), service.js (collect
                    failed logs → prompt → store + broadcast diagnosis)
    deploy/         routes.js (list, rollback), service.js (start/stop/rollback
                    deploy containers)
```

Conventions (from [docs/SPEC.md](../docs/SPEC.md)):

- No feature logic in `index.js` — it only wires modules together.
- Only `config/` touches `process.env`.
- Every child process uses `spawn` with an argument array; user input is never
  interpolated into a shell string.
- Every state change is written to SQLite **and** broadcast over WS.

## Environment

Full reference with examples: [docs/CONFIGURATION.md](../docs/CONFIGURATION.md).

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMBER_PORT` | `4100` | HTTP/WS listen port |
| `EMBER_DB` | `data/emberflow.db` | SQLite database path |
| `REDIS_URL` | `redis://127.0.0.1:6379` | BullMQ backing store |
| `EMBER_EXECUTOR` | `docker` | `docker` or `local` (dev fallback, no isolation) |
| `EMBER_WEBHOOK_SECRET` | *(unset)* | GitHub webhook HMAC secret (unset = dev mode) |
| `GROQ_API_KEY` | *(unset)* | Enables the failure analyst |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Analyst model |

Run workdirs live at `/tmp/emberflow-runs/<runId>/repo`; the last 20 are kept
for rollback, older ones are pruned.

## Docker

`server/Dockerfile` packages the server on `node:20-alpine` with the docker
CLI and git. It is meant to be run via the root `docker-compose.yml`, which
mounts the host Docker socket and bind-mounts `/tmp/emberflow-runs` 1:1 — see
the [compose caveat](../docs/CONFIGURATION.md#running-under-docker-compose)
for why that mount must match exactly.
