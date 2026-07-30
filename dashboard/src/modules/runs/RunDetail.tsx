/**
 * @file Run-detail page container (/runs/[id]). Owns all state for one run:
 * REST-loaded run/stages/log history, live WebSocket updates layered on top,
 * stage selection, and offline recovery (refetch on socket reconnect, quiet
 * polling while the server is unreachable). Renders the DAG, deploy strip,
 * failure diagnosis, and log terminal panels.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { ApiError, fetchDeployments, fetchRun, fetchStageLogs } from "@/lib/api";
import { duration, relativeTime } from "@/lib/format";
import { useEmberSocket } from "@/lib/useEmberSocket";
import type {
  Analysis,
  Deployment,
  EmberEvent,
  LogLine,
  Run,
  Stage,
} from "@/lib/types";
import { DiagnosisCard } from "@/modules/analyst/DiagnosisCard";
import { StageDag } from "@/modules/dag/StageDag";
import { DeployStrip } from "@/modules/deploy/DeployStrip";
import { LogTerminal } from "@/modules/logs/LogTerminal";
import { CancelButton } from "./CancelButton";

/** History logs for one stage, plus the newest ts so live lines can be
 *  appended without duplicating what the fetch already returned. */
type History = { lines: LogLine[]; lastTs: number };

/**
 * Client component behind the /runs/[id] route (id read via `useParams`).
 * Log lines shown for a stage are its fetched history plus any live WS lines
 * with a newer timestamp, so lines aren't duplicated across the two sources.
 * A 404 from the run fetch renders a "not found" panel; any other failure is
 * treated as offline and retried.
 */
