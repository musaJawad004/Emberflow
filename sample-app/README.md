# Emberflow Sample App

A deliberately small Node.js HTTP service whose only job is to be built,
tested, deployed, and broken by Emberflow. It backs the "sample-app" preset in
the dashboard's trigger menu and is the subject of `scripts/demo.sh`.

## What it demonstrates

- **A real DAG** — four stages where two (`lint`, `test`) genuinely run in
  parallel, so the dashboard's animated graph shows concurrency.
- **A deployable artifact** — `build` writes `dist/build-info.json`
  (timestamp + Node version), and the deployed server reports it, so you can
  *see* which build is live and watch it change after a rollback.
- **A useful failure mode** — append a broken test (the demo script does this
  for you) and you get: `test` fails → `build` skipped → run failed → Groq
  diagnosis on the run page.

## The pipeline — `emberflow.yml` walkthrough

```yaml
name: sample-app
image: node:20-alpine        # default image for every stage
stages:
  - id: install
    run: npm install         # runs first — it has no needs of its own
  - id: lint
    needs: [install]         # lint and test both wait for install,
    run: npm run lint        # then run IN PARALLEL in separate containers
  - id: test
    needs: [install]
    run: npm test            # node:test runner over src/calc.test.js
  - id: build
    needs: [lint, test]      # the join point — needs BOTH to pass
    run: npm run build       # writes dist/ + build-info.json
deploy:
  needs: [build]             # deploy only fires if build (and the run) passed
  start: node src/server.js  # command run inside the deploy container
  port: 8080                 # the app listens on 8080 in-container…
  hostPort: 8200             # …published on the host as :8200
```

Execution order: `install` → (`lint` ∥ `test`) → `build` → deploy. If `test`
fails, `build` is `skipped` (skip propagation), the run is `failed`, and no
deploy happens.

## What's inside

| File | Purpose |
| --- | --- |
| `src/calc.js` | The "business logic" (an `add` function) |
| `src/calc.test.js` | Tests via the built-in `node:test` runner |
| `src/server.js` | HTTP server: `/health` → `{ ok: true }`; `/` → app info + build info |
| `scripts/build.js` | Copies `calc.js` to `dist/` and writes `dist/build-info.json` |

No dependencies — `npm install` is intentionally instant, and "lint" is a
`node --check` syntax pass, keeping demo runs fast.

## Try it

```bash
# from the repo root, with server + dashboard running:
curl -X POST localhost:4100/api/runs \
  -H 'content-type: application/json' \
  -d "{\"localPath\": \"$PWD/sample-app\"}"

# after the run goes green:
curl localhost:8200/health   # {"ok":true}
curl localhost:8200/         # app info incl. build-info.json contents
```

`./scripts/demo.sh` prints these plus the failing-run variant.
