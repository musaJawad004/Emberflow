# Configuring Emberflow

All server configuration is environment-driven. On boot the server loads
`server/.env` if present (real environment variables always win), and **only**
`server/src/config/index.js` reads `process.env`. Start from the template:

```bash
cp server/.env.example server/.env
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMBER_PORT` | `4100` | HTTP + WebSocket port the server listens on. |
| `EMBER_DB` | `server/data/emberflow.db` | Path to the SQLite database file. |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection for the BullMQ run queue. |
| `EMBER_EXECUTOR` | `docker` | Stage execution backend: `docker` or `local`. |
| `EMBER_WEBHOOK_SECRET` | *(unset)* | Shared secret for GitHub webhook HMAC verification. |
| `GROQ_API_KEY` | *(unset)* | Enables the AI failure analyst. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model used by the analyst. |

### `EMBER_PORT`

Port for the REST API and the WebSocket endpoint. The dashboard's API client
points at `http://localhost:4100`, so if you change this, update the base URL
in `dashboard/src/lib/api.ts` too.

```bash
EMBER_PORT=4100
```

### `EMBER_DB`

Absolute or relative path to the SQLite file. The schema is created on first
boot and migrated in place on upgrades — no separate migration step.

```bash
EMBER_DB=/var/lib/emberflow/emberflow.db
```

### `REDIS_URL`

Where the BullMQ queue lives. Any Redis 6+/7 works; no persistence
configuration is required (run state of record is SQLite, Redis only carries
jobs).

```bash
REDIS_URL=redis://127.0.0.1:6379        # local
REDIS_URL=redis://redis:6379            # docker compose (service name)
```

### `EMBER_EXECUTOR`

- `docker` (default) — each stage runs in its own container:
  `docker run --rm --name ember-<runId>-<stageId> -v <workdir>:/app -w /app <image> sh -c "<run>"`.
  Requires a reachable Docker daemon.
- `local` — dev fallback: stages run as plain `sh -c` processes in the workdir.
  **No isolation whatsoever** — never use this outside local development.

```bash
EMBER_EXECUTOR=docker
```

### `EMBER_WEBHOOK_SECRET`

Secret used to verify the `x-hub-signature-256` HMAC on `POST /webhook/github`.
If unset, webhooks are accepted **unverified** with a server-side warning
(dev mode). Always set it when the endpoint is reachable from the network.

```bash
EMBER_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

### `GROQ_API_KEY` / `GROQ_MODEL`

Credentials for the failure analyst (Groq chat completions). Without a key the
analyst is skipped gracefully: failed runs get a system log line
("analyst skipped: GROQ_API_KEY not set") and everything else works normally.

```bash
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

### Fixed constants (not env-tunable yet)

Defined in `server/src/config/index.js`:

- Run workdirs: `/tmp/emberflow-runs/<runId>/repo`, last **20** kept
  (needed for rollback), older pruned.
- Per-stage timeout **10 min**, per-run timeout **30 min**.
- Log cap **5000 lines per stage** (then truncated with a system notice).

## GitHub webhook setup

Emberflow builds on every push once GitHub can reach `POST /webhook/github`.

1. **Set the secret** on the server:

   ```bash
   # server/.env
   EMBER_WEBHOOK_SECRET=<random hex string>
   ```

   Restart the server.

2. **Expose the endpoint.** GitHub must reach your machine over the public
   internet. On a local machine, use a tunnel:

   ```bash
   ngrok http 4100
   # or: cloudflared tunnel --url http://localhost:4100
   ```

   Note the public URL (e.g. `https://abc123.ngrok.app`). There is no built-in
   tunnel or polling fallback yet — see
   [issues/005](issues/005-webhook-requires-public-tunnel.md).

3. **Configure GitHub**: repository → *Settings* → *Webhooks* → *Add webhook*:

   - **Payload URL:** `https://<your-public-host>/webhook/github`
   - **Content type:** `application/json`
   - **Secret:** the same value as `EMBER_WEBHOOK_SECRET`
   - **Events:** "Just the push event"

4. **Verify.** Push a commit (or use the webhook's "Redeliver" button). GitHub
   should show a `202` response with a `runId`, and the run appears on the
   dashboard. Non-push events answer `200 { ignored: true }`; a bad signature
   answers `401`.

   Without GitHub you can test locally by computing the HMAC yourself:

   ```bash
   BODY='{"ref":"refs/heads/main","after":"<sha>","repository":{"name":"myrepo","clone_url":"https://github.com/you/myrepo.git"}}'
   SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$EMBER_WEBHOOK_SECRET" | awk '{print $2}')"
   curl -X POST localhost:4100/webhook/github \
     -H 'content-type: application/json' \
     -H "x-github-event: push" -H "x-hub-signature-256: $SIG" \
     -d "$BODY"
   ```

The repository being built must contain an `emberflow.yml` at its root, and
must be cloneable from the server machine (public repo, or credentials
available to `git` on that machine).

## Groq key setup

1. Create a key at [console.groq.com](https://console.groq.com) (API Keys →
   Create API Key).
2. Put it in `server/.env` as `GROQ_API_KEY=gsk_...` and restart the server.
3. Optionally pick another model via `GROQ_MODEL`.
4. Test: trigger a failing run (`./scripts/demo.sh` prints a one-liner that
   breaks the sample app's tests). Within a few seconds of the run failing,
   the run page shows the diagnosis card with a 2–4 sentence analysis and a
   "Likely fix:" line.

The analyst only fires on **failed** runs (not canceled ones), sends at most
the last 80 log lines per failed stage, and any API/network error is logged
and swallowed — it can never fail a run.

## Running under Docker Compose

`docker compose up --build` at the repo root starts three services:

| Service | Image / build | Ports |
| --- | --- | --- |
| `redis` | `redis:7-alpine` | 6379 |
| `server` | `server/Dockerfile` | 4100 |
| `dashboard` | `dashboard/Dockerfile` | 3100 |

The server container gets `REDIS_URL=redis://redis:6379` and two important
mounts: `/var/run/docker.sock` and `/tmp/emberflow-runs`.

### Caveat: the server drives the HOST Docker daemon

The server container does **not** run its own Docker engine. It talks to the
**host's** daemon through the mounted socket (`/var/run/docker.sock`). That
has a subtle but critical consequence:

> Every `-v <path>:...` that Emberflow passes to `docker run` is resolved by
> the **host** daemon, against the **host** filesystem — not against the
> server container's filesystem.

Stage containers mount the run workdir. If the server wrote workdirs to a path
that exists only inside its own container, the host daemon would mount an
empty (host-side) directory and every stage would see no code. That is why
compose bind-mounts `/tmp/emberflow-runs` **1:1** —
`/tmp/emberflow-runs:/tmp/emberflow-runs` — so the exact same absolute path
holds the same files on the host and in the server container.

Practical implications:

- Don't change the workdir location for the containerized server unless you
  mirror the bind mount to the identical host path.
- `{ localPath }` triggers refer to paths **on the host** and must also be
  visible inside the server container at the same absolute path (mount them
  the same way). Git-URL and webhook triggers avoid the problem entirely.
- Mounting the Docker socket is effectively root access on the host — treat
  the server container as privileged and read [SECURITY.md](../SECURITY.md).

A cleaner long-term design is discussed in
[issues/011](issues/011-compose-runner-host-visible-workdirs.md).
