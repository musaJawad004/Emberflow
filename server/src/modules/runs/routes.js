import { config } from '../../config/index.js';
import { getRun, listRuns, getStagesForRun, getLogsForRun, getAnalysisForRun } from '../../core/db.js';
import { createRun, cancelRun } from './service.js';

export async function runRoutes(fastify) {
  fastify.get('/api/health', async () => ({ ok: true, executor: config.executor }));

  fastify.post('/api/runs', async (request, reply) => {
    const { localPath, gitUrl, ref } = request.body ?? {};
    const run = await createRun({ trigger: 'manual', localPath, gitUrl, ref });
    return reply.code(202).send({ runId: run.id });
  });

  fastify.get('/api/runs', async () => ({ runs: listRuns(50) }));

  fastify.get('/api/runs/:id', async (request, reply) => {
    const run = getRun(request.params.id);
    if (!run) return reply.code(404).send({ message: 'run not found' });
    return { run, stages: getStagesForRun(run.id) };
  });

  fastify.get('/api/runs/:id/logs', async (request, reply) => {
    const run = getRun(request.params.id);
    if (!run) return reply.code(404).send({ message: 'run not found' });
    return { logs: getLogsForRun(run.id, request.query.stage) };
  });

  fastify.post('/api/runs/:id/cancel', async (request) => {
    await cancelRun(request.params.id);
    return { ok: true };
  });

  fastify.get('/api/runs/:id/analysis', async (request, reply) => {
    const run = getRun(request.params.id);
    if (!run) return reply.code(404).send({ message: 'run not found' });
    return { analysis: getAnalysisForRun(run.id) ?? null };
  });
}
