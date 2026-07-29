/** Timestamps in the DB are epoch millis; tolerate seconds just in case. */
function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

/** "just now", "42s ago", "5m ago", "3h ago", "2d ago" */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - toMs(ts));
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** "840ms", "12s", "1m 04s", "1h 02m" */
export function duration(start: number, end: number): string {
  const ms = Math.max(0, toMs(end) - toMs(start));
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "14:03:59" — gutter timestamps in the log terminal. */
export function clock(ts: number): string {
  const d = new Date(toMs(ts));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
