# Deployment health check is only "container still alive after 2 s" — add a real HTTP probe with retries

Labels: enhancement

## Context

After a green run with a `deploy` section, Emberflow starts the app container
and needs to decide whether the deployment is `running` or `failed` — this
verdict drives what the dashboard shows and whether the previous version was
replaced by something that actually works.

## Current behavior

`server/src/modules/deploy/service.js` waits 2 seconds and checks that the
container hasn't exited. That's it. Two failure classes slip through:

- **False green:** the process is alive but the app never binds the port,
  crashes at second 3, or serves 500s (bad env, missing build artifact). The
  deployment shows `running` while the app is dead.
- **False red (potential):** an app that legitimately needs > 2 s to boot but
  exits-and-restarts under a supervisor would be judged by a single instant.

The `deploy` section already declares `port`/`hostPort`, so Emberflow knows
exactly where to probe — it just doesn't.

## Proposed fix

1. Add an optional `healthPath` to the `deploy` section (default `/`),
   e.g. `healthPath: /health` — the sample app already exposes one.
2. After starting the container, probe `http://127.0.0.1:<hostPort><healthPath>`
   with retries and backoff: e.g. up to 15 attempts over ~30 s, success = any
   2xx/3xx response. Use plain `fetch` with a per-attempt timeout.
3. Keep the "container still alive" check as a fast-fail between attempts (if
   the container died, stop probing immediately).
4. On failure: mark the deployment `failed`, capture `docker logs` into the
   run's system logs (already done today), and — since the previous
   deployment was already stopped — write a clear system line suggesting
   rollback. Automatic rollback-on-failed-deploy is a natural follow-up.
5. Emit progress as system log lines ("health probe 3/15 failed: ECONNREFUSED")
   so the run page tells the story live.

## Files involved

- `server/src/modules/deploy/service.js` — probe loop, verdict
- the `emberflow.yml` parser in `server/src/modules/pipeline/` —
  `deploy.healthPath` validation
- `docs/SPEC.md` — deploy section contract
- `sample-app/emberflow.yml` — set `healthPath: /health` as the reference
  example
