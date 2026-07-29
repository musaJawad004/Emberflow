"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SAMPLE_APP_PATH, triggerRun } from "@/lib/api";

type State = "idle" | "pending" | "error";

/**
 * Header trigger menu: fire the sample-app preset, or open "custom…" and
 * paste a git URL / local path. `triggerRun` picks the right POST body
 * ({ gitUrl } for https://… / git@…, { localPath } otherwise).
 */
export function TriggerMenu() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "custom">("menu");
  const [target, setTarget] = useState("");
  const [state, setState] = useState<State>("idle");

  // Close (and reset) when clicking anywhere outside the menu.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMode("menu");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  async function fire(t: string) {
    if (state === "pending" || t.trim() === "") return;
    setState("pending");
    try {
      const runId = await triggerRun(t);
      setState("idle");
      setOpen(false);
      setMode("menu");
      setTarget("");
      router.push(`/runs/${runId}`);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <Button variant="accent" onClick={() => setOpen((o) => !o)}>
        <span className="mr-1.5 text-accent">▶</span>
        {state === "pending" ? "Triggering…" : "Trigger"}
      </Button>

      {open && (
        <Panel className="absolute right-0 top-full z-30 mt-2 w-72 p-1.5 shadow-lg">
          {mode === "menu" ? (
            <>
              <button
                onClick={() => fire(SAMPLE_APP_PATH)}
                disabled={state === "pending"}
                className="block w-full cursor-pointer rounded px-2.5 py-2 text-left
                  transition-colors hover:bg-panel-2 disabled:cursor-wait disabled:opacity-60"
              >
                <span className="block font-mono text-xs text-ink">
                  sample-app
                </span>
                <span className="block truncate font-mono text-[10px] text-muted">
                  {SAMPLE_APP_PATH}
                </span>
              </button>
              <button
                onClick={() => setMode("custom")}
                className="block w-full cursor-pointer rounded px-2.5 py-2 text-left
                  transition-colors hover:bg-panel-2"
              >
                <span className="block font-mono text-xs text-ink">custom…</span>
                <span className="block font-mono text-[10px] text-muted">
                  git URL or local path
                </span>
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fire(target);
              }}
              className="flex flex-col gap-2 p-1"
            >
              <input
                autoFocus
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="https://…, git@…, or /path/to/repo"
                spellCheck={false}
                className="w-full rounded-md border border-edge bg-terminal px-2.5 py-1.5
                  font-mono text-xs text-ink placeholder:text-muted/60
                  focus:border-running/60 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  variant="accent"
                  disabled={state === "pending" || target.trim() === ""}
                >
                  {state === "pending" ? "Triggering…" : "Run"}
                </Button>
                <Button type="button" onClick={() => setMode("menu")}>
                  ← back
                </Button>
              </div>
            </form>
          )}

          {state === "error" && (
            <p className="px-2.5 pb-1.5 pt-1 font-mono text-[10px] text-failed">
              ✕ trigger failed — server offline or bad target?
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
