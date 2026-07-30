# Contributing to Emberflow

Thanks for considering a contribution! This document covers everything you need
to get a dev environment running and land a clean pull request.

> **Note on links:** docs and badges assume the repository slug
> `musaJawad004/emberflow`. If the repo lives under a different slug, the
> links update accordingly.

## Dev setup

Prerequisites: Node.js **20+**, Docker (daemon running), Redis.

```bash
# redis, if you don't already have one on :6379
docker run -d -p 6379:6379 redis:7-alpine

# server — API + queue worker on :4100
cd server
npm install
cp .env.example .env      # optional: set GROQ_API_KEY, EMBER_WEBHOOK_SECRET, …
npm run dev               # node --watch

# dashboard — new terminal, http://localhost:3100
cd dashboard
npm install
npm run dev
```

No Docker available? `EMBER_EXECUTOR=local` runs stages directly on the host
(no isolation — dev only).

## Project layout

```
server/               Fastify API + BullMQ worker (plain JS, ESM)
  src/index.js        bootstrap ONLY — wires config → db → queue → http
  src/config/         all env parsing; nothing else reads process.env
  src/core/           shared plumbing: db, ws, queue, docker helpers
  src/modules/        features: runs, pipeline, webhook, analyst, deploy
dashboard/            Next.js App Router + Tailwind v4 (TypeScript)
  src/app/            routes only; pages compose module components
  src/theme/          theme.css — every design token lives here
  src/components/ui/  generic building blocks (Panel, StatusPill, Button, …)
  src/modules/        features: runs, dag, logs, analyst, deploy
  src/lib/            types, API client, WebSocket hook, formatting
sample-app/           guinea-pig app with an emberflow.yml (deploys on :8200)
docs/                 SPEC, ARCHITECTURE, CONFIGURATION, drafted issues
scripts/demo.sh       prerequisite checks + copy-paste demo commands
```

The folder conventions are part of the design contract
([docs/SPEC.md](docs/SPEC.md)): feature logic lives in self-contained modules,
shared plumbing in `core/`, and entrypoints only wire modules together. New
features should follow the same shape.

## Branching model

- **`main`** — stable, release-only. Protected; nothing is committed to it
  directly. Every commit on `main` corresponds to a tagged release.
- **`develop`** — integration branch. This is where finished work lands and
  where CI must stay green.
- **`feature/<slug>`** — new features, branched from `develop`
  (e.g. `feature/log-retention`).
- **`fix/<slug>`** — bug fixes, branched from `develop`
  (e.g. `fix/log-cursor-dedupe`).

**Pull requests target `develop`**, not `main`.

Release flow: when `develop` is ready to ship, it is merged into `main`, tagged
`vX.Y.Z`, and the [CHANGELOG](CHANGELOG.md) entry for that version is
finalized (Keep-a-Changelog format, semver).

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary>
```

- **Types:** `feat`, `fix`, `docs`, `chore`, `refactor`
- **Scopes** (pick the closest): `server`, `dashboard`, `pipeline`, `runs`,
  `webhook`, `analyst`, `deploy`, `sample-app`, `ci`, `compose`

Examples:

```
feat(pipeline): add per-stage image override
fix(dashboard): dedupe live log lines against fetched history
docs(server): document EMBER_EXECUTOR fallback
refactor(deploy): extract container start into startDeployment()
```

PR titles follow the same convention (the merged commit inherits it).

## Running the e2e smoke test

There is no automated e2e suite yet; before opening a PR that touches the run
path, walk the manual smoke test:

1. Start Redis, the server (`npm start`), and the dashboard (`npm run dev`).
2. Run `./scripts/demo.sh` — it verifies Docker + Redis and prints the exact
   curl commands used below.
3. **Green run:** trigger `sample-app` (dashboard "Trigger run" menu, or the
   printed curl). Watch the DAG: `install` → `lint`+`test` in parallel →
   `build` → run `passed` → deployment appears on `/deployments` and
   `curl localhost:8200/health` returns `{"ok":true}`.
4. **Failing run:** use the demo script's "failing run" one-liner (copies the
   sample app, breaks a test). Expect: `test` fails, `build` is `skipped`,
   run is `failed`, and — with `GROQ_API_KEY` set — a diagnosis card appears
   on the run page.
5. **Cancel:** trigger another run and cancel it mid-flight; the run should go
   `canceled` and its containers should disappear (`docker ps`).
6. **Rollback:** on `/deployments`, roll back to the previous stopped
   deployment and re-check `localhost:8200`.

Note in the PR description which of these you ran.

## Code style

- **Server** — plain JavaScript, ESM (`"type": "module"`), no TypeScript and
  no build step. Only `src/config/index.js` reads `process.env`. All child
  processes go through `spawn` with argument arrays — never interpolate user
  input into a shell string. No feature logic in `src/index.js`.
- **Dashboard** — TypeScript, App Router. **All design values come from
  `src/theme/theme.css` tokens** — components must never hardcode hex values;
  need a new color/glow, add a token first. Client components are marked
  `"use client"`; API access goes through `src/lib/api.ts`.
- **Docs** — update the relevant doc (README, SPEC, ARCHITECTURE,
  CONFIGURATION) in the same PR as the behavior change.

## Opening a PR

1. Branch from `develop` (`feature/…` or `fix/…`).
2. Keep the diff focused; unrelated refactors go in their own PR.
3. Fill in the PR template — conventional title, docs updated, smoke test
   results.
4. CI (`.github/workflows/ci.yml`) must pass: server syntax check, dashboard
   build + type check.

## Questions / conduct

Open a discussion or issue for questions. All participation is covered by the
[Code of Conduct](CODE_OF_CONDUCT.md); conduct reports go to
**musajawad004@gmail.com**.
