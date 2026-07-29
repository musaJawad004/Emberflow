import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/config -> src -> server
const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Tiny .env loader: KEY=VALUE lines, '#' comments, optional quotes.
// Values already present in the real environment always win.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

loadEnvFile(path.join(serverRoot, '.env'));

// The single place that reads process.env — everything else imports `config`.
export const config = {
  port: Number(process.env.EMBER_PORT ?? 4100),
  dbPath: process.env.EMBER_DB ?? path.join(serverRoot, 'data', 'emberflow.db'),
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  executor: process.env.EMBER_EXECUTOR === 'local' ? 'local' : 'docker',
  webhookSecret: process.env.EMBER_WEBHOOK_SECRET ?? '',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  groqModel: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',

  runsDir: '/tmp/emberflow-runs',
  stageTimeoutMs: 10 * 60 * 1000,
  runTimeoutMs: 30 * 60 * 1000,
  logLineCap: 5000,
  workdirKeep: 20, // run workdirs kept for rollback; older ones are pruned
};
