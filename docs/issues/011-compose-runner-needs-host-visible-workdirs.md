# Docker Compose: runner requires host-visible workdir paths due to socket-mount architecture

Labels: bug, docs

## Context

Under `docker compose up`, the Emberflow server runs inside a container but
drives the **host's** Docker daemon through the mounted
`/var/run/docker.sock`. Stage containers are therefore siblings of the server
container, not children — and every `-v <workdir>:/app` bind mount they
receive is resolved **on the host**, not inside the server container.

## Current behavior

The compose file papers over this with a 1:1 bind mount
(`/tmp/emberflow-runs:/tmp/emberflow-runs`), so the path the server writes to
is coincidentally also valid on the host. This works, but it is fragile:

- It silently breaks if `EMBER_*` config moves workdirs anywhere else, on
  hosts where `/tmp` is per-user/aliased (macOS `/tmp` → `/private/tmp`), or
  on Docker Desktop setups with restricted file sharing.
- `localPath` triggers (e.g. the dashboard's sample-app preset) refer to host
  paths that don't exist inside the server container, so the pre-flight
  "directory contains emberflow.yml" validation fails even when the host path
  is valid for the sibling containers.
- Nothing warns the user; runs just fail with confusing mount errors.

## Proposed fix

1. Short term (docs): keep the caveat in `docs/CONFIGURATION.md` prominent,
   and make `scripts/demo.sh` detect compose mode and print the right
   expectations. Add a boot-time warning when the server detects it is
   containerized (e.g. `/.dockerenv` exists) and `EMBER_EXECUTOR=docker`.
2. Medium term: replace bind-mounted workdirs with named Docker volumes that
   both the server and stage containers mount (`--volumes-from`-style), or
   copy the workspace into each stage container (`docker cp`) instead of
   mounting — removing the host-path coupling entirely.
3. Alternatively, document running the server natively while Redis and the
   dashboard stay in compose (hybrid mode) as the recommended dev setup.

## Files involved

- `docker-compose.yml` — volume strategy
- `server/src/modules/pipeline/runner.js` / `executor.js` — workdir handling
- `server/src/config/index.js` — containerization detection + warning
- `docs/CONFIGURATION.md`, `scripts/demo.sh` — docs/UX
