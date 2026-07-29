"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ApiError, rollbackDeployment } from "@/lib/api";

/**
 * POST /api/deployments/:id/rollback for a stopped deployment.
 * Success arrives as `deployment:update` WS events, so this button doesn't
 * touch the list itself. 409 = the run's workdir was pruned (only the last
 * 20 are kept), so there's nothing left to restart.
 */
export function RollbackButton({ deploymentId }: { deploymentId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await rollbackDeployment(deploymentId);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "workdir pruned — can't roll back"
          : "rollback failed",
      );
      setTimeout(() => setError(null), 4000);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button onClick={onClick} disabled={pending} className="px-2 py-1">
        ↩ {pending ? "rolling back…" : "rollback"}
      </Button>
      {error && (
        <span className="font-mono text-[10px] text-failed">{error}</span>
      )}
    </span>
  );
}
