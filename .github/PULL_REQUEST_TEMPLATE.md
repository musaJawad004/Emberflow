## Summary

<!-- What does this PR change, and why? Link the issue it addresses if there is one. -->

Closes #

## Type of change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `refactor` — no behavior change
- [ ] `chore` — tooling / CI / deps

## Checklist

- [ ] PR targets **`develop`** (not `main`)
- [ ] Title follows [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): summary` (scopes: server, dashboard, pipeline, runs, webhook, analyst, deploy, sample-app, ci, compose)
- [ ] Docs updated where behavior changed (README / SPEC / ARCHITECTURE / CONFIGURATION / folder READMEs)
- [ ] Ran the [manual e2e smoke test](../blob/develop/CONTRIBUTING.md#running-the-e2e-smoke-test) for changes touching the run path — noted results below
- [ ] No hardcoded hex values in dashboard components (theme tokens only)
- [ ] Server child processes use `spawn` with argument arrays (no shell interpolation of user input)
- [ ] CI is green (server syntax check, dashboard build + `tsc --noEmit`)

## Smoke test results

<!-- Which steps of the smoke test did you run (green run / failing run / cancel / rollback), and what happened? Write "n/a" for docs-only changes. -->

## Screenshots

<!-- For dashboard changes: before/after screenshots or a short clip. -->
