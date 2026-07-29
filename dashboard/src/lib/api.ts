import type { Analysis, Deployment, LogRow, Run, Stage } from "./types";

export const API_BASE = "http://localhost:4100";
export const WS_URL = "ws://localhost:4100/ws";

/** The repo the "sample-app" trigger preset builds (resolved at build time
 *  from the repo checkout location — see next.config.ts). */
export const SAMPLE_APP_PATH =
  process.env.NEXT_PUBLIC_SAMPLE_APP_PATH ?? "../sample-app";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    // Only claim a JSON body when we actually send one.
    ...(body !== undefined && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!res.ok) throw new ApiError(res.status, `POST ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/* ---------------------------------------------------------------- runs */

export function fetchRuns(): Promise<{ runs: Run[] }> {
  return getJson("/api/runs");
}

export function fetchRun(id: string): Promise<{ run: Run; stages: Stage[] }> {
  return getJson(`/api/runs/${encodeURIComponent(id)}`);
}

export function fetchStageLogs(
  runId: string,
  stageId: string,
): Promise<{ logs: LogRow[] }> {
  const q = encodeURIComponent(stageId);
  return getJson(`/api/runs/${encodeURIComponent(runId)}/logs?stage=${q}`);
}

/**
 * POST /api/runs → the new run's id.
 * `target` is either a git URL (https://… or git@…) or a local path —
 * the server expects `{ gitUrl }` for the former and `{ localPath }` else.
 */
export async function triggerRun(target: string): Promise<string> {
  const t = target.trim();
  const isGitUrl = t.startsWith("https://") || t.startsWith("git@");
  const body = isGitUrl ? { gitUrl: t } : { localPath: t };
  const data = await postJson<{ runId: string }>("/api/runs", body);
  return data.runId;
}

/** POST /api/runs/:id/cancel — 409 if the run already finished. */
export function cancelRun(id: string): Promise<{ ok: true }> {
  return postJson(`/api/runs/${encodeURIComponent(id)}/cancel`);
}

/* ------------------------------------------------------------- analyst */

export function fetchAnalysis(
  runId: string,
): Promise<{ analysis: Analysis | null }> {
  return getJson(`/api/runs/${encodeURIComponent(runId)}/analysis`);
}

/* -------------------------------------------------------- deployments */

export function fetchDeployments(): Promise<{ deployments: Deployment[] }> {
  return getJson("/api/deployments");
}

/** POST /api/deployments/:id/rollback — 409 if the workdir was pruned. */
export function rollbackDeployment(
  id: string,
): Promise<{ deploymentId: string }> {
  return postJson(`/api/deployments/${encodeURIComponent(id)}/rollback`);
}
