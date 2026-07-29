"use client";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { parseNeeds, type Stage } from "@/lib/types";
import { StageNode, type StageNodeType } from "./StageNode";

/* ---------------------------------------------------------------- layout */

const COL_W = 230; // horizontal gap between dependency layers
const ROW_H = 96; // vertical gap between nodes in the same layer

/**
 * Dependency depth of each stage: 0 for stages with no `needs`, otherwise
 * 1 + the deepest stage it depends on. Depth becomes the x column.
 */
function computeDepths(stages: Stage[]): Map<string, number> {
  const byId = new Map(stages.map((s) => [s.stage_id, s]));
  const depths = new Map<string, number>();

  const depthOf = (stageId: string, trail: Set<string>): number => {
    const known = depths.get(stageId);
    if (known !== undefined) return known;
    if (trail.has(stageId)) return 0; // cycle guard — bad emberflow.yml
    trail.add(stageId);

    const stage = byId.get(stageId);
    const needs = stage ? parseNeeds(stage) : [];
    const depth =
      needs.length === 0
        ? 0
        : Math.max(...needs.map((n) => depthOf(n, trail))) + 1;
    depths.set(stageId, depth);
    return depth;
  };

  for (const s of stages) depthOf(s.stage_id, new Set());
  return depths;
}

// Defined outside the component so the object identity is stable across renders.
const nodeTypes = { stage: StageNode };

/* ---------------------------------------------------------------- the DAG */

export function StageDag({
  stages,
  selectedId,
  onSelect,
}: {
  stages: Stage[];
  selectedId: string | null;
  onSelect: (stageId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const depths = computeDepths(stages);

    // Stack same-depth stages vertically, centered around y = 0.
    const columns = new Map<number, Stage[]>();
    for (const s of stages) {
      const d = depths.get(s.stage_id) ?? 0;
      const col = columns.get(d) ?? [];
      col.push(s);
      columns.set(d, col);
    }

    const nodes: StageNodeType[] = [];
    for (const [depth, col] of columns) {
      col.forEach((stage, i) => {
        nodes.push({
          id: stage.stage_id,
          type: "stage",
          position: {
            x: depth * COL_W,
            y: (i - (col.length - 1) / 2) * ROW_H,
          },
          data: { stage, isSelected: stage.stage_id === selectedId },
          draggable: false,
          connectable: false,
        });
      });
    }

    const edges: Edge[] = stages.flatMap((s) =>
      parseNeeds(s).map((need) => ({
        id: `${need}->${s.stage_id}`,
        source: need,
        target: s.stage_id,
        animated: s.status === "running",
        // Colors come from theme/theme.css tokens — never hex here.
        style: { stroke: "var(--color-edge-2)", strokeWidth: 1.5 },
      })),
    );

    return { nodes, edges };
  }, [stages, selectedId]);

  if (stages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs text-muted">
        waiting for stages…
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      minZoom={0.4}
      maxZoom={1.5}
      colorMode="dark"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1}
        color="var(--color-grid)"
      />
    </ReactFlow>
  );
}
