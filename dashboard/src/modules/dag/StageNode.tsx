"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { StatusDot } from "@/components/ui/StatusPill";
import type { Stage, StageStatus } from "@/lib/types";

export type StageNodeData = { stage: Stage; isSelected: boolean };
export type StageNodeType = Node<StageNodeData, "stage">;

const NODE_BORDER: Record<StageStatus, string> = {
  pending: "border-edge",
  running: "border-running/70 node-running",
  passed: "border-passed/40",
  failed: "border-failed/60",
  skipped: "border-edge border-dashed opacity-50",
  canceled: "border-canceled/50",
};

const NODE_LABEL: Record<StageStatus, string> = {
  pending: "text-queued",
  running: "text-running",
  passed: "text-passed",
  failed: "text-failed",
  skipped: "text-skipped",
  canceled: "text-canceled",
};

/** The custom React Flow node: status dot + stage id + status label. */
export function StageNode({ data }: NodeProps<StageNodeType>) {
  const { stage, isSelected } = data;
  return (
    <div
      className={`w-44 cursor-pointer rounded-md border bg-panel px-3 py-2 font-mono
        transition-colors ${NODE_BORDER[stage.status]}
        ${isSelected ? "ring-1 ring-accent/70" : ""}`}
      title={`$ ${stage.command}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1 !w-1 !border-0 !bg-transparent"
      />
      <div className="flex items-center gap-2">
        <StatusDot status={stage.status} />
        <span
          className={`truncate text-xs text-ink ${
            stage.status === "skipped" ? "line-through" : ""
          }`}
        >
          {stage.stage_id}
        </span>
      </div>
      <div
        className={`mt-1 text-[9px] uppercase tracking-[0.2em] ${NODE_LABEL[stage.status]}`}
      >
        {stage.status}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1 !w-1 !border-0 !bg-transparent"
      />
    </div>
  );
}
