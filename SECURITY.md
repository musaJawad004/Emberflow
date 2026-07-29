# Security Policy

## Supported Versions

Emberflow is pre-1.0 software. Only the latest `0.x` release receives security
fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email **contact@glixentech.com** with:

- A description of the vulnerability and its impact
- Steps to reproduce (a minimal proof of concept is ideal)
- The version/commit you tested against

You will get an acknowledgement within a few days. Once a fix ships, we will
credit you in the release notes unless you prefer to stay anonymous.

## Known Deployment Caveats

Emberflow is designed for self-hosting on machines you control. Be aware of the
current limitations before deploying it anywhere reachable by others:

- **No authentication or authorization yet.** The REST API (`:4100`), WebSocket
  endpoint, and dashboard (`:3100`) are completely open: anyone who can reach
  them can trigger runs (which execute arbitrary commands in containers),
  cancel runs, and roll back deployments. This is tracked in
  [`docs/issues/004-no-authentication-or-authorization.md`](docs/issues/004-no-authentication-or-authorization.md).
  **Do not expose ports 4100, 3100, or 8200 to the public internet.** Bind them
  to localhost, a VPN, or an authenticated reverse proxy.
- **Set `EMBER_WEBHOOK_SECRET`.** Without it, `POST /webhook/github` accepts
  unsigned payloads (dev mode). Anyone who can reach the endpoint could start
  builds of arbitrary repositories.
- **Stages execute arbitrary commands.** Pipelines run whatever
  `emberflow.yml` tells them to, inside Docker containers on your machine.
  Only build repositories you trust. `EMBER_EXECUTOR=local` removes even the
  container boundary and should never be used outside local development.
- **The Docker socket is powerful.** When running the server via
  `docker compose`, the container mounts `/var/run/docker.sock`, which is
  equivalent to root access on the host. Treat the server container as
  privileged.

## Hardening Already in Place

- GitHub webhook HMAC verification (`x-hub-signature-256`) when
  `EMBER_WEBHOOK_SECRET` is set; timing-safe comparison.
- All child processes are spawned with argument arrays — user input is never
  interpolated into shell strings.
- Input validation on triggers: `localPath` must be an existing directory
  containing `emberflow.yml`; `gitUrl` must match `^(https://|git@)`.
- Per-stage (10 min) and per-run (30 min) timeouts, plus a 5000-line log cap
  per stage, to bound runaway pipelines.
