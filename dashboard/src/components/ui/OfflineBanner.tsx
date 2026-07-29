/**
 * Shown when the WebSocket is down or a REST fetch failed.
 * Both paths retry automatically, so this is purely informational.
 */
export function OfflineBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      className="mb-4 flex items-center gap-2 rounded-md border
        border-failed/30 bg-failed/5 px-3 py-2 font-mono text-xs text-failed"
    >
      <span className="glow-dot h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      server offline — retrying…
    </div>
  );
}
