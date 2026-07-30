/**
 * @file Terminal-style log viewer for a single stage. Renders ANSI-colored
 * lines (via anser, no innerHTML), tints stderr/system streams, and
 * auto-follows new output until the user scrolls up.
 */
"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import Anser from "anser";
import { StatusPill } from "@/components/ui/StatusPill";
import { clock } from "@/lib/format";
import type { LogLine, LogStream, Stage } from "@/lib/types";

/** Base tint per stream — ANSI colors in the line itself override it. */
const STREAM_CLASS: Record<LogStream, string> = {
  stdout: "text-ink/90",
  stderr: "text-failed/90",
  system: "italic text-accent/60",
};

/**
 * Render one line's ANSI escapes as styled <span>s via anser.
 * Only `entry.content` (plain text) ever reaches the DOM, as a React text
 * child — no dangerouslySetInnerHTML anywhere.
 */
const AnsiLine = memo(function AnsiLine({ line }: { line: string }) {
  const entries = Anser.ansiToJson(line, {
    use_classes: false,
    remove_empty: true,
  });
  return (
    <>
      {entries.map((entry, i) => {
        const style: CSSProperties = {};
        if (entry.fg) style.color = `rgb(${entry.fg})`;
        if (entry.bg) style.backgroundColor = `rgb(${entry.bg})`;
        if (entry.decorations.includes("bold")) style.fontWeight = 700;
        if (entry.decorations.includes("dim")) style.opacity = 0.6;
        if (entry.decorations.includes("italic")) style.fontStyle = "italic";
        if (entry.decorations.includes("underline"))
          style.textDecoration = "underline";
        return (
          <span key={i} style={style}>
            {entry.content}
          </span>
        );
      })}
    </>
  );
});

/**
 * The log panel on the run-detail page. Purely presentational: the parent
 * supplies the merged history + live `lines` for the selected `stage`.
 * Scroll position "pins" to the bottom while the user is near it; scrolling
 * up unpins and shows a "follow" button to resume tailing.
 */
export function LogTerminal({
  stage,
  lines,
  loading,
}: {
  stage: Stage | null; // selected stage, for the header
  lines: LogLine[];
  loading: boolean; // history fetch in flight
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new output only while the user is at (or near) the bottom.
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [lines, pinned]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setPinned(atBottom);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-edge bg-terminal">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-edge bg-panel px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-edge" />
          <span className="h-2 w-2 rounded-full bg-edge" />
          <span className="h-2 w-2 rounded-full bg-edge" />
        </span>
        {stage ? (
          <>
            <span className="font-mono text-xs text-ink">{stage.stage_id}</span>
            <StatusPill status={stage.status} />
            <span className="hidden min-w-0 flex-1 truncate text-right font-mono text-[10px] text-muted sm:block">
              $ {stage.command}
            </span>
          </>
        ) : (
          <span className="font-mono text-xs text-muted">no stage selected</span>
        )}
      </div>

      {/* log body */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="ember-scroll min-h-0 flex-1 overflow-y-auto py-2 font-mono text-xs leading-relaxed"
      >
        {loading && lines.length === 0 && (
          <p className="px-3 text-muted">loading logs…</p>
        )}
        {!loading && lines.length === 0 && (
          <p className="px-3 text-muted">
            {stage ? "no output yet" : "select a stage in the graph above"}
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} className="flex gap-3 px-3 hover:bg-white/[0.03]">
            <span className="w-16 shrink-0 select-none text-right text-[10px] leading-[1.7] text-muted/60">
              {clock(l.ts)}
            </span>
            <span
              className={`min-w-0 flex-1 break-all whitespace-pre-wrap ${STREAM_CLASS[l.stream]}`}
            >
              <AnsiLine line={l.line} />
            </span>
          </div>
        ))}
      </div>

      {/* resume-follow affordance when the user has scrolled up */}
      {!pinned && (
        <button
          onClick={() => setPinned(true)}
          className="absolute right-4 bottom-3 cursor-pointer rounded-full border border-edge
            bg-panel px-3 py-1 font-mono text-[10px] text-muted transition-colors
            hover:border-running/60 hover:text-running"
        >
          ↓ follow
        </button>
      )}
    </div>
  );
}
