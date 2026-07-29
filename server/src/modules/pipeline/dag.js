import { PipelineError } from './emberfile.js';

// DAG logic over stage DB rows ({ id, stage_id, needs: JSON array string, ... }).

export function validateDag(stageRows) {
  const ids = new Set(stageRows.map((s) => s.stage_id));
  for (const row of stageRows) {
    for (const need of JSON.parse(row.needs)) {
      if (!ids.has(need)) {
        throw new PipelineError(`stage "${row.stage_id}" needs unknown stage "${need}"`, row.id);
      }
    }
  }
  // Kahn's algorithm: repeatedly remove stages with no unresolved needs.
  // Anything left over sits on (or behind) a cycle.
  const remaining = new Map(stageRows.map((s) => [s.stage_id, new Set(JSON.parse(s.needs))]));
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [id, needs] of remaining) {
      if (needs.size === 0) {
        remaining.delete(id);
        for (const other of remaining.values()) other.delete(id);
        progressed = true;
      }
    }
  }
  if (remaining.size > 0) {
    const cycleIds = [...remaining.keys()];
    const row = stageRows.find((s) => s.stage_id === cycleIds[0]);
    throw new PipelineError(`dependency cycle detected involving: ${cycleIds.join(', ')}`, row.id);
  }
}

// Given finished outcomes (stage_id -> passed|failed|skipped|canceled) and the
// in-flight set, decide the next moves:
//   skip  — stages with a failed/skipped/canceled need (propagated to a fixpoint)
//   start — stages whose needs have all passed
export function planNext(stageRows, outcome, inFlight) {
  const skip = [];
  const start = [];
  const status = new Map(outcome);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of stageRows) {
      const id = row.stage_id;
      if (status.has(id) || inFlight.has(id) || start.includes(row)) continue;
      const needs = JSON.parse(row.needs);
      if (needs.some((n) => ['failed', 'skipped', 'canceled'].includes(status.get(n)))) {
        skip.push(row);
        status.set(id, 'skipped');
        changed = true;
      } else if (needs.every((n) => status.get(n) === 'passed')) {
        start.push(row);
        changed = true;
      }
    }
  }
  return { skip, start };
}
