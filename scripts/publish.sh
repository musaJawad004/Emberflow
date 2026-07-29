#!/usr/bin/env bash
# One-time publish: commits all work, pushes main+develop, files the 11 drafted issues.
set -u
cd "$(dirname "$0")/.."

echo "=== 1. repo check ==="
EMPTY=$(gh repo view musaJawad004/Emberflow --json isEmpty -q .isEmpty 2>&1) \
  && echo "repo exists, isEmpty=$EMPTY" \
  || { echo "REPO CHECK FAILED: $EMPTY"; exit 1; }

echo "=== 2. compose validation ==="
docker compose config -q && echo "compose config valid" || echo "COMPOSE INVALID"

echo "=== 3. commits ==="
CO="Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git add server scripts && git reset -q server/Dockerfile server/.dockerignore
git commit -q -m "feat(server): pipeline engine — DAG runner, Docker executor, queue, webhooks, deploy/rollback, Groq analyst" -m "$CO"
git add dashboard && git reset -q dashboard/Dockerfile dashboard/.dockerignore
git commit -q -m "feat(dashboard): mission-control UI — live DAG, log streaming, diagnosis, deployments" -m "$CO"
git add sample-app
git commit -q -m "feat(sample-app): example app with emberflow.yml pipeline and deploy section" -m "$CO"
git add README.md LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md docs .github .gitignore
git commit -q -m "docs: open-source docs suite, GitHub templates, CI workflow, issue drafts" -m "$CO"
git add docker-compose.yml server/Dockerfile server/.dockerignore dashboard/Dockerfile dashboard/.dockerignore
git commit -q -m "chore(compose): docker-compose stack and Dockerfiles" -m "$CO"
git log --oneline

echo "=== 4. push main + develop ==="
git remote add origin https://github.com/musaJawad004/Emberflow.git 2>/dev/null \
  || git remote set-url origin https://github.com/musaJawad004/Emberflow.git
if git push -u origin main 2>&1; then
  echo "pushed main"
else
  echo "push rejected — merging remote scaffold"
  git fetch origin main \
    && git merge --allow-unrelated-histories -X ours origin/main -m "chore: merge remote scaffold" -m "$CO" \
    && git push -u origin main && echo "pushed main after merge"
fi
git branch develop && git push -u origin develop && echo "pushed develop"

echo "=== 5. labels + issues ==="
for L in bug enhancement security performance docs "good first issue"; do
  gh label create "$L" --repo musaJawad004/Emberflow --force >/dev/null 2>&1 || true
done
for F in docs/issues/*.md; do
  TITLE=$(head -1 "$F" | sed 's/^# //')
  LABELS=$(grep -m1 '^Labels:' "$F" | sed 's/^Labels: *//' | sed 's/, */,/g')
  BODY=$(mktemp); awk 'NR>3' "$F" > "$BODY"
  URL=$(gh issue create --repo musaJawad004/Emberflow --title "$TITLE" --label "$LABELS" --body-file "$BODY" 2>&1) \
    && echo "issue: $URL" || echo "ISSUE FAILED ($F): $URL"
  rm -f "$BODY"
done
echo "=== done — https://github.com/musaJawad004/Emberflow ==="
