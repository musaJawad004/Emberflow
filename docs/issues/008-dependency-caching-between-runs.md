# No dependency caching between runs — npm install starts cold every time

Labels: performance

## Context

Every run gets a fresh workdir and every stage a fresh container. That
isolation is a feature — but it means there is no cache of any kind between
runs: `npm install` re-downloads and re-extracts the full dependency tree on
every single push, typically dominating total pipeline time for real
JavaScript projects. (The bundled sample-app hides this because it has zero
dependencies.)

## Current behavior

The executor mounts only the run workdir into the stage container
(`-v <workdir>:/app`). Nothing persists between runs; nothing is shared
between repos. A repo with a typical Next.js dependency tree pays 1–3 minutes
of pure reinstall per run.

## Proposed fix

Opt-in cache mounts, declared in the pipeline file:

```yaml
stages:
  - id: install
    run: npm ci
    cache:
      - /root/.npm        # path INSIDE the container to persist
```

1. For each cache path, the executor mounts a named Docker volume:
   `ember-cache-<repoName>-<hash-of-path>` at the declared container path
   (named volumes are host-managed, so this also works under the compose
   setup where bind paths must be host-visible).
2. Scope caches per repo to avoid cross-project pollution; document that
   caches are shared across branches of the same repo.
3. `docker volume rm` housekeeping: a small "clear cache" admin endpoint or a
   documented one-liner.
4. Validate the `cache:` entries in the pipeline parser (absolute paths only).

Package-manager caches (`/root/.npm`, pip's cache dir, etc.) are the right
target rather than `node_modules` itself — they're safe to share across
lockfile changes.

## Files involved

- the `emberflow.yml` parser in `server/src/modules/pipeline/` — `cache:`
  schema + validation
- `server/src/modules/pipeline/executor.js` — extra `-v` volume args
- `server/src/core/docker.js` — cache volume naming helper
- `docs/SPEC.md`, `README.md` — pipeline format addition
