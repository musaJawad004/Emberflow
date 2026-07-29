import { Queue, Worker } from 'bullmq';
import { config } from '../config/index.js';
import { runPipeline } from '../modules/pipeline/runner.js';
import { getRun, updateRun } from './db.js';
import { broadcast } from './ws.js';

const url = new URL(config.redisUrl);
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  maxRetriesPerRequest: null, // required by BullMQ for blocking connections
};

export const runQueue = new Queue('emberflow-runs', { connection });

export function enqueueRun(runId) {
  return runQueue.add('run', { runId }, { removeOnComplete: 100, removeOnFail: 100 });
}

export function startWorker() {
  const worker = new Worker('emberflow-runs', (job) => runPipeline(job.data.runId), { connection });

  // Safety net: runPipeline handles its own errors, but if the job itself
  // blows up, make sure the run doesn't stay stuck in queued/running.
  worker.on('failed', (job, err) => {
    console.error(`[emberflow] job for run ${job?.data?.runId} failed:`, err);
    const run = job?.data?.runId ? getRun(job.data.runId) : null;
    if (run && (run.status === 'queued' || run.status === 'running')) {
      broadcast({ type: 'run:update', run: updateRun(run.id, { status: 'failed', finished_at: Date.now() }) });
    }
  });
  return worker;
}
