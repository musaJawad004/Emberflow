# API server and queue worker share one process — split them for scale

Labels: enhancement, performance

## Context

BullMQ's whole point is decoupling producers from consumers, but Emberflow
currently starts the worker inside the API process: `src/index.js` calls
`startWorker()` from `core/queue.js` right next to `app.listen()`.

## Current behavior

One Node process serves HTTP + WebSocket **and** orchestrates pipeline runs.
Consequences:

- A heavy run (many parallel stages, thousands of log lines per second) and
  API/WS latency compete for the same event loop.
- You cannot scale run throughput by adding workers — a second server process
  would also bind the port and duplicate the WS endpoint.
- A worker crash (e.g. an unhandled error in a runner path) takes the API and
  every live dashboard connection down with it.

## Proposed fix

1. **New entrypoint** `server/src/worker.js`: config → db → `startWorker()`,
   plus graceful shutdown. `src/index.js` keeps HTTP/WS and *stops* starting
   the worker (or keeps it behind an `EMBER_ROLE=all|api|worker` env for the
   simple single-process dev setup).
2. **Cross-process events** — this is the real work. The runner currently
   calls `core/ws.broadcast()` in-process; with a separate worker, WS clients
   live in the API process. Route events through Redis pub/sub (already a
   dependency): worker publishes `run:update` / `stage:update` / `log` /
   `analysis` / `deployment:update`, the API process subscribes and fans out
   to WS clients. SQLite writes stay in the worker; the API only reads.
3. **Compose**: add a `worker` service (same image as `server`, different
   command), enabling `docker compose up --scale worker=3`. Note BullMQ
   concurrency per worker as a follow-up knob.
4. Keep `npm start` in dev working as today via the `EMBER_ROLE=all` default
   so the getting-started path doesn't grow a step.

## Files involved

- `server/src/index.js`, new `server/src/worker.js` — process split
- `server/src/core/queue.js` — worker startup extraction
- `server/src/core/ws.js` + a new pub/sub bridge in `core/` — event fan-out
- `server/src/modules/pipeline/runner.js`, `modules/analyst/service.js`,
  `modules/deploy/service.js` — broadcast via the bridge instead of ws directly
- `docker-compose.yml`, `server/package.json` (worker script),
  `docs/ARCHITECTURE.md`
