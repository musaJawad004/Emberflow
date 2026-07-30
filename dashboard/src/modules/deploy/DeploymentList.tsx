/**
 * @file Deployments page: the active (running) deployment as a highlighted
 * card with a live uptime counter, plus a history table with rollback
 * buttons on stopped rows. Seeded via GET /api/deployments and kept fresh
 * by deployment:update WebSocket events, with offline retry + reconnect
 * backfill.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { fetchDeployments } from "@/lib/api";
import { duration, relativeTime } from "@/lib/format";
import { useEmberSocket } from "@/lib/useEmberSocket";
import type { Deployment, EmberEvent } from "@/lib/types";
import { RollbackButton } from "./RollbackButton";

/** Insert or replace a deployment by id, keeping the list newest-first. */
function mergeDeployment(list: Deployment[], d: Deployment): Deployment[] {
  const idx = list.findIndex((x) => x.id === d.id);
  const next =
    idx === -1 ? [d, ...list] : list.map((x, i) => (i === idx ? d : x));
  return next.sort((a, b) => b.created_at - a.created_at);
}

/**
 * Client component behind the /deployments route. REST and WS updates are
 * merged by deployment id (newest-first) so neither source clobbers the
 * other, and a 1s tick keeps the active deployment's uptime counting up.
 */
export function DeploymentList() {
  const [deployments, setDeployments] = useState<Deployment[] | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  const handleEvent = useCallback((event: EmberEvent) => {
    if (event.type === "deployment:update") {
      setDeployments((prev) => mergeDeployment(prev ?? [], event.deployment));
    }
  }, []);
  const { status: wsStatus } = useEmberSocket(handleEvent);

  const load = useCallback(() => {
    fetchDeployments()
      .then(({ deployments }) => {
        setDeployments((prev) => {
          // Keep anything that arrived over WS while the fetch was in flight.
          let merged = deployments;
          for (const d of prev ?? []) {
            if (!merged.some((m) => m.id === d.id))
              merged = mergeDeployment(merged, d);
          }
          return merged;
        });
        setFetchFailed(false);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  // Initial load + refresh on every socket (re)connect (offline backfill).
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (wsStatus === "open") load();
  }, [wsStatus, load]);

  // Quiet retry while the server is unreachable.
  useEffect(() => {
    if (!fetchFailed) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [fetchFailed, load]);

  // Tick every second so the active deployment's uptime counts up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const active = deployments?.find((d) => d.status === "running") ?? null;

  return (
    <div>
      <OfflineBanner show={wsStatus === "reconnecting" || fetchFailed} />

      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
          Deployments
        </h1>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          {wsStatus === "open" ? (
            <span className="text-passed">● live</span>
          ) : (
            <span>○ {wsStatus}</span>
          )}
        </span>
      </div>

      {deployments === null && !fetchFailed && (
        <div className="space-y-2">
          <div className="h-28 animate-pulse rounded-md bg-panel" />
          <div className="h-12 animate-pulse rounded-md bg-panel" />
        </div>
      )}

      {deployments !== null && deployments.length === 0 && (
        <Panel className="px-4 py-10 text-center font-mono text-sm text-muted">
          Nothing deployed yet — a <span className="text-passed">passed</span>{" "}
          run whose emberflow.yml has a{" "}
          <span className="text-ink">deploy</span> section lands here.
        </Panel>
      )}

      {/* --------------------------------------------- active deployment */}
      {active && (
        <Panel className="deploy-glow mb-6 border-passed/30 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="glow-dot h-2 w-2 rounded-full bg-passed text-passed" />
            <span className="text-sm text-ink">{active.repo_name}</span>
            <StatusPill status={active.status} />
            <a
              href={`http://localhost:${active.host_port}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-passed hover:underline"
            >
              localhost:{active.host_port} ↗
            </a>
            <span className="ml-auto font-mono text-xs text-muted">
              up {duration(active.created_at, now)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-muted">
            <span>{active.image}</span>
            <span className="truncate">$ {active.start_cmd}</span>
            <Link
              href={`/runs/${active.run_id}`}
              className="transition-colors hover:text-ink"
            >
              run {active.run_id.slice(0, 8)} →
            </Link>
            {active.rolled_back_from && (
              <span className="text-canceled">
                ↩ restored from {active.rolled_back_from.slice(0, 8)}
              </span>
            )}
          </div>
        </Panel>
      )}

      {/* ------------------------------------------------------- history */}
      {deployments !== null && deployments.length > 0 && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-edge font-mono text-[10px] uppercase tracking-widest text-muted">
                <th className="px-4 py-2 font-normal">status</th>
                <th className="px-4 py-2 font-normal">repo</th>
                <th className="hidden px-4 py-2 font-normal sm:table-cell">run</th>
                <th className="px-4 py-2 font-normal">port</th>
                <th className="hidden px-4 py-2 font-normal sm:table-cell">started</th>
                <th className="hidden px-4 py-2 font-normal sm:table-cell">lived</th>
                <th className="px-4 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-edge/60 text-xs last:border-b-0"
                >
                  <td className="px-4 py-2.5">
                    <StatusPill status={d.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="block text-ink">{d.repo_name}</span>
                    {d.rolled_back_from && (
                      <span className="block font-mono text-[10px] text-canceled">
                        ↩ from {d.rolled_back_from.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 font-mono text-muted sm:table-cell">
                    <Link
                      href={`/runs/${d.run_id}`}
                      className="transition-colors hover:text-ink"
                    >
                      {d.run_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-muted">
                    {d.host_port}
                  </td>
                  <td className="hidden px-4 py-2.5 font-mono text-muted sm:table-cell">
                    {relativeTime(d.created_at, now)}
                  </td>
                  <td className="hidden px-4 py-2.5 font-mono text-muted sm:table-cell">
                    {d.stopped_at !== null
                      ? duration(d.created_at, d.stopped_at)
                      : duration(d.created_at, now)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {d.status === "stopped" && (
                      <RollbackButton deploymentId={d.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
