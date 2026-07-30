import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from '../../config/index.js';
import { broadcast } from '../../core/ws.js';
import {
  getDeployment, updateDeployment, insertDeployment,
  getRunningDeployment, getStagesForRun, insertLog,
} from '../../core/db.js';
import {
  runCommand, deployContainerName, removeContainer,
  isContainerRunning, containerLogs,
} from '../../core/docker.js';

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// Called by the runner when a run passed and emberflow.yml has a deploy section.
export async function deployRun(run, deploy, workdir) {
  // Belt and braces: the run passed, so every deploy.needs stage passed too.
  const stages = getStagesForRun(run.id);
  const allNeedsPassed = deploy.needs.every(
    (need) => stages.find((s) => s.stage_id === need)?.status === 'passed',
  );
  if (!allNeedsPassed) return null;

  await stopCurrentDeployment(run.repo_name);
  return startDeployment({
    runId: run.id,
    repoName: run.repo_name,
    image: deploy.image,
    startCmd: deploy.start,
    port: deploy.port,
    hostPort: deploy.hostPort,
    healthPath: deploy.healthPath,
    workdir,
    rolledBackFrom: null,
  });
}

// Restores a previously stopped deployment from its retained run workdir.
export async function rollbackDeployment(deploymentId) {
  const target = getDeployment(deploymentId);
  if (!target) throw httpError(404, 'deployment not found');
  if (target.status !== 'stopped') {
    throw httpError(409, `can only roll back to a stopped deployment (this one is ${target.status})`);
  }
  const workdir = path.join(config.runsDir, target.run_id, 'repo');
  if (!fs.existsSync(workdir)) {
    throw httpError(409, 'workdir for that deployment has been pruned');
  }

  await stopCurrentDeployment(target.repo_name);
  return startDeployment({
    runId: target.run_id,
    repoName: target.repo_name,
    image: target.image,
    startCmd: target.start_cmd,
    port: target.port,
    hostPort: target.host_port,
    healthPath: target.health_path ?? '/',
    workdir,
    rolledBackFrom: target.id,
  });
}

async function stopCurrentDeployment(repoName) {
  const current = getRunningDeployment(repoName);
  if (!current) return;
  await removeContainer(current.container_name);
  broadcast({
    type: 'deployment:update',
    deployment: updateDeployment(current.id, { status: 'stopped', stopped_at: Date.now() }),
  });
}

// Starts the container, probes its published port over HTTP until the app
// answers, then records the deployment as running or failed (probe progress
// and failure details land in the run's system logs).
async function startDeployment({ runId, repoName, image, startCmd, port, hostPort, healthPath, workdir, rolledBackFrom }) {
  const containerName = deployContainerName(repoName);
  await removeContainer(containerName); // clear any orphan holding the name

  const result = await runCommand('docker', [
    'run', '-d', '--name', containerName,
    '-p', `${hostPort}:${port}`,
    '-v', `${workdir}:/app`, '-w', '/app',
    image, 'sh', '-c', startCmd,
  ]);

  const running = result.code === 0
    && await probeHealth({ runId, containerName, hostPort, healthPath });

  if (!running) {
    const detail = result.code !== 0
      ? [result.stderr.trim()]
      : await containerLogs(containerName, 50);
    logDeployFailure(runId, detail);
    await removeContainer(containerName);
  }

  const deployment = insertDeployment({
    id: nanoid(),
    run_id: runId,
    repo_name: repoName,
    container_name: containerName,
    image,
    start_cmd: startCmd,
    port,
    host_port: hostPort,
    health_path: healthPath,
    status: running ? 'running' : 'failed',
    rolled_back_from: rolledBackFrom,
    created_at: Date.now(),
  });
  broadcast({ type: 'deployment:update', deployment });
  return deployment;
}

// Polls http://127.0.0.1:<hostPort><healthPath>; any HTTP status < 400 counts
// as healthy. A container that exited fast-fails the probe between attempts.
async function probeHealth({ runId, containerName, hostPort, healthPath }) {
  const url = `http://127.0.0.1:${hostPort}${healthPath}`;
  const attempts = config.deployProbeAttempts;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!(await isContainerRunning(containerName))) {
      logDeploySystem(runId, `health probe aborted — container exited (attempt ${attempt}/${attempts})`);
      return false;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 400) {
        logDeploySystem(runId, `health probe passed: HTTP ${res.status} from ${url} (attempt ${attempt}/${attempts})`);
        return true;
      }
      logDeploySystem(runId, `health probe ${attempt}/${attempts}: HTTP ${res.status} from ${url}`);
    } catch (err) {
      logDeploySystem(runId, `health probe ${attempt}/${attempts}: ${err.cause?.code ?? err.name}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.deployProbeIntervalMs));
  }
  logDeploySystem(runId, `health probe failed after ${attempts} attempts: ${url}`);
  return false;
}

// Deploy events become system log lines on the run's last stage.
function logDeploySystem(runId, line) {
  const stages = getStagesForRun(runId);
  const anchor = stages[stages.length - 1];
  if (!anchor) return;
  const ts = Date.now();
  insertLog(anchor.id, ts, 'system', line);
  broadcast({ type: 'log', runId, stageId: anchor.stage_id, stream: 'system', line, ts });
}

function logDeployFailure(runId, lines) {
  for (const line of ['deploy failed — container is not running:', ...lines.filter(Boolean)]) {
    logDeploySystem(runId, line);
  }
}
