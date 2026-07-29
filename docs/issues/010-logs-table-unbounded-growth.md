# Logs table grows without bound — add retention/pruning for old runs

Labels: enhancement, performance

## Context

Every log line from every stage of every run is stored as a row in the SQLite
`logs` table (capped at 5 000 lines per stage, but with no lifetime limit
across runs). Emberflow already prunes run *workdirs* to the last 20, but the
database keeps everything forever.

## Current behavior

`server/src/core/db.js` inserts log rows and never deletes them. On an active
instance this means:

- The `.db` file grows indefinitely (log lines dominate — a busy pipeline can
  add tens of thousands of rows per day).
- `GET /api/runs/:id/logs` stays fast (indexed by stage), but full-table
  operations (backups, VACUUM, migrations) get slower over time.
- There is no way to clear history short of deleting `server/data/emberflow.db`.

## Proposed fix

1. Add a retention setting, e.g. `EMBER_LOG_RETENTION_RUNS` (default 200):
   when a run finishes, delete `logs` rows belonging to runs beyond the most
   recent N finished runs. Keep the `runs`/`stages` rows themselves (cheap,
   useful history) — only the bulky log bodies are pruned.
2. Mark pruned stages so the dashboard can show "logs expired" instead of an
   empty terminal (e.g. a `logs_pruned` flag on `stages` or a single system
   line left in place).
3. Run the prune inside a transaction after run completion in
   `server/src/modules/pipeline/runner.js`, and `VACUUM` opportunistically
   (e.g. weekly or behind a flag) since deletes don't shrink the file.
4. Document the setting in `docs/CONFIGURATION.md` and `server/.env.example`.

## Files involved

- `server/src/core/db.js` — prune queries, optional flag/migration
- `server/src/modules/pipeline/runner.js` — post-run prune hook
- `server/src/config/index.js` — `EMBER_LOG_RETENTION_RUNS`
- `dashboard/src/modules/logs/LogTerminal.tsx` — "logs expired" empty state
