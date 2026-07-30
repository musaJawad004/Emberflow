# Emberflow Dashboard

The mission-control UI: live run list, animated stage DAG, streaming log
terminal, AI diagnosis card, and deployment management. Next.js (App Router) +
Tailwind v4 + @xyflow/react, TypeScript throughout.

## Run

```bash
npm install
npm run dev      # http://localhost:3100
```

| Script | What it does |
| --- | --- |
| `npm run dev` | `next dev -p 3100` |
| `npm run build` | production build (also what CI runs) |
| `npm run start` | serve the production build on :3100 |
| `npm run lint` | ESLint |

The dashboard expects the server at `http://localhost:4100` (REST) and
`ws://localhost:4100/ws` (WebSocket) — both defined in `src/lib/api.ts`.

## Module map

```
src/
  app/               routes ONLY — pages compose module components
    page.tsx             /            run list + trigger menu
    runs/[id]/page.tsx   /runs/:id    DAG + logs + diagnosis + deploy strip
    deployments/page.tsx /deployments active deployment + rollback history
    layout.tsx           header nav (Runs · Deployments), theme import
  theme/theme.css    ALL design tokens (see rules below)
  components/ui/     generic: Panel, StatusPill, Button, Spinner,
                     OfflineBanner, NavLink
  modules/
    runs/            RunList, RunRow, RunDetail (REST history + live WS
                     splicing), TriggerMenu, CancelButton
    dag/             StageDag + StageNode — the animated pipeline graph
    logs/            LogTerminal — ANSI-aware, stream-tinted, follow-on-bottom
    analyst/         DiagnosisCard — live/REST diagnosis, "skipped" fallback
    deploy/          DeploymentList, RollbackButton, DeployStrip
  lib/               types.ts (API/WS contract), api.ts (REST client + base
                     URLs), useEmberSocket.ts (auto-reconnecting WebSocket
                     hook, per-event callback), format.ts
```

## Theme token rules

`src/theme/theme.css` is the **only** place design values live. Tailwind v4
reads its `@theme` block and generates utilities (`bg-surface`, `text-muted`,
`text-running`, `border-edge`, …).

- **Never hardcode hex values in a component.** Need a new color, glow, or
  keyframe? Add a token to `theme.css` first, then use the generated utility
  (or `var(--color-*)`).
- The status palette (`queued`, `running`, `passed`, `failed`, `skipped`,
  `canceled`, `stopped`) is shared by runs, stages, and deployments — reuse it
  rather than inventing near-duplicates.
- The one deliberate exception is the log terminal's ANSI rendering, where
  colors come from the log content itself.

## Data-flow conventions

- Pages load consistent state via REST (`lib/api.ts`), then apply WebSocket
  deltas on top; WS is an accelerator, never the source of truth.
- Anything where a missed message matters (log lines!) uses the WS hook's
  per-event callback, not React state snapshots.
- Client components are marked `"use client"`; types for every API/WS payload
  live in `lib/types.ts` and mirror [docs/SPEC.md](../docs/SPEC.md).
