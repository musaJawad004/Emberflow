// Bootstrap only: config → db → queue → http. All feature logic lives in modules/.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config/index.js';
import db from './core/db.js';
import { registerWsRoute, closeAllClients } from './core/ws.js';
import { runQueue, startWorker } from './core/queue.js';
import { runRoutes } from './modules/runs/routes.js';
import { webhookRoutes } from './modules/webhook/routes.js';
import { deployRoutes } from './modules/deploy/routes.js';

const app = Fastify({ logger: false });

await app.register(cors, { origin: 'http://localhost:3100' });
await app.register(websocket);
await app.register(runRoutes);
await app.register(webhookRoutes);
await app.register(deployRoutes);
registerWsRoute(app);

const worker = startWorker();

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`[emberflow] server listening on http://localhost:${config.port} (executor: ${config.executor})`);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[emberflow] shutting down…');
  await worker.close();
  await runQueue.close();
  closeAllClients();
  await app.close();
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
