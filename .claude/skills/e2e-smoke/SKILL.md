---
name: e2e-smoke
description: "Run an end-to-end Emberflow smoke test: boot prerequisites, trigger the sample-app pipeline, verify the run passes and the deployment serves on :8200. Use when verifying changes work in the real system."
---

# e2e-smoke

Run the sample-app pipeline through the real system and verify the green path:
all four stages pass, the run is `passed`, and the deployed container answers
on `:8200`. Run all commands from the repo root.

## Steps

### 1. Check prerequisites

```bash
docker info >/dev/null 2>&1 && echo "docker: ok" || echo "docker: NOT RUNNING"
redis-cli -p 6379 ping   # expect PONG
```

If either fails, stop and report it. Redis can be started with
`docker run -d -p 6379:6379 redis:7-alpine`.

### 2. Start the server if :4100 is down

```bash
curl -sf http://localhost:4100/api/health || echo "server down"
```

If down, start it in the background and wait for health:

```bash
(cd server && npm start) &
until curl -sf http://localhost:4100/api/health; do sleep 1; done
```

### 3. Trigger the sample-app run

```bash
RUN_ID=$(curl -s -X POST http://localhost:4100/api/runs \
  -H 'content-type: application/json' \
  -d '{"localPath": "'"$PWD"'/sample-app"}' | sed -E 's/.*"runId":"([^"]+)".*/\1/')
echo "runId: $RUN_ID"
```

Expect HTTP 202 with `{"runId":"..."}`.

### 4. Poll until the run reaches a terminal status

```bash
while :; do
  STATUS=$(curl -s http://localhost:4100/api/runs/$RUN_ID | sed -E 's/.*"run":\{[^}]*"status":"([^"]+)".*/\1/')
  echo "status: $STATUS"
  case "$STATUS" in passed|failed|canceled) break;; esac
  sleep 3
done
```

Terminal statuses are `passed`, `failed`, or `canceled`. A full run (npm
install inside containers) can take a few minutes on a cold image cache.

### 5. Assert the run passed with all 4 stages

```bash
curl -s http://localhost:4100/api/runs/$RUN_ID
```

Assert: `run.status == "passed"` and all four stages — `install`, `lint`,
`test`, `build` — have `status: "passed"`.

### 6. Verify the deployment serves

```bash
curl -s http://localhost:8200/health
```

Expect exactly `{"ok":true}`. Optionally confirm the deployment row is
`running` via `curl -s http://localhost:4100/api/deployments`.

## On failure, report

- The run status and **each stage's status** from `GET /api/runs/$RUN_ID`.
- The last log lines of every non-passed stage, via the logs endpoint:

  ```bash
  curl -s "http://localhost:4100/api/runs/$RUN_ID/logs?stage=<stageId>" | tail -c 3000
  ```

- If the run passed but `:8200` does not answer: the output of
  `curl -s http://localhost:4100/api/deployments` (deploy failures also land
  as `system` log lines on the run's last stage) and `docker ps`.
