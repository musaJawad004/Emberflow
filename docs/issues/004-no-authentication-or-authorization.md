# No authentication or authorization on the API, WebSocket, or dashboard

Labels: security

## Context

Emberflow currently assumes it runs on a trusted machine reachable only by its
owner. There is no concept of a user, token, or session anywhere in the
system.

## Current behavior

Anyone who can reach the ports can do anything:

- `POST /api/runs` executes arbitrary commands (whatever the target repo's
  `emberflow.yml` says) in containers on the host — with
  `EMBER_EXECUTOR=local`, directly on the host.
- `POST /api/runs/:id/cancel` and `POST /api/deployments/:id/rollback` mutate
  state with no checks.
- The WebSocket endpoint streams every log line to any connecting client.
- The dashboard is a public window into all of the above.

The only guarded entry point is the GitHub webhook (HMAC, and only when
`EMBER_WEBHOOK_SECRET` is set). [SECURITY.md](../../SECURITY.md) documents the
"do not expose these ports" stance, but documentation is not a control.

## Proposed fix

Phase it — a small, honest control first, real auth later:

1. **Phase 1 — static bearer token.** New `EMBER_API_TOKEN` env var. When
   set, Fastify rejects REST requests without
   `Authorization: Bearer <token>` (except `/api/health` and
   `/webhook/github`, which has its own HMAC), and the WS upgrade requires the
   token (query param or first message). The dashboard reads the token from
   its environment and attaches it in `lib/api.ts` and the WS hook. Unset ⇒
   current open behavior, with a boot warning.
2. **Phase 2 — sessions/users.** Cookie-based login for the dashboard,
   per-token scopes (trigger vs. read-only), audit log of who triggered what.

Phase 1 is deliberately minimal: one env var, one Fastify `onRequest` hook,
timing-safe comparison, no user model.

## Files involved

- `server/src/config/index.js` — `EMBER_API_TOKEN`
- `server/src/index.js` — global auth hook registration
- `server/src/core/ws.js` — authenticate the upgrade/first message
- `dashboard/src/lib/api.ts` and the WS hook in `dashboard/src/lib/` —
  attach the token
- `docs/CONFIGURATION.md`, `SECURITY.md` — document the new variable
