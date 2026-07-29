# Live log lines sharing a millisecond with fetched history can be dropped in the log terminal

Labels: bug, good first issue

## Context

The run page assembles a stage's log view from two sources: history fetched
over REST (`GET /api/runs/:id/logs?stage=`) and live lines arriving over the
WebSocket. To avoid rendering duplicates, the dashboard records the timestamp
of the last history row (`lastTs`) and only keeps live lines that are strictly
newer.

## Current behavior

In `dashboard/src/modules/runs/RunDetail.tsx`, the merge is:

```ts
return [...hist.lines, ...live.filter((l) => l.ts > hist.lastTs)];
```

Log timestamps are millisecond-precision, and a busy stage (an `npm install`
spew, a test runner) easily emits several lines within the same millisecond.
Any live line whose `ts` **equals** `lastTs` but which was not part of the
fetched history is silently dropped — the terminal shows a hole exactly at the
REST/WS boundary. It is intermittent and timing-dependent, which makes it easy
to misread as "the stage just didn't print that".

## Proposed fix

Stop using the timestamp as the cursor; it is not unique.

1. `logs` rows already have a strictly monotonic `id`
   (INTEGER PRIMARY KEY AUTOINCREMENT). Include `id` in the REST response rows
   **and** in the `log` WebSocket event payload (broadcast at insert time, so
   the id is known).
2. Cursor on `lastId` instead of `lastTs`: keep live lines with
   `l.id > hist.lastId`.

Fallback option (no server change): filter with `>=` and de-duplicate
identical `(ts, stream, line)` tuples at the boundary — but the id cursor is
simpler and exact.

## Files involved

- `dashboard/src/modules/runs/RunDetail.tsx` — merge logic (`lastTs`)
- `dashboard/src/lib/types.ts` — log row / `log` event types
- `server/src/modules/pipeline/runner.js` — where log lines are inserted and
  broadcast (the event needs the inserted row id)
- `server/src/core/db.js` — `insertLog` should return the new row id
- `server/src/modules/runs/routes.js` — logs endpoint response shape
