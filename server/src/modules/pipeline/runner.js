import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from '../../config/index.js';
import { broadcast } from '../../core/ws.js';
import { stageContainerName, removeRunContainers } from '../../core/docker.js';
import {
  getRun, updateRun,
  insertStage, updateStage,
  insertLog,
} from '../../core/db.js';
import { parseEmberfile, PipelineError } from './emberfile.js';
import { validateDag, planNext } from './dag.js';
import { executeStage } from './executor.js';
import { cloneRepo } from '../webhook/git.js';
import { analyzeRun } from '../analyst/service.js';
import { deployRun } from '../deploy/service.js';

// Orchestrates one run end-to-end: workdir prep → parse → DAG execution →
// analyst (failed) / deploy (passed) → workdir retention.
export async function runPipeline(runId) {
  let run = getRun(runId);
  if (!run || run.status !== 'queued') return; // e.g. canceled while still queued

  broadcast({ type: 'run:update', run: updateRun(runId, { status: 'running', started_at: Date.now() }) });

  const workdir = path.join(config.runsDir, runId, 'repo');
  let stageRows = [];

  // Per-run timeout: flag the run and kill its containers; the DAG loop notices.
  let runTimedOut = false;
  const runTimer = setTimeout(() => {
    runTimedOut = true;
    removeRunContainers(runId);
  }, config.runTimeoutMs);

  const shouldStop = () => {
    if (getRun(runId)?.status === 'canceled') return 'canceled';
    if (runTimedOut) return 'timeout';
    return null;
  };

  try {
    run = await prepareWorkdir(run, workdir);
    if (shouldStop() === 'canceled') return;

    const pipeline = parseEmberfile(await fs.readFile(path.join(workdir, 'emberflow.yml'), 'utf8'));
    stageRows = pipeline.stages.map((spec) => insertStage({
      id: nanoid(),
      run_id: runId,
      stage_id: spec.id,
      needs: JSON.stringify(spec.needs),
      command: spec.run,
      image: spec.image,
      status: 'pending',
    }));
    for (const row of stageRows) broadcast({ type: 'stage:update', runId, stage: row });

    validateDag(stageRows);
    const result = await executeDag(runId, stageRows, workdir, shouldStop);

    if (result === 'canceled') return; // cancel endpoint already finalized run + stages
    if (result === 'timeout') {
      systemLog(runId, stageRows[0], 'run timed out after 30 minutes');
    }
    const status = result === 'passed' ? 'passed' : 'failed';
    finishRun(runId, status);

    if (status === 'failed') await analyzeRun(runId);
    if (status === 'passed' && pipeline.deploy) await deployRun(getRun(runId), pipeline.deploy, workdir);
  } catch (err) {
    failRunEarly(runId, stageRows, err);
  } finally {
    clearTimeout(runTimer);
    await pruneWorkdirs();
  }
}

async function prepareWorkdir(run, workdir) {
  if (run.repo_url) {
    // commit_sha initially holds the requested ref/sha (may be null → default branch);
    // after checkout it is replaced with the resolved commit sha.
    const sha = await cloneRepo({ url: run.repo_url, checkout: run.commit_sha, dest: workdir });
    const updated = updateRun(run.id, { commit_sha: sha });
    broadcast({ type: 'run:update', run: updated });
    return updated;
  }
  const excluded = new Set(['node_modules', '.git', 'dist']);
  await fs.mkdir(workdir, { recursive: true });
  await fs.cp(run.repo_path, workdir, {
    recursive: true,
    filter: (entry) => !excluded.has(path.basename(entry)),
  });
  return run;
}

// Runs the DAG: every stage whose needs have all passed starts immediately (in
// parallel). A failed/skipped need marks the stage skipped, which cascades.
// Stops early when shouldStop() reports 'canceled' or 'timeout'.
async function executeDag(runId, stageRows, workdir, shouldStop) {
  const outcome = new Map(); // stage_id -> passed | failed | skipped | canceled
  const inFlight = new Map(); // stage_id -> Promise<{ stageId, status }>
  let stopped = null;

  while (outcome.size < stageRows.length) {
    stopped ??= shouldStop();
    if (!stopped) {
      const { skip, start } = planNext(stageRows, outcome, inFlight);
      for (const row of skip) {
        outcome.set(row.stage_id, 'skipped');
        broadcast({ type: 'stage:update', runId, stage: updateStage(row.id, { status: 'skipped' }) });
      }
      for (const row of start) {
        inFlight.set(row.stage_id, runStage(runId, row, workdir)
          .then((status) => ({ stageId: row.stage_id, status })));
      }
    }
    if (inFlight.size === 0) break;
    // In-flight stages always settle, even after a sibling fails or the run stops.
    const { stageId, status } = await Promise.race(inFlight.values());
    inFlight.delete(stageId);
    outcome.set(stageId, status);
  }

  if (stopped === 'timeout') {
    // Cancel marks leftover stages itself; on timeout we do it here.
    for (const row of stageRows) {
      if (!outcome.has(row.stage_id)) {
        broadcast({ type: 'stage:update', runId, stage: updateStage(row.id, { status: 'skipped', finished_at: Date.now() }) });
      }
    }
  }
  if (stopped) return stopped;
  return [...outcome.values()].every((s) => s === 'passed') ? 'passed' : 'failed';
}

