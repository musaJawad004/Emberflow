# emberflow.yml parse errors only reach the server console, never the run's logs

Labels: bug

## Context

When a run starts, the worker prepares the workdir and then parses
`emberflow.yml`. Only after a successful parse are `stages` rows created —
and log lines hang off stages (`logs.stage_pk` references `stages.id`).

## Current behavior

If parsing/validation fails (bad YAML, duplicate stage id, unknown `needs`,
missing file), the runner catches the error, marks the run `failed`, and
writes the reason to the **server console** only:

```
[emberflow] run <id> failed before stages were created: <message>
```

There are no stage rows to attach a log line to, so the dashboard shows a
failed run with an empty DAG and no explanation whatsoever. For the most
common newcomer mistake — a typo in `emberflow.yml` — the product looks
broken instead of pointing at the actual problem. The failure also bypasses
the analyst (there are no failed-stage logs to analyze).

## Proposed fix

Give pre-stage failures a home that the dashboard can render. Two workable
designs:

1. **Synthetic setup stage** (smaller change): on any failure before stage
   creation, insert a `setup` stage row with status `failed` and write the
   error as a `system` log line on it. The DAG shows a single red node whose
   logs explain the problem; the existing UI needs no changes.
2. **Run-level logs** (schema change): allow `logs` rows attached to the run
   (nullable `stage_pk` + `run_id` column), expose them in the logs endpoint,
   and render them in a "run" section of the terminal.

Option 1 is recommended — it reuses every existing pathway (REST, WS `log`
event, terminal rendering) for the price of one synthetic row.

## Files involved

- `server/src/modules/pipeline/runner.js` — the catch block that currently
  logs to `console.error` when no stage rows exist
- the `emberflow.yml` parser in `server/src/modules/pipeline/` — error
  messages should stay human-readable (they'll now be user-facing)
- `server/src/core/db.js` — only if option 2 is chosen
- `dashboard/src/modules/dag/StageDag.tsx` — verify a single-node DAG renders
  sensibly
