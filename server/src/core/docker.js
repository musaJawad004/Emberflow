/**
 * Docker CLI helpers shared by the pipeline executor and the deploy module:
 * generic command running, container naming, force-removal, liveness checks,
 * and log tailing. All operations shell out to the `docker` binary.
 */
import { spawn } from 'node:child_process';

// Shared docker helpers. Every child process uses spawn with an argument
// array — user input is never interpolated into a shell string.

// Runs a command to completion, collecting output. Never rejects.
export function runCommand(cmd, args) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err.message) }));
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

// Docker names only allow [a-zA-Z0-9_.-]; anything else becomes '-'.
function safeName(part) {
  return String(part).replace(/[^a-zA-Z0-9_.-]/g, '-');
}

/** Container name for one pipeline stage: ember-<runId>-<stageId>. */
export function stageContainerName(runId, stageId) {
  return `ember-${safeName(runId)}-${safeName(stageId)}`;
}

/** Stable per-repo deploy container name: ember-deploy-<repoName>. */
export function deployContainerName(repoName) {
  return `ember-deploy-${safeName(repoName)}`;
}

/** Force-removes a single container (`docker rm -f`). */
export function removeContainer(name) {
  return runCommand('docker', ['rm', '-f', name]);
}

// Force-removes every stage container belonging to one run (ember-<runId>-*).
export async function removeRunContainers(runId) {
  const prefix = `ember-${safeName(runId)}-`;
  const { stdout } = await runCommand('docker', ['ps', '-aq', '--filter', `name=${prefix}`]);
  const ids = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (ids.length > 0) await runCommand('docker', ['rm', '-f', ...ids]);
  return ids.length;
}

/** True when `docker inspect` reports the container's state as running. */
export async function isContainerRunning(name) {
  const { code, stdout } = await runCommand('docker', ['inspect', '-f', '{{.State.Running}}', name]);
  return code === 0 && stdout.trim() === 'true';
}

/** Last `tail` lines of a container's combined stdout+stderr, as an array. */
export async function containerLogs(name, tail = 50) {
  const { stdout, stderr } = await runCommand('docker', ['logs', '--tail', String(tail), name]);
  return (stdout + stderr).split('\n').filter(Boolean);
}
