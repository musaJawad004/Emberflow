import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import { duration, relativeTime } from "@/lib/format";
import type { Run } from "@/lib/types";

/** One row in the run list — the whole row links to the run detail page. */
export function RunRow({ run }: { run: Run }) {
  return (
    <Link
      href={`/runs/${run.id}`}
      className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-x-4 rounded-md
        border border-edge bg-panel px-4 py-3 transition-colors
        hover:border-running/40 hover:bg-panel-2 sm:grid-cols-[6.5rem_1fr_5rem_6rem_5rem]"
    >
      <StatusPill status={run.status} />
      <span className="min-w-0">
        <span className="block truncate text-sm text-ink">{run.repo_name}</span>
        <span className="block truncate font-mono text-[10px] text-muted">
          {run.id}
          {run.commit_sha ? ` · ${run.commit_sha.slice(0, 7)}` : ""}
        </span>
      </span>
      <span className="hidden font-mono text-xs text-muted sm:block">
        {run.trigger}
      </span>
      <span className="hidden text-right font-mono text-xs text-muted sm:block">
        {relativeTime(run.created_at)}
      </span>
      <span className="text-right font-mono text-xs text-ink">
        {run.finished_at !== null && run.started_at !== null
          ? duration(run.started_at, run.finished_at)
          : "—"}
      </span>
    </Link>
  );
}
