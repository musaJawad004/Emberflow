# GitHub webhooks require a public tunnel — no built-in alternative for local machines

Labels: enhancement

## Context

`POST /webhook/github` is the only way pushes trigger builds, and GitHub can
only deliver webhooks to a publicly reachable URL. Emberflow's primary
audience — people self-hosting on a laptop or a box behind NAT — has to run
ngrok/cloudflared and keep it alive, then update the GitHub webhook URL every
time the tunnel address changes. The setup walkthrough in
[docs/CONFIGURATION.md](../CONFIGURATION.md#github-webhook-setup) documents
the tunnel requirement, but the friction is real.

## Current behavior

Without a tunnel, push-triggered builds simply don't happen. The webhook
module works fine (HMAC verification, payload parsing, clone at the pushed
sha) — the delivery path is the missing piece.

## Proposed fix

Add a **polling trigger** as a tunnel-free alternative:

1. New config (env or a small `repos` config file): a list of
   `{ gitUrl, ref, intervalSeconds }` entries.
2. A poller in the server (setInterval per repo, default ~60 s) runs
   `git ls-remote <gitUrl> <ref>` — cheap, no clone — and compares the remote
   sha with the last sha it built.
3. On change, it creates a run exactly like the webhook path does (trigger
   value `poll` or reuse `webhook`), so everything downstream is untouched.
4. Document the trade-off honestly: polling adds up-to-interval latency and
   per-repo remote calls; webhooks remain the recommended path when a public
   URL is available.

Out of scope (possible follow-ups): bundling a tunnel client, or a
`smee.io`-style relay mode.

## Files involved

- `server/src/modules/webhook/git.js` — add an `ls-remote` helper
- `server/src/modules/webhook/` — new `poller.js` (start/stop with the
  server's lifecycle)
- `server/src/config/index.js` — polling configuration
- `server/src/index.js` — wire the poller into bootstrap/shutdown
- `docs/CONFIGURATION.md` — document the new mode
