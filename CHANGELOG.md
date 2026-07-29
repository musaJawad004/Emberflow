# Changelog

All notable changes to Emberflow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-29

First public release.

### Added

- **Pipelines as code** — `emberflow.yml` defines named stages with `run`
  commands, per-stage `image` overrides, and `needs` dependencies forming a
  DAG. Independent stages execute in parallel.
- **Isolated Docker execution** — every stage runs in its own container
  (`docker run --rm`, named `ember-<runId>-<stageId>` so it can be killed on
  cancel/timeout). `EMBER_EXECUTOR=local` provides a no-Docker dev fallback.
- **Queueing** — runs are enqueued as BullMQ jobs backed by Redis; a worker in
  the server process prepares the workdir (`/tmp/emberflow-runs/<runId>/repo`),
  parses the pipeline, and orchestrates the DAG.
- **Live log streaming** — stdout/stderr/system lines and status transitions
  are persisted to SQLite and broadcast over WebSocket (`log`, `run:update`,
  `stage:update` events).
- **Mission-control dashboard** — Next.js app on `:3100` with a live run list,
  an animated stage DAG (@xyflow/react), an ANSI-aware log terminal, and a
  trigger menu for the sample app or any git URL / local path.
- **GitHub webhook triggers** — `POST /webhook/github` receives push events,
  verifies the `x-hub-signature-256` HMAC against `EMBER_WEBHOOK_SECRET`,
  clones the repository at the pushed commit, and starts a run.
- **Run cancellation** — `POST /api/runs/:id/cancel` while queued/running:
  kills the run's containers, marks in-flight stages `canceled` and pending
  ones `skipped`.
- **AI failure analysis** — on a failed run, the analyst collects each failed
  stage's command, exit code, and last 80 log lines, asks Groq
  (`GROQ_MODEL`, default `llama-3.3-70b-versatile`) for a diagnosis and a
  "Likely fix:", stores it, and pushes it live to the run page. Skipped
  gracefully when `GROQ_API_KEY` is unset.
- **Auto-deploy + rollback** — a green run whose `emberflow.yml` has a
  `deploy` section starts the app in a published container
  (`ember-deploy-<repoName>`); the `/deployments` page shows the active
  deployment and history with one-click rollback to any stopped deployment
  whose workdir is still retained (last 20 run workdirs are kept).
- **Hardening** — per-stage timeout (10 min), per-run timeout (30 min),
  5000-line log cap per stage, spawn-with-arg-arrays everywhere, trigger input
  validation, graceful shutdown, `.env` loading with `server/.env.example`.
- **Sample app** — a small Node HTTP service (serves on `:8200` when deployed)
  with lint/test/build stages, used by the demo script and the dashboard's
  trigger preset.

[Unreleased]: https://github.com/musaJawad004/emberflow/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/musaJawad004/emberflow/releases/tag/v0.1.0
