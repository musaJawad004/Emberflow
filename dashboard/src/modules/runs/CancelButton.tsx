"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ApiError, cancelRun } from "@/lib/api";

/**
 * POST /api/runs/:id/cancel. Only rendered while the run is queued/running —
 * the `run:update` WS event flips the status to `canceled` and the parent
 * unmounts this button. 409 means the run finished before we clicked.
 */
export function CancelButton({ runId }: { runId: string }) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function onClick() {
    if (pending) return;
    setPending(true);
    setNote(null);
    try {
      await cancelRun(runId);
    } catch (err) {
      setNote(
        err instanceof ApiError && err.status === 409
          ? "already finished"
          : "cancel failed — server offline?",
      );
      setTimeout(() => setNote(null), 3000);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="danger" onClick={onClick} disabled={pending}>
        ✕ {pending ? "canceling…" : "cancel"}
      </Button>
      {note && (
        <span className="font-mono text-[10px] text-failed">{note}</span>
      )}
    </span>
  );
}
