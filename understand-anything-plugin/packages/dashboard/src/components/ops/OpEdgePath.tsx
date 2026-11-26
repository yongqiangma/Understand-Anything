import { memo, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { useDashboardStore } from "../../store";
import { EDGE_LABEL_FONT_PX, EDGE_LABEL_HEIGHT, EDGE_LABEL_MAX_WIDTH, edgeLabelText } from "./buildOpLayout";
import type { OpFlowEdge } from "./buildOpLayout";
import { MONO_FONT, OP_FLOW_STYLES } from "./opStyles";

type Pt = { x: number; y: number };

/** Orthogonal polyline with rounded corners (radius clamped to half of the shorter leg). */
function roundedPath(points: Pt[], radius = 8): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const c = points[i];
    const n = points[i + 1];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      d += ` L ${c.x} ${c.y}`;
      continue;
    }
    const a = { x: c.x - ((c.x - p.x) / l1) * r, y: c.y - ((c.y - p.y) / l1) * r };
    const b = { x: c.x + ((n.x - c.x) / l2) * r, y: c.y + ((n.y - c.y) / l2) * r };
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

function OpEdgePath({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<OpFlowEdge>) {
  const shapeMode = useDashboardStore((s) => s.opShapeMode);
  const selectedId = useDashboardStore((s) => s.selectedOpNodeId);
  const [hovered, setHovered] = useState(false);
  if (!data) return null;
  const { edge, points, labelPos } = data;

  let path: string;
  let labelX: number;
  let labelY: number;
  if (points && points.length >= 2) {
    path = roundedPath(points);
    const mid = points[Math.floor((points.length - 1) / 2)];
    labelX = labelPos?.x ?? mid.x;
    labelY = labelPos?.y ?? mid.y;
  } else {
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 8,
      offset: 14,
    });
  }

  const touchesSelected = !!selectedId && (selectedId === edge.source || selectedId === edge.target);
  const emphasized = touchesSelected || hovered;
  // With a node selected, unrelated edges fade so the selected node's flows stand out.
  const dimmed = !!selectedId && !touchesSelected && !hovered;
  const style = OP_FLOW_STYLES[edge.flow];
  const text = edgeLabelText(edge, shapeMode);

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={14}
        style={{
          stroke: style.stroke,
          strokeWidth: emphasized ? 2.4 : 1.4,
          strokeDasharray: edge.dashed || edge.flow === "control" ? "5 4" : undefined,
          opacity: dimmed ? 0.18 : emphasized ? 1 : 0.85,
          transition: "opacity 120ms, stroke-width 120ms",
        }}
      />
      {text && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            title={edge.shape && edge.shapeValue ? `${edge.shape} = ${edge.shapeValue}` : text}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "#FFFFFF",
              border: `${emphasized ? 1.6 : 1}px solid ${style.stroke}`,
              borderRadius: 9,
              padding: "0 6px",
              maxWidth: EDGE_LABEL_MAX_WIDTH,
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontSize: EDGE_LABEL_FONT_PX,
              lineHeight: `${EDGE_LABEL_HEIGHT - 2}px`,
              fontFamily: MONO_FONT,
              color: style.pillText,
              whiteSpace: "nowrap",
              pointerEvents: "all",
              opacity: dimmed ? 0.3 : 1,
              zIndex: emphasized ? 6 : 3,
              boxShadow: emphasized ? "0 1px 4px rgba(31,36,48,0.18)" : undefined,
            }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

export default memo(OpEdgePath);
