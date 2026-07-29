import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import type { Deployment } from "@/lib/types";

const STRIP_TONE: Record<Deployment["status"], string> = {
  running: "border-passed/30 bg-passed/5",
  failed: "border-failed/30 bg-failed/5",
  stopped: "border-edge bg-panel",
};

/**
 * One-line strip on the run detail page when this run produced a deployment.
 */
export function DeployStrip({ deployment }: { deployment: Deployment }) {
  return (
    <div
      className={`mb-4 flex shrink-0 flex-wrap items-center gap-3 rounded-md
        border px-4 py-2 font-mono text-xs ${STRIP_TONE[deployment.status]}`}
    >
      <span className="uppercase tracking-[0.25em] text-muted">▲ deploy</span>
      <StatusPill status={deployment.status} />
      <span className="text-ink">{deployment.repo_name}</span>
      {deployment.status === "running" && (
        <a
          href={`http://localhost:${deployment.host_port}`}
          target="_blank"
          rel="noreferrer"
          className="text-passed hover:underline"
        >
          localhost:{deployment.host_port} ↗
        </a>
      )}
      <Link
        href="/deployments"
        className="ml-auto text-muted transition-colors hover:text-ink"
      >
        view deployments →
      </Link>
    </div>
  );
}
