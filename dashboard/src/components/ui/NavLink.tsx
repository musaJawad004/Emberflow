"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Header nav link that knows when it's active.
 * `match` lists path prefixes that count as "here" — e.g. the Runs tab is
 * active on both "/" and "/runs/…".
 */
export function NavLink({
  href,
  match,
  children,
}: {
  href: string;
  match: string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = match.some((m) =>
    m === "/" ? pathname === "/" : pathname.startsWith(m),
  );
  return (
    <Link
      href={href}
      className={`font-mono text-[11px] uppercase tracking-widest transition-colors ${
        active ? "text-accent" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
