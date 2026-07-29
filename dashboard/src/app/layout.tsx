import type { Metadata } from "next";
import Link from "next/link";
import "../theme/theme.css";
import { NavLink } from "@/components/ui/NavLink";
import { TriggerMenu } from "@/modules/runs/TriggerMenu";

export const metadata: Metadata = {
  title: "Emberflow · mission control",
  description: "Self-hosted CI/CD dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 border-b border-edge bg-panel/70 backdrop-blur">
          <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-4">
            <Link href="/" className="group flex items-baseline gap-2.5">
              <span className="glow-dot inline-block h-2 w-2 rounded-[2px] bg-accent text-accent" />
              <span className="font-mono text-sm font-semibold tracking-[0.35em] text-ink group-hover:text-accent">
                EMBERFLOW
              </span>
              <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted sm:inline">
                mission control
              </span>
            </Link>
            <nav className="flex items-center gap-3">
              <NavLink href="/" match={["/", "/runs"]}>
                Runs
              </NavLink>
              <span className="text-muted/50">·</span>
              <NavLink href="/deployments" match={["/deployments"]}>
                Deployments
              </NavLink>
            </nav>
            <div className="ml-auto">
              <TriggerMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
