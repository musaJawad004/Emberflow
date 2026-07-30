# Emberflow API Reference

The server listens on `http://localhost:4100` (`EMBER_PORT`). All request and
response bodies are JSON; timestamps are Unix epoch **milliseconds**. This
reference is derived from [SPEC.md](SPEC.md) (the binding contract) and
verified against `server/src/modules/*/routes.js`.

**Error shapes.** Routes that check existence inline return a plain
`{ "message": "..." }` body (e.g. 404 `run not found`). Validation and state
errors are thrown with a status code and serialized by Fastify's default
handler as `{ "statusCode": 400, "error": "Bad Request", "message": "..." }`.
Each endpoint below notes which errors it can return.

## Curl quickstart

```bash
# is the server up?
curl -s localhost:4100/api/health

# trigger a run of the bundled sample app (from the repo root)
curl -s -X POST localhost:4100/api/runs \
  -H 'content-type: application/json' \
  -d '{"localPath": "'"$PWD"'/sample-app"}'
# → {"runId":"V1StGXR8_Z5jdHi6B-myT"}

# watch it
curl -s localhost:4100/api/runs/V1StGXR8_Z5jdHi6B-myT
curl -s "localhost:4100/api/runs/V1StGXR8_Z5jdHi6B-myT/logs?stage=test"

# after a green run with a deploy section
curl -s localhost:4100/api/deployments
curl -s localhost:8200/health          # → {"ok":true}
```

## REST endpoints

### GET /api/health

Liveness check.

**200**

```json
{ "ok": true, "executor": "docker" }
```

`executor` is `"docker"` or `"local"` (`EMBER_EXECUTOR`).

### POST /api/runs

Create and enqueue a run. Body is **either** a local path **or** a git URL:

```json
{ "localPath": "/path/to/repo-with-emberflow.yml" }
```

```json
{ "gitUrl": "https://github.com/user/repo.git", "ref": "main" }
```

`ref` is optional (branch, tag, or commit sha; default branch when omitted).

**202**

```json
{ "runId": "V1StGXR8_Z5jdHi6B-myT" }
```

**400** (Fastify error envelope) when: neither `localPath` nor `gitUrl` is
given (`provide either localPath or gitUrl`); `localPath` does not exist or is
not a directory; `localPath` contains no `emberflow.yml`; or `gitUrl` does not
start with `https://` or `git@`.

### GET /api/runs

List runs, newest first, capped at 50.

**200**

```json
{
  "runs": [
    {
      "id": "V1StGXR8_Z5jdHi6B-myT",
      "repo_name": "sample-app",
      "repo_path": "/Users/dev/emberflow/sample-app",
      "repo_url": null,
      "trigger": "manual",
      "commit_sha": null,
      "status": "passed",
      "created_at": 1753862400000,
      "started_at": 1753862400150,
      "finished_at": 1753862452000
    }
  ]
}
```

Run `status`: `queued | running | passed | failed | canceled`.
`trigger`: `manual | webhook`. `repo_url` and `commit_sha` are set for
git/webhook runs (`commit_sha` becomes the resolved sha after checkout).

### GET /api/runs/:id

One run plus its stage rows (in creation order).

**200**

```json
{
  "run": { "id": "V1StGXR8_Z5jdHi6B-myT", "status": "passed", "...": "..." },
  "stages": [
    {
      "id": "fA2kLm9Qw4RtY7uIoP3sD",
      "run_id": "V1StGXR8_Z5jdHi6B-myT",
      "stage_id": "test",
      "needs": "[\"install\"]",
      "command": "npm test",
      "image": "node:20-alpine",
      "status": "passed",
      "exit_code": 0,
      "started_at": 1753862410000,
      "finished_at": 1753862431000
    }
  ]
}
```

Stage `status`: `pending | running | passed | failed | skipped | canceled`.
`id` is the row's own key (used internally); `stage_id` is the id from
`emberflow.yml`. `needs` is a JSON-encoded string array.

**404** `{ "message": "run not found" }`

### GET /api/runs/:id/logs?stage=

Log lines for a run, oldest first. Optional `stage` query filters to one
`stage_id`.

**200**

```json
{
  "logs": [
    {
      "id": 412,
      "stage_pk": "fA2kLm9Qw4RtY7uIoP3sD",
      "ts": 1753862411000,
      "stream": "stdout",
      "line": "> sample-app@1.0.0 test",
      "stage_id": "test"
    }
  ]
}
```

`stream`: `stdout | stderr | system`. Stage output is capped at 5000 lines
(then a `system` line `log limit reached, output truncated`).

**404** `{ "message": "run not found" }`

### POST /api/runs/:id/cancel

