"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Spinner } from "@/components/ui/Spinner";
import { fetchAnalysis } from "@/lib/api";
import type { Analysis } from "@/lib/types";

/** How long we wait for the analyst before assuming it was skipped. */
const RETRY_MS = 4000;
const MAX_TRIES = 4;

/**
 * Groq failure analysis for a failed run. The parent only renders this when
 * run.status === "failed".
 *
 * Data arrives two ways:
 *  - `live`  — pushed by the parent when an `analysis` WS event lands.
 *  - REST    — GET /api/runs/:id/analysis on load, then a few short retries
 *              (the analyst runs *after* the run fails, so its row can land
 *              seconds later — or never, if GROQ_API_KEY isn't set).
 */
export function DiagnosisCard({
  runId,
  live,
}: {
  runId: string;
  live: Analysis | null;
}) {
  const [fetched, setFetched] = useState<Analysis | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  const analysis = live ?? fetched;

  useEffect(() => {
    if (analysis) return; // already have it — stop polling
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nullReplies = 0; // only successful "no analysis" replies count

    const attempt = () => {
      fetchAnalysis(runId)
        .then(({ analysis }) => {
          if (cancelled) return;
          if (analysis) {
            setFetched(analysis);
          } else if (++nullReplies >= MAX_TRIES) {
            setGaveUp(true); // no analysis after finish → analyst was skipped
          } else {
            timer = setTimeout(attempt, RETRY_MS);
          }
        })
        .catch(() => {
          // Server unreachable — keep retrying quietly until it's back.
          if (!cancelled) timer = setTimeout(attempt, RETRY_MS);
        });
    };

    attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, analysis]);

  return (
    <Panel className="mb-4 shrink-0">
      <div className="flex items-center gap-3 border-b border-edge px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
          ◆ failure analysis
        </span>
        {analysis && (
          <span className="ml-auto font-mono text-[10px] text-muted">
            {analysis.model}
          </span>
        )}
      </div>

      <div className="ember-scroll max-h-40 overflow-y-auto px-4 py-3">
        {analysis ? (
          <div className="space-y-1 text-sm leading-relaxed">
            {analysis.diagnosis.split("\n").map((line, i) => (
              <p
                key={i}
                className={
                  line.startsWith("Likely fix:")
                    ? "text-passed"
                    : "text-ink/90"
                }
              >
                {line}
              </p>
            ))}
          </div>
        ) : gaveUp ? (
          <p className="font-mono text-xs italic text-muted">
            analyst skipped — no GROQ_API_KEY (see the run&apos;s system log)
          </p>
        ) : (
          <p className="flex items-center gap-2 font-mono text-xs text-muted">
            <Spinner /> waiting for the analyst…
          </p>
        )}
      </div>
    </Panel>
  );
}
