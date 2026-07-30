// Tiny HTTP server the deploy stage runs. /health returns { ok: true } for
// health checks; every other path returns app info, a demo add(2, 3) result,
// and the build metadata from dist/build-info.json when the build stage ran.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { add } from './calc.js';

const port = Number(process.env.PORT || 8080);

createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') {
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const buildInfo = existsSync('dist/build-info.json')
    ? JSON.parse(readFileSync('dist/build-info.json', 'utf8'))
    : null;
  res.end(JSON.stringify({
    app: 'sample-app',
    message: `2 + 3 = ${add(2, 3)}`,
    build: buildInfo,
  }, null, 2));
}).listen(port, () => console.log(`sample-app listening on :${port}`));