Cancel a run. Valid while it is `queued` or `running`: marks the run
`canceled`, force-removes its `ember-<runId>-*` containers, and settles stages
(running → `canceled`, pending → `skipped`).

**200**

```json
{ "ok": true }
```

**404** run not found · **409** run already finished
(`run already passed`, etc.) — both in the Fastify error envelope.

### GET /api/runs/:id/analysis

The Groq failure diagnosis for a failed run, or `null` if there is none (run
not failed yet, analyst skipped, or no `GROQ_API_KEY`).

**200**

```json
{
  "analysis": {
    "id": "xK8pQr2WvN5tYz1MbC7Le",
    "run_id": "V1StGXR8_Z5jdHi6B-myT",
    "model": "llama-3.3-70b-versatile",
    "diagnosis": "The test stage failed because calc.test.js asserts 1 === 2. Likely fix: remove the broken assertion.",
    "created_at": 1753862460000
  }
}
```

**404** `{ "message": "run not found" }`

### POST /webhook/github

GitHub push-event receiver. Verifies the `x-hub-signature-256` HMAC header
against `EMBER_WEBHOOK_SECRET` when the secret is configured; without a secret
it accepts unverified (dev mode) with a server-side warning. Non-`push` events
(the `x-github-event` header) are acknowledged and ignored. Creates a run with
trigger `webhook` from `repository.clone_url` + `after`/`ref`.

GitHub cannot reach a local machine directly — use a tunnel for real webhooks,
or test with curl.

**202** `{ "runId": "..." }` — push event accepted
**200** `{ "ignored": true }` — non-push event
**400** `{ "message": "invalid JSON payload" }` or
`{ "message": "payload has no repository.clone_url" }`
**401** `{ "message": "invalid signature" }` — HMAC verification failed

### GET /api/deployments

All deployments, newest first.

**200**

```json
{
  "deployments": [
    {
      "id": "dQ4mNv8XzR2kTp6YwB1Ju",
      "run_id": "V1StGXR8_Z5jdHi6B-myT",
      "repo_name": "sample-app",
      "container_name": "ember-deploy-sample-app",
      "image": "node:20-alpine",
      "start_cmd": "node src/server.js",
      "port": 8080,
      "host_port": 8200,
      "status": "running",
      "rolled_back_from": null,
      "created_at": 1753862455000,
      "stopped_at": null
    }
  ]
}
```

Deployment `status`: `running | stopped | failed`. `rolled_back_from` holds
the deployment id a rollback was restored from.

### POST /api/deployments/:id/rollback

Restore a previously **stopped** deployment from its retained run workdir:
stops the current running deployment for that repo, restarts the target's
container, and inserts a new `running` row with `rolled_back_from` set.

**202**

```json
{ "deploymentId": "eF7gHj3KlM9nOp5QrS2Tv" }
```

**404** deployment not found · **409** target is not `stopped`, or its workdir
has been pruned (only the last 20 run workdirs are kept) — Fastify error
envelope.

## WebSocket

Connect to `ws://localhost:4100/ws`. All events are JSON objects with a
`type` field; the server pushes every change to every connected client (no
subscriptions). On connect the server immediately sends:

```json
{ "type": "hello" }
```

### `run:update`

A run row changed (created, started, finished, canceled). Payload carries the
full run row.

```json
{ "type": "run:update", "run": { "id": "V1StGXR8_Z5jdHi6B-myT", "status": "running", "...": "..." } }
```

### `stage:update`

A stage row changed. Payload carries the run id and the full stage row.

```json
{ "type": "stage:update", "runId": "V1StGXR8_Z5jdHi6B-myT", "stage": { "stage_id": "build", "status": "passed", "exit_code": 0, "...": "..." } }
```

### `log`

One log line from a stage (`stream`: `stdout | stderr | system`).

```json
{ "type": "log", "runId": "V1StGXR8_Z5jdHi6B-myT", "stageId": "test", "stream": "stdout", "line": "all 4 tests passed", "ts": 1753862431000 }
```

### `analysis`

The Groq analyst produced a diagnosis for a failed run. Payload carries the
full analyses row (same shape as `GET /api/runs/:id/analysis`).

```json
{ "type": "analysis", "runId": "V1StGXR8_Z5jdHi6B-myT", "analysis": { "diagnosis": "…Likely fix: …", "model": "llama-3.3-70b-versatile", "...": "..." } }
```

### `deployment:update`

A deployment row changed (started, stopped, failed, rolled back). Payload
carries the full deployment row (same shape as `GET /api/deployments`).

```json
{ "type": "deployment:update", "deployment": { "repo_name": "sample-app", "status": "running", "host_port": 8200, "...": "..." } }
```
