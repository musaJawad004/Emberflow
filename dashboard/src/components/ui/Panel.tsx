import type { ReactNode } from "react";

/** The standard raised card: hairline border on a panel background. */
export function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-md border border-edge bg-panel ${className}`}>
      {children}
    </div>
  );
}