export function RunDetail() {
  const { id } = useParams<{ id: string }>();

  const [run, setRun] = useState<Run | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loadError, setLoadError] = useState<"none" | "offline" | "notfound">("none");

  /** Stage picked by clicking a DAG node — keyed by emberflow.yml stage id. */
  const [pickedId, setPickedId] = useState<string | null>(null);
  /** Fetched log history per stage id. */
  const [history, setHistory] = useState<Record<string, History>>({});
  /** Live log lines per stage id, collected from WS for this whole run. */
  const [wsLogs, setWsLogs] = useState<Record<string, LogLine[]>>({});

  /** Groq diagnosis pushed over WS (DiagnosisCard also fetches via REST). */
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  /** This run's deployment, from WS or the deployments API. */
  const [deployment, setDeployment] = useState<Deployment | null>(null);

  /* ------------------------------------------------ live updates over WS */

  const handleEvent = useCallback(
    (event: EmberEvent) => {
      if (event.type === "run:update" && event.run.id === id) {
        setRun(event.run);
      } else if (event.type === "stage:update" && event.runId === id) {
        setStages((prev) => {
          const idx = prev.findIndex((s) => s.id === event.stage.id);
          if (idx === -1) return [...prev, event.stage];
          const next = prev.slice();
          next[idx] = event.stage;
          return next;
        });
      } else if (event.type === "log" && event.runId === id) {
        const line: LogLine = {
          ts: event.ts,
          stream: event.stream,
          line: event.line,
        };
        setWsLogs((prev) => ({
          ...prev,
          [event.stageId]: [...(prev[event.stageId] ?? []), line],
        }));
      } else if (event.type === "analysis" && event.runId === id) {
        setAnalysis(event.analysis);
      } else if (
        event.type === "deployment:update" &&
        event.deployment.run_id === id
      ) {
        setDeployment(event.deployment);
      }
    },
    [id],
  );

  const { status: wsStatus } = useEmberSocket(handleEvent);

  /* --------------------------------------------------------- REST loading */

  const loadRun = useCallback(
    (resetLogs = false) => {
      fetchRun(id)
        .then((data) => {
          setRun(data.run);
          setStages(data.stages);
          setLoadError("none");
          if (resetLogs) {
            // Fresh REST state after a reconnect — drop cached logs so the
            // history refetch backfills anything missed while offline.
            setHistory({});
            setWsLogs({});
          }
        })
        .catch((err: unknown) => {
          setLoadError(
            err instanceof ApiError && err.status === 404 ? "notfound" : "offline",
          );
        });
    },
    [id],
  );

  // Initial load + full refresh on every socket (re)connect.
  useEffect(() => {
    loadRun();
  }, [loadRun]);
  useEffect(() => {
    if (wsStatus === "open") loadRun(true);
  }, [wsStatus, loadRun]);

  // Quiet retry while the server is unreachable.
  useEffect(() => {
    if (loadError !== "offline") return;
    const timer = setInterval(loadRun, 5000);
    return () => clearInterval(timer);
  }, [loadError, loadRun]);

  // Once the run passed, ask the deployments API whether it deployed —
  // covers opening the page after the deployment:update event already fired.
  const runStatus = run?.status;
  useEffect(() => {
    if (runStatus !== "passed") return;
    let cancelled = false;
    fetchDeployments()
      .then(({ deployments }) => {
        if (cancelled) return;
        const mine = deployments.find((d) => d.run_id === id);
        if (mine) setDeployment((prev) => prev ?? mine);
      })
      .catch(() => {
        /* offline — the WS event will still arrive on reconnect */
      });
    return () => {
      cancelled = true;
    };
  }, [id, runStatus]);

  /* ------------------------------------------------------ stage selection */

  // Selected stage: what the user clicked, or (until they click) the first
  // running stage, or the first stage.
  const selectedId = useMemo(() => {
    if (pickedId !== null && stages.some((s) => s.stage_id === pickedId)) {
      return pickedId;
    }
    const running = stages.find((s) => s.status === "running");
    return (running ?? stages[0])?.stage_id ?? null;
  }, [pickedId, stages]);

  // Fetch log history once per selected stage (cached in `history`).
  // `wsStatus` is a dep so a fetch that failed offline retries on reconnect.
  useEffect(() => {
    if (!selectedId || history[selectedId]) return;
    let cancelled = false;
    fetchStageLogs(id, selectedId)
      .then(({ logs }) => {
        if (cancelled) return;
        setHistory((prev) => ({
          ...prev,
          [selectedId]: {
            lines: logs.map((l) => ({ ts: l.ts, stream: l.stream, line: l.line })),
            lastTs: logs.length > 0 ? logs[logs.length - 1].ts : -1,
          },
        }));
      })
      .catch(() => {
        /* stays uncached; retried on reconnect */
      });
    return () => {
      cancelled = true;
    };
  }, [id, selectedId, history, wsStatus]);

  // What the terminal shows: history + live lines newer than the history.
  const terminalLines = useMemo<LogLine[]>(() => {
    if (!selectedId) return [];
    const hist = history[selectedId];
    const live = wsLogs[selectedId] ?? [];
    if (!hist) return live; // history still loading — show live output already
    return [...hist.lines, ...live.filter((l) => l.ts > hist.lastTs)];
  }, [selectedId, history, wsLogs]);

  const selectedStage = stages.find((s) => s.stage_id === selectedId) ?? null;
  const historyLoading = selectedId !== null && !history[selectedId];

  /* --------------------------------------------------------------- render */

  if (loadError === "notfound") {
    return (
      <Panel className="px-4 py-10 text-center font-mono text-sm text-muted">
        run <span className="text-failed">{id}</span> not found ·{" "}
        <Link href="/" className="text-running hover:underline">
          back to runs
        </Link>
      </Panel>
    );
  }

  const cancelable = run?.status === "queued" || run?.status === "running";

  return (
    // Fixed to the viewport (screen minus header + main padding) so the log
    // terminal scrolls internally instead of growing the page.
    <div className="flex h-[calc(100dvh-6rem)] min-h-[480px] flex-col">
      <OfflineBanner show={wsStatus === "reconnecting" || loadError === "offline"} />

      {/* run header */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/"
          className="font-mono text-xs text-muted transition-colors hover:text-ink"
        >
          ← runs
        </Link>
        <span className="text-sm text-ink">{run?.repo_name ?? "…"}</span>
        <span className="font-mono text-[10px] text-muted">{id}</span>
        {run && <StatusPill status={run.status} />}
        {cancelable && <CancelButton runId={id} />}
        {run && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-muted">
            {run.trigger}
            {run.commit_sha ? ` · ${run.commit_sha.slice(0, 7)}` : ""}
            {` · ${relativeTime(run.created_at)}`}
            {run.started_at !== null && run.finished_at !== null
              ? ` · took ${duration(run.started_at, run.finished_at)}`
              : ""}
          </span>
        )}
      </div>

      {/* panel 1 — the stage DAG */}
      <div className="mb-4 h-64 shrink-0 overflow-hidden rounded-md border border-edge bg-panel/40 md:h-72">
        <StageDag stages={stages} selectedId={selectedId} onSelect={setPickedId} />
      </div>

      {/* panel 2 — deploy result strip (only when this run deployed) */}
      {deployment && <DeployStrip deployment={deployment} />}

      {/* panel 3 — Groq diagnosis (only when the run failed) */}
      {run?.status === "failed" && <DiagnosisCard runId={id} live={analysis} />}

      {/* panel 4 — the log terminal */}
      <LogTerminal
        stage={selectedStage}
        lines={terminalLines}
        loading={historyLoading}
      />
    </div>
  );
}
