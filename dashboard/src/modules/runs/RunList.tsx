"use client";

import { useCallback, useEffect, useState } from "react";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Panel } from "@/components/ui/Panel";
import { fetchRuns } from "@/lib/api";
import { useEmberSocket } from "@/lib/useEmberSocket";
import type { EmberEvent, Run } from "@/lib/types";
import { RunRow } from "./RunRow";

/** Insert or replace a run by id, keeping the list newest-first. */
function mergeRun(list: Run[], run: Run): Run[] {
  const idx = list.findIndex((r) => r.id === run.id);
  const next =
    idx === -1 ? [run, ...list] : list.map((r, i) => (i === idx ? run : r));
  return next.sort((a, b) => b.created_at - a.created_at);
}

export function RunList() {
  const [runs, setRuns] = useState<Run[] | null>(null); // null = still loading
  const [fetchFailed, setFetchFailed] = useState(false);

  const handleEvent = useCallback((event: EmberEvent) => {
    if (event.type === "run:update") {
      setRuns((prev) => mergeRun(prev ?? [], event.run));
    }
  }, []);
  const { status: wsStatus } = useEmberSocket(handleEvent);

  const load = useCallback(() => {
    fetchRuns()
      .then(({ runs }) => {
        setRuns((prev) => {
          // Keep any runs that arrived over WS while the fetch was in flight.
          let merged = runs;
          for (const r of prev ?? []) {
            if (!merged.some((m) => m.id === r.id)) merged = mergeRun(merged, r);
          }
          return merged;
        });
        setFetchFailed(false);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  // Initial load + refresh whenever the socket (re)connects, so anything we
  // missed while offline gets backfilled.
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (wsStatus === "open") load();
  }, [wsStatus, load]);

  // If the REST fetch failed, keep retrying quietly.
  useEffect(() => {
    if (!fetchFailed) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [fetchFailed, load]);

  // Re-render every 30s so "2m ago" stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div>
      <OfflineBanner show={wsStatus === "reconnecting" || fetchFailed} />

      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
          Runs
        </h1>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          {wsStatus === "open" ? (
            <span className="text-passed">● live</span>
          ) : (
            <span>○ {wsStatus}</span>
          )}
        </span>
      </div>

      {runs === null && !fetchFailed && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-panel" />
          ))}
        </div>
      )}

      {runs !== null && runs.length === 0 && (
        <Panel className="px-4 py-10 text-center font-mono text-sm text-muted">
          No runs yet — hit{" "}
          <span className="text-ink">
            <span className="text-accent">▶</span> Trigger
          </span>{" "}
          and pick sample-app.
        </Panel>
      )}

      <ul className="space-y-2">
        {(runs ?? []).map((run) => (
          <li key={run.id}>
            <RunRow run={run} />
          </li>
        ))}
      </ul>
    </div>
  );
}
