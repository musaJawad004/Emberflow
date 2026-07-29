import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { nanoid } from 'nanoid';
import { config } from '../../config/index.js';
import { broadcast } from '../../core/ws.js';
import { enqueueRun } from '../../core/queue.js';
import { removeRunContainers } from '../../core/docker.js';
import { insertRun, getRun, updateRun, getStagesForRun, updateStage } from '../../core/db.js';

// Fastify maps err.statusCode to the HTTP response status automatically.
function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// Creates + enqueues a run from a localPath (copy) or a gitUrl (clone).
// input: { trigger, localPath?, gitUrl?, ref?, commitSha?, repoName? }
export async function createRun(input) {
  const id = nanoid();
  let fields;

  if (input.localPath) {
    const repoPath = path.resolve(String(input.localPath));
    if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
      throw httpError(400, `path does not exist or is not a directory: ${repoPath}`);
    }
    if (!fs.existsSync(path.join(repoPath, 'emberflow.yml'))) {
      throw httpError(400, `no emberflow.yml found in ${repoPath}`);
    }
    fields = {
      repo_name: readPipelineName(repoPath) ?? path.basename(repoPath),
      repo_path: repoPath,
      repo_url: null,
      commit_sha: null,
    };
  } else if (input.gitUrl) {
    const gitUrl = String(input.gitUrl);
    if (!/^(https:\/\/|git@)/.test(gitUrl)) {
      throw httpError(400, 'gitUrl must start with https:// or git@');
    }
    fields = {
      repo_name: input.repoName ?? repoNameFromUrl(gitUrl),
      repo_path: path.join(config.runsDir, id, 'repo'), // where the clone will live
      repo_url: gitUrl,
      // holds the requested ref/sha until the clone resolves the real commit
      commit_sha: input.commitSha ?? input.ref ?? null,
    };
  } else {
    throw httpError(400, 'provide either localPath or gitUrl');
  }

  const run = insertRun({
    id,
    ...fields,
    trigger: input.trigger,
    status: 'queued',
    created_at: Date.now(),
  });
  broadcast({ type: 'run:update', run });
  await enqueueRun(run.id);
  return run;
}

// Marks the run canceled, force-removes its stage containers, and settles
// stage rows (running → canceled, pending → skipped). The runner notices the
// canceled status in the DB and stops scheduling.
export async function cancelRun(id) {
  const run = getRun(id);
  if (!run) throw httpError(404, 'run not found');
  if (run.status !== 'queued' && run.status !== 'running') {
    throw httpError(409, `run already ${run.status}`);
  }

  broadcast({ type: 'run:update', run: updateRun(id, { status: 'canceled', finished_at: Date.now() }) });
  const now = Date.now();
  for (const stage of getStagesForRun(id)) {
    if (stage.status === 'running') {
      broadcast({ type: 'stage:update', runId: id, stage: updateStage(stage.id, { status: 'canceled', finished_at: now }) });
    } else if (stage.status === 'pending') {
      broadcast({ type: 'stage:update', runId: id, stage: updateStage(stage.id, { status: 'skipped', finished_at: now }) });
    }
  }
  await removeRunContainers(id);
}

function repoNameFromUrl(gitUrl) {
  const last = gitUrl.split('/').pop() ?? '';
  return last.replace(/\.git$/, '') || 'repo';
}

function readPipelineName(repoPath) {
  try {
    return YAML.parse(fs.readFileSync(path.join(repoPath, 'emberflow.yml'), 'utf8'))?.name ?? null;
  } catch {
    return null;
  }
}
