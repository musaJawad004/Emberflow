# Dashboard infers "analyst skipped" from a polling heuristic instead of an explicit API field

Labels: enhancement, good first issue

## Context

When a run fails, the analyst module asks Groq for a diagnosis — unless
`GROQ_API_KEY` is unset (or the API call fails), in which case it skips
gracefully and writes a system log line. The dashboard's `DiagnosisCard`
needs to distinguish three states: "diagnosis available", "diagnosis still
being generated", and "analyst was skipped".

## Current behavior

The server never says "skipped" in a machine-readable way —
`GET /api/runs/:id/analysis` returns `{ analysis: null }` both while the
analyst is still working and when it will never run. So `DiagnosisCard`
guesses: it polls the endpoint up to 4 times, 4 seconds apart, and if it still
sees `null` it assumes the analyst was skipped and renders the "analyst
skipped" note.

Problems with the heuristic:

- A slow Groq response (> ~16 s) is mislabeled as "skipped" even though a
  diagnosis arrives later (it does self-correct if a WS `analysis` event
  lands, but the interim message is wrong).
- A genuinely skipped analyst still costs 4 wasted requests per failed-run
  page view.
- The real reason (no key? API error? run was canceled?) is buried in a
  system log line the user has to hunt for.

## Proposed fix

Make the analyst outcome explicit:

1. Have the analyst service record its outcome per run — e.g. an
   `analyst_status` column on `runs` (`pending` | `done` | `skipped` |
   `error`) plus a short `analyst_note` ("GROQ_API_KEY not set", HTTP status,
   …), written at the same moment the current system log line is emitted.
2. Return it from `GET /api/runs/:id/analysis`:
   `{ analysis: null, status: "skipped", note: "GROQ_API_KEY not set" }`.
3. `DiagnosisCard` drops the retry counter entirely: `done` → render,
   `pending` → spinner (keep a slow poll or wait for the WS event),
   `skipped`/`error` → show the note immediately.

## Files involved

- `server/src/modules/analyst/service.js` — record outcome + reason
- `server/src/core/db.js` — migration for the new column(s)
- `server/src/modules/runs/routes.js` — analysis endpoint response
- `dashboard/src/modules/analyst/DiagnosisCard.tsx` — remove the
  `RETRY_MS` / `MAX_TRIES` heuristic
- `dashboard/src/lib/types.ts`, `dashboard/src/lib/api.ts` — response type
