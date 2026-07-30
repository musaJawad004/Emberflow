/**
 * Stage executor: runs a single stage command either in a docker container
 * with the workdir mounted at /app (default), or directly on the host when
 * EMBER_EXECUTOR=local. Enforces the per-stage timeout and streams whole
 * output lines back to the runner.
 */
import { spawn } from 'node:child_process';
import { config } from '../../config/index.js';
import { removeContainer } from '../../core/docker.js';

// Runs one stage command and streams output line-by-line via onLine(stream, line).
// Resolves { exitCode, timedOut } — never rejects (spawn errors surface as system lines).
// The docker container is NAMED so cancel/timeout can `docker rm -f` it.
/**
 * @param {{command: string, image: string, workdir: string, containerName: string,
 *   onLine: (stream: 'stdout'|'stderr'|'system', line: string) => void}} opts
 * @returns {Promise<{exitCode: number, timedOut: boolean}>}
 */
export function executeStage({ command, image, workdir, containerName, onLine }) {
  const proc = config.executor === 'docker'
    ? spawn('docker', [
        'run', '--rm', '--name', containerName,
        '-v', `${workdir}:/app`, '-w', '/app',
        image, 'sh', '-c', command,
      ])
    : spawn('sh', ['-c', command], { cwd: workdir });

  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
      // Killing the docker CLI client does not stop the container itself.
      if (config.executor === 'docker') removeContainer(containerName);
    }, config.stageTimeoutMs);

    // Buffer partial chunks so onLine always receives whole lines.
    const buffers = { stdout: '', stderr: '' };
    const consume = (stream, chunk) => {
      buffers[stream] += chunk;
      const lines = buffers[stream].split('\n');
      buffers[stream] = lines.pop(); // last piece may be an incomplete line
      for (const line of lines) onLine(stream, line.replace(/\r$/, ''));
    };
    proc.stdout.on('data', (chunk) => consume('stdout', chunk.toString()));
    proc.stderr.on('data', (chunk) => consume('stderr', chunk.toString()));

    proc.on('error', (err) => {
      clearTimeout(timer);
      onLine('system', `failed to start command: ${err.message}`);
      resolve({ exitCode: -1, timedOut: false });
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      for (const stream of ['stdout', 'stderr']) {
        if (buffers[stream]) onLine(stream, buffers[stream]);
      }
      resolve({ exitCode: code ?? (signal ? -1 : 0), timedOut });
    });
  });
}
