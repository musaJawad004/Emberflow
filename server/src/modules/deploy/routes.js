import { listDeployments } from '../../core/db.js';
import { rollbackDeployment } from './service.js';

export async function deployRoutes(fastify) {
  fastify.get('/api/deployments', async () => ({ deployments: listDeployments() }));

  fastify.post('/api/deployments/:id/rollback', async (request, reply) => {
    const deployment = await rollbackDeployment(request.params.id);
    return reply.code(202).send({ deploymentId: deployment.id });
  });
}
