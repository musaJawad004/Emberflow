/**
 * Data shapes from docs/SPEC.md — the SQLite rows are sent as-is over
 * REST and WebSocket, so these mirror the schema column-for-column.
 */

export type RunStatus = "queued" | "running" | "passed" | "failed" | "canceled";
export type StageStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "canceled";
export type DeploymentStatus = "running" | "stopped" | "failed";
export type LogStream = "stdout" | "stderr" | "system";

export interface Run {
  id: string;
  repo_name: string;
  repo_path: string;
  repo_url: string | null; // git URL when the run was cloned (v1)
  trigger: "manual" | "webhook";
  commit_sha: string | null;
  status: RunStatus;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface Stage {
  id: string; // row primary key (nanoid)
  run_id: string;
  stage_id: string; // id from emberflow.yml, e.g. "test"
  /** JSON array stored as TEXT — use parseNeeds() instead of reading directly. */
  needs: string | string[];
  command: string;
  image: string;
  status: StageStatus;
  exit_code: number | null;
  started_at: number | null;
  finished_at: number | null;
}

/** Row shape from GET /api/runs/:id/logs */
export interface LogRow {
  id: number;
  stage_pk: string;
  ts: number;
  stream: LogStream;
  line: string;
}

/** What the log terminal actually renders (history rows + live WS events). */
export interface LogLine {
  ts: number;
  stream: LogStream;
  line: string;
}

/** Groq failure analysis for a failed run (v1, Day 3). */
export interface Analysis {
  id: string;
  run_id: string;
  model: string;
  diagnosis: string;
  created_at: number;
}

/** A deployed (or previously deployed) container (v1, Day 4). */
export interface Deployment {
  id: string;
  run_id: string;
  repo_name: string;
  container_name: string;
  image: string;
  start_cmd: string;
  port: number; // container port
  host_port: number; // published on the host → http://localhost:<host_port>
  health_path: string; // HTTP probe path used to verify the deploy (default "/")
  status: DeploymentStatus;
  rolled_back_from: string | null; // deployment id this was restored from
  created_at: number;
  stopped_at: number | null;
}

/** Server → client WebSocket events. */
export type EmberEvent =
  | { type: "hello" }
  | { type: "run:update"; run: Run }
  | { type: "stage:update"; runId: string; stage: Stage }
  | {
      type: "log";
      runId: string;
      stageId: string;
      stream: LogStream;
      line: string;
      ts: number;
    }
  | { type: "analysis"; runId: string; analysis: Analysis }
  | { type: "deployment:update"; deployment: Deployment };

/** `needs` is a JSON string in the DB; tolerate both string and array. */
export function parseNeeds(stage: Stage): string[] {
  if (Array.isArray(stage.needs)) return stage.needs;
  try {
    const parsed: unknown = JSON.parse(stage.needs);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