async function runStage(runId, row, workdir) {
  broadcast({ type: 'stage:update', runId, stage: updateStage(row.id, { status: 'running', started_at: Date.now() }) });

  // Cap stdout/stderr at logLineCap lines per stage; system lines always pass.
  let lineCount = 0;
  let truncated = false;
  const log = (stream, line) => {
    if (stream !== 'system') {
      if (truncated) return;
      if (lineCount >= config.logLineCap) {
        truncated = true;
        log('system', 'log limit reached, output truncated');
        return;
      }
      lineCount++;
    }
    const ts = Date.now();
    insertLog(row.id, ts, stream, line);
    broadcast({ type: 'log', runId, stageId: row.stage_id, stream, line, ts });
  };

  const { exitCode, timedOut } = await executeStage({
    command: row.command,
    image: row.image,
    workdir,
    containerName: stageContainerName(runId, row.stage_id),
    onLine: log,
  });

  // Cancel kills the container; report the stage as canceled, not failed.
  if (getRun(runId)?.status === 'canceled') {
    broadcast({ type: 'stage:update', runId, stage: updateStage(row.id, { status: 'canceled', exit_code: exitCode, finished_at: Date.now() }) });
    return 'canceled';
  }

  const passed = exitCode === 0 && !timedOut;
  if (timedOut) log('system', `stage "${row.stage_id}" timed out after 10 minutes — process killed`);
  else if (!passed) log('system', `stage "${row.stage_id}" failed with exit code ${exitCode}`);

  broadcast({
    type: 'stage:update',
    runId,
    stage: updateStage(row.id, {
      status: passed ? 'passed' : 'failed',
      exit_code: exitCode,
      finished_at: Date.now(),
    }),
  });
  return passed ? 'passed' : 'failed';
}

// Run died before/at DAG validation: attach a system log line to the offending
// stage when we have one, mark it failed and everything else skipped.
function failRunEarly(runId, stageRows, err) {
  const message = err instanceof PipelineError ? err.message : `internal error: ${err.message}`;
  const offender = stageRows.find((s) => s.id === err.stagePk) ?? stageRows[0];
  if (offender) {
    systemLog(runId, offender, message);
  } else {
    console.error(`[emberflow] run ${runId} failed before stages were created: ${message}`);
  }
  const now = Date.now();
  for (const row of stageRows) {
    const status = row === offender ? 'failed' : 'skipped';
    broadcast({ type: 'stage:update', runId, stage: updateStage(row.id, { status, finished_at: now }) });
  }
  finishRun(runId, 'failed');
}

function systemLog(runId, stageRow, line) {
  const ts = Date.now();
  insertLog(stageRow.id, ts, 'system', line);
  broadcast({ type: 'log', runId, stageId: stageRow.stage_id, stream: 'system', line, ts });
}

function finishRun(runId, status) {
  broadcast({ type: 'run:update', run: updateRun(runId, { status, finished_at: Date.now() }) });
}

// Keep the newest N run workdirs (rollback restarts containers from them); prune the rest.
async function pruneWorkdirs() {
  let entries;
  try {
    entries = await fs.readdir(config.runsDir);
  } catch {
    return; // runs dir does not exist yet
  }
  const stats = [];
  for (const name of entries) {
    const full = path.join(config.runsDir, name);
    try {
      stats.push({ full, mtime: (await fs.stat(full)).mtimeMs });
    } catch { /* raced with another prune */ }
  }
  stats.sort((a, b) => b.mtime - a.mtime);
  for (const { full } of stats.slice(config.workdirKeep)) {
    await fs.rm(full, { recursive: true, force: true });
  }
}
