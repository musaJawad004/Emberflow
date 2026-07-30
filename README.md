# Emberflow

[![CI](https://github.com/musaJawad004/emberflow/actions/workflows/ci.yml/badge.svg)](https://github.com/musaJawad004/emberflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Emberflow is a self-hosted CI/CD platform with a live mission-control dashboard.
Push code (or hit "Trigger run"), and Emberflow executes a pipeline of stages —
defined in a simple `emberflow.yml` — as a DAG in isolated Docker containers,
streams every log line to the browser over WebSockets, animates the pipeline
graph in real time, diagnoses failures with an LLM (Groq), auto-deploys green
builds, and rolls back with one click.

## Features

- **`emberflow.yml` pipelines** — stages with `run` commands and `needs`
  dependencies; independent stages run in parallel, each in its own container.
- **Isolated Docker execution** — every stage gets a fresh, named container
  (`ember-<runId>-<stageId>`), so cancellation and timeouts can kill it cleanly.
- **Live everything** — logs, stage transitions, run status, analysis, and
  deployments stream over a single WebSocket to the dashboard.
- **Animated DAG dashboard** — Next.js app on `:3100` with a live pipeline
  graph, ANSI-aware log terminal, and a dark "mission control" theme.
- **Queue-backed** — runs are BullMQ jobs on Redis; state lives in SQLite.
- **GitHub webhook triggers** — push events with HMAC signature verification.
- **Run cancellation** — kill a queued or running pipeline (and its containers)
  from the API or the dashboard.
- **AI failure analysis** — failed runs get a plain-English diagnosis and a
  "Likely fix:" from Groq, pushed live to the run page. Optional; skipped
  gracefully without a `GROQ_API_KEY`.
- **Auto-deploy + rollback** — a green run with a `deploy` section ships the
  build into a published container (the sample app serves on `:8200`); the
  deployments page offers one-click rollback to any retained build.

## Architecture

```
Trigger (dashboard / REST API / GitHub webhook)
    │
    ▼
Fastify API (:4100) ──► SQLite (runs · stages · logs · analyses · deployments)
    │ enqueue
    ▼
BullMQ (Redis) ──► worker ──► workdir prep (/tmp/emberflow-runs/<runId>/repo)
                                 │ parse emberflow.yml → topo-sort DAG
                                 ▼
                       docker run per stage (named ember-*, parallel, cancellable)
                                 │
                    on failure ──┼── on green + deploy section
                         ▼       ▼
                 Groq analyst   deploy container (ember-deploy-<repo>) + rollback
                         │       │
                         ▼       ▼
    WebSocket ──► Next.js dashboard (:3100) — live DAG, logs, diagnosis, deployments
```

A deeper walkthrough lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quickstart

Prerequisites: **Node.js 20+**, **Docker** (daemon running), **Redis**.

### Option A — run locally

```bash
# 0. redis (skip if you already have one on :6379)
docker run -d -p 6379:6379 redis:7-alpine

# 1. server — API + queue worker on :4100
cd server && npm install && npm start

# 2. dashboard — new terminal, http://localhost:3100
cd dashboard && npm install && npm run dev

# 3. trigger a pipeline: click "Trigger run" on the dashboard, or:
curl -X POST http://localhost:4100/api/runs \
  -H 'content-type: application/json' \
  -d '{"localPath": "'"$PWD"'/sample-app"}'
```

`./scripts/demo.sh` checks prerequisites and prints ready-made commands for a
green run, a deliberately failing run (to see the AI analyst), and checking
the resulting deployment.

### Option B — Docker Compose

```bash
docker compose up --build
```

This starts Redis, the server (`:4100`), and the dashboard (`:3100`). The
server container drives the **host's** Docker daemon through the mounted
socket — see the caveat in
[docs/CONFIGURATION.md](docs/CONFIGURATION.md#running-under-docker-compose)
before triggering runs.

## Pipelines — `emberflow.yml`

Any folder (or git repository) with an `emberflow.yml` at its root can be built
by Emberflow:

```yaml
name: sample-app
image: node:20-alpine        # default docker image for all stages
stages:
  - id: install
    run: npm install
  - id: lint
    needs: [install]         # lint and test both need install…
    run: npm run lint
  - id: test
    needs: [install]         # …so they run in parallel once it passes
    run: npm test
  - id: build
    needs: [lint, test]
    run: npm run build
deploy:                      # optional — ship the build if the run is green
  needs: [build]
  start: node src/server.js  # command run inside the deploy container
  port: 8080                 # container port
  hostPort: 8200             # host port to publish
```

Rules: stage `id`s are unique; `needs` defaults to `[]`; a failing stage marks
its transitive dependents `skipped` and the run `failed`; a stage may override
`image`. The full contract (REST API, WebSocket events, schema) is in
[docs/SPEC.md](docs/SPEC.md).

## Screenshots

<!-- screenshot: dashboard run list with live status pills (docs/img/runs.png) -->
<!-- screenshot: run page — animated stage DAG + streaming log terminal (docs/img/run-dag.png) -->
<!-- screenshot: failed run with the Groq diagnosis card (docs/img/diagnosis.png) -->
<!-- screenshot: deployments page with active deployment + rollback history (docs/img/deployments.png) -->

## Documentation

| Doc | What's in it |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, run lifecycle, module map, data model |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every env var, webhook setup, Groq setup, compose caveats |
| [docs/SPEC.md](docs/SPEC.md) | The server ↔ dashboard contract (API, WS events, schema) |
| [docs/API.md](docs/API.md) | REST + WebSocket API reference with example payloads |
| [server/README.md](server/README.md) | Server module map, scripts, environment |
| [dashboard/README.md](dashboard/README.md) | Dashboard module map, theme token rules |
| [sample-app/README.md](sample-app/README.md) | The guinea-pig app and its pipeline, explained |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, branching model, commit conventions |
| [SECURITY.md](SECURITY.md) | Reporting vulnerabilities, deployment caveats |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [docs/issues/](docs/issues/) | Drafted issues — known bugs and planned improvements |

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the dev
setup, the `main`/`develop` branching model, and commit conventions. Good
starting points are labeled in [docs/issues/](docs/issues/).

## Credits

Maintained by **Muhammad Musa**
([@musaJawad004](https://github.com/musaJawad004) · musajawad004@gmail.com).

Developed with AI pair-programming via [Claude Code](https://claude.com/claude-code).

## License

[MIT](LICENSE) © 2026 Muhammad Musa
