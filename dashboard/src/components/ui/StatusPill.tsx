import type { DeploymentStatus, RunStatus, StageStatus } from "@/lib/types";

/** Every status a pill can show — runs, stages and deployments share it. */
export type PillStatus = RunStatus | StageStatus | DeploymentStatus;

const COLOR: Record<PillStatus, string> = {
  queued: "text-queued",
  pending: "text-queued",
  running: "text-running",
  passed: "text-passed",
  failed: "text-failed",
  skipped: "text-skipped",
  canceled: "text-canceled", // grey-orange
  stopped: "text-stopped",
};

/**
 * Small mono status pill with a glowing dot.
 * The dot pulses while the status is `running`.
 */
export function StatusPill({ status }: { status: PillStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-edge
        bg-panel px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest
        ${COLOR[status]}`}
    >
      <StatusDot status={status} />
      {status}
    </span>
  );
}

/** Just the glowing dot — used inside DAG nodes. */
export function StatusDot({ status }: { status: PillStatus }) {
  return (
    <span
      className={`glow-dot h-1.5 w-1.5 shrink-0 rounded-full bg-current ${
        status === "running" ? "animate-pulse" : ""
      } ${COLOR[status]}`}
    />
  );
}
