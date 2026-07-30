# CLAUDE.md

Emberflow is a self-hosted CI/CD platform: a Fastify + BullMQ + SQLite server
(`:4100`) runs `emberflow.yml` pipelines as a DAG of isolated Docker containers,
streams logs and status over a WebSocket to a Next.js "mission control"
dashboard (`:3100`), diagnoses failed runs with Groq, auto-deploys green builds
(sample app serves on `:8200`), and supports one-click rollback.

## Key commands

```bash
# server — API + queue worker on :4100
cd server && npm start            # npm run dev for --watch

# dashboard — http://localhost:3100
cd dashboard && npm run dev

# demo helper — checks docker + redis, prints trigger/curl commands
./scripts/demo.sh

# e2e trigger (from repo root)
curl -X POST http://localhost:4100/api/runs \
  -H 'content-type: application/json' \
  -d '{"localPath": "'"$PWD"'/sample-app"}'
```

## Architecture

- **`docs/SPEC.md` is the BINDING contract** between server and dashboard
  (REST API, WS events, SQLite schema, folder conventions). If a change alters
  the contract, SPEC.md and both sides (server *and* dashboard) must change in
  the same PR.
- **Server** (`server/src/`, plain JS ESM): `config/` (only place that reads
  `process.env`), `core/` (db, ws, queue, docker helpers), and feature modules
  under `modules/`: `runs`, `pipeline`, `webhook`, `analyst`, `deploy`.
  `index.js` is bootstrap-only — no feature logic in entrypoints.
- **Dashboard** (`dashboard/src/`, TypeScript): `theme/` (theme.css — all
  design tokens), `components/ui/` (generic building blocks), `modules/`
  (runs, dag, logs, analyst, deploy), `lib/` (types, api client, WS hook,
  formatting), `app/` (routes only; pages compose module components).

## Hard conventions

- Env vars use the `EMBER_*` prefix (plus `GROQ_API_KEY` / `GROQ_MODEL` /
  `REDIS_URL`); pipeline files are named `emberflow.yml`; containers are named
  `ember-<runId>-<stageId>` (stages) and `ember-deploy-<repoName>` (deploys).
- **No hardcoded hex values in dashboard components** — every color/glow comes
  from a token in `dashboard/src/theme/theme.css`; add a token first.
- Server is plain JavaScript ESM (no TypeScript, no build step); dashboard is
  TypeScript. Child processes always go through `spawn` with argument arrays —
  never interpolate user input into shell strings.
- Conventional Commits with the scopes listed in CONTRIBUTING.md
  (`server`, `dashboard`, `pipeline`, `runs`, `webhook`, `analyst`, `deploy`,
  `sample-app`, `ci`, `compose`).
- **PRs target `develop`, never `main`** — `main` is release-only and tagged.

## Gotchas

- The Docker daemon **and** Redis (`:6379`) must be running or runs fail
  immediately; `./scripts/demo.sh` checks both. `EMBER_EXECUTOR=local` is the
  no-Docker dev fallback (no isolation).
- The Groq analyst needs `GROQ_API_KEY` in `server/.env` — without it, failed
  runs get a "analyst skipped: GROQ_API_KEY not set" system log line instead of
  a diagnosis (this is graceful, not a bug).
- Deployments bind-mount their run workdir from `/tmp/emberflow-runs/<runId>/repo`;
  only the last 20 run workdirs are retained, so rollback to an older
  deployment returns 409 once its workdir is pruned.
