#!/usr/bin/env bash
# Emberflow demo helper — checks prerequisites and prints the commands to run.
# This script starts nothing itself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${EMBER_PORT:-4100}"

echo "Emberflow demo — prerequisite checks"
echo "--------------------------------"

if docker info >/dev/null 2>&1; then
  echo "  [ok] docker daemon is running"
else
  echo "  [!!] docker daemon is NOT running — start Docker Desktop first"
fi

if command -v redis-cli >/dev/null 2>&1 && [ "$(redis-cli -p 6379 ping 2>/dev/null)" = "PONG" ]; then
  echo "  [ok] redis is answering on :6379"
elif (exec 3<>/dev/tcp/127.0.0.1/6379) 2>/dev/null; then
  exec 3>&- 3<&-
  echo "  [ok] something is listening on :6379 (assuming redis)"
else
  echo "  [!!] redis is NOT reachable on :6379 — e.g. run: docker run -d -p 6379:6379 redis:7"
fi

cat <<EOF

Start the pieces (each in its own terminal):
--------------------------------------------
  1. cd $ROOT/server    && npm start        # API + worker on :$PORT
  2. cd $ROOT/dashboard && npm run dev      # dashboard on :3100
  3. open http://localhost:3100             # mission control

Trigger a PASSING run (lint+test+build, then deploys to :8200):
  curl -s -X POST localhost:$PORT/api/runs -H 'content-type: application/json' -d '{"localPath":"$ROOT/sample-app"}'

Trigger a FAILING run (temp copy with a broken test — build gets skipped, analyst fires):
  rm -rf /tmp/emberflow-demo-broken && cp -R $ROOT/sample-app /tmp/emberflow-demo-broken && printf '\ntest("broken on purpose", () => assert.equal(1, 2));\n' >> /tmp/emberflow-demo-broken/src/calc.test.js && curl -s -X POST localhost:$PORT/api/runs -H 'content-type: application/json' -d '{"localPath":"/tmp/emberflow-demo-broken"}'

Show the deployment:
  curl -s localhost:$PORT/api/deployments
  curl -s localhost:8200/health
EOF
