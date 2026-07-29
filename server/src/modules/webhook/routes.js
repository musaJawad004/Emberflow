import { config } from '../../config/index.js';
import { createRun } from '../runs/service.js';
import { verifySignature, parsePush } from './github.js';

// GitHub push-event receiver. Note: GitHub cannot reach a local machine
// directly — use a tunnel (ngrok etc.) for real webhooks, or test with curl.
export async function webhookRoutes(fastify) {
  // HMAC must be computed over the raw bytes, so within this plugin JSON
  // bodies are kept as a Buffer instead of being parsed (encapsulated scope).
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body));

  fastify.post('/webhook/github', async (request, reply) => {
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from(JSON.stringify(request.body ?? {}));

    if (config.webhookSecret) {
      if (!verifySignature(config.webhookSecret, rawBody, request.headers['x-hub-signature-256'])) {
        return reply.code(401).send({ message: 'invalid signature' });
      }
    } else {
      console.warn('[emberflow] webhook accepted WITHOUT verification — set EMBER_WEBHOOK_SECRET');
    }

    if (request.headers['x-github-event'] !== 'push') {
      return reply.code(200).send({ ignored: true });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return reply.code(400).send({ message: 'invalid JSON payload' });
    }
    const push = parsePush(payload);
    if (!push) return reply.code(400).send({ message: 'payload has no repository.clone_url' });

    const run = await createRun({
      trigger: 'webhook',
      gitUrl: push.cloneUrl,
      commitSha: push.sha ?? push.ref,
      repoName: push.repoName,
    });
    return reply.code(202).send({ runId: run.id });
  });
}
