# Rollback 409s when the target's workdir was pruned — consider image snapshots

Labels: bug, enhancement

## Context

Rollback restarts a previous deployment's container **from its retained run
workdir** (`/tmp/emberflow-runs/<runId>/repo`). Workdir retention keeps only
the **last 20** run workdirs; older ones are pruned to bound disk usage.

## Current behavior

`POST /api/deployments/:id/rollback` checks whether the target's workdir still
exists and answers `409 "workdir for that deployment has been pruned"` if not
(`server/src/modules/deploy/service.js`). So rollback silently degrades over
time: on an active project, a deployment from 25 runs ago is unrecoverable,
and the dashboard still shows its Rollback button — the user only finds out
via the 409. Workdirs in `/tmp` also don't survive a host reboot on most
systems, which can wipe *every* rollback target at once.

## Proposed fix

Decouple rollback from workdir retention by snapshotting the deployable state
at deploy time:

1. When a deployment goes `running`, snapshot it as an image — either
   `docker commit <container> ember-snapshot-<deploymentId>` or a `docker
   build` of a trivial image that COPYs the workdir. Store the image ref on
   the `deployments` row.
2. Rollback prefers the snapshot image (`docker run` it directly, no workdir
   needed) and falls back to the workdir for pre-snapshot rows.
3. Prune snapshots with a retention policy tied to deployment history
   (e.g. keep the last N per repo) instead of run count.
4. Until then, two mitigations: expose rollback availability in
   `GET /api/deployments` (a boolean computed from workdir existence) so the
   dashboard can disable the button, and keep the 409 as the backstop.

## Files involved

- `server/src/modules/deploy/service.js` — snapshot at deploy, prefer image on
  rollback, availability flag
- `server/src/core/docker.js` — commit/tag/rmi helpers
- `server/src/core/db.js` — `deployments.snapshot_image` column (migration)
- `dashboard/src/modules/deploy/DeploymentList.tsx`,
  `dashboard/src/modules/deploy/RollbackButton.tsx` — disabled state with a
  tooltip when unavailable
