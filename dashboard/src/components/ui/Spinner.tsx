/** Tiny loading ring — the `ember-spin` keyframe lives in theme/theme.css. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="loading"
      className={`ember-spin inline-block h-3.5 w-3.5 rounded-full border-2
        border-edge border-t-accent ${className}`}
    />
  );
}
