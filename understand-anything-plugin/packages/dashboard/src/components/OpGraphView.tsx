import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import OpNodeCard from "./ops/OpNodeCard";
import OpGroupBox from "./ops/OpGroupBox";
import OpEdgePath from "./ops/OpEdgePath";
import { layoutOpStage } from "./ops/buildOpLayout";
import type { OpFlowNode } from "./ops/buildOpLayout";
import {
  OP_CANVAS_BG,
  OP_FLOW_ORDER,
  OP_FLOW_STYLES,
  OP_INK,
  OP_KIND_ORDER,
  OP_KIND_STYLES,
} from "./ops/opStyles";

const nodeTypes = { "op-node": OpNodeCard, "op-group": OpGroupBox };
const edgeTypes = { "op-edge": OpEdgePath };

function Legend() {
  const { t } = useI18n();
  const opGraph = useDashboardStore((s) => s.opGraph);
  const [open, setOpen] = useState(true);
  const usedKinds = useMemo(() => new Set(opGraph?.nodes.map((n) => n.kind)), [opGraph]);
  const usedFlows = useMemo(() => new Set(opGraph?.edges.map((e) => e.flow)), [opGraph]);
  return (
    <div
      className="absolute left-3 bottom-3 z-10 rounded-lg border shadow-sm text-[11.5px]"
      style={{ background: "#FFFFFFEE", borderColor: "#D5DAE1", color: "#3A414D", maxWidth: 520 }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-1.5 font-semibold"
        style={{ color: OP_INK }}
      >
        {open ? "▾" : "▸"} {t.opView.legend}
      </button>
      {open && (
        <div className="px-3 pb-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {OP_KIND_ORDER.filter((k) => usedKinds.has(k)).map((k) => {
            const s = OP_KIND_STYLES[k];
            return (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span
                  style={{
                    width: k === "add" ? 12 : 18,
                    height: 12,
                    borderRadius: k === "add" ? 999 : Math.min(s.radius, 4),
                    background: s.fill,
                    border: `${s.strokeWidth}px ${s.dashed ? "dashed" : "solid"} ${s.stroke}`,
                  }}
                />
                {t.opView.kinds[k]}
              </span>
            );
          })}
          {OP_FLOW_ORDER.filter((f) => usedFlows.has(f)).map((f) => (
            <span key={f} className="inline-flex items-center gap-1.5">
              <svg width="24" height="8" aria-hidden>
                <line
                  x1="0"
                  y1="4"
                  x2="24"
                  y2="4"
                  stroke={OP_FLOW_STYLES[f].stroke}
                  strokeWidth="1.6"
                  strokeDasharray={f === "control" ? "4 3" : undefined}
                />
              </svg>
              {t.opView.flows[f]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function OpGraphViewInner() {
  const opGraph = useDashboardStore((s) => s.opGraph);
  const shapeMode = useDashboardStore((s) => s.opShapeMode);
  const setShapeMode = useDashboardStore((s) => s.setOpShapeMode);
  const selectOpNode = useDashboardStore((s) => s.selectOpNode);
  const { t } = useI18n();
  const { fitView } = useReactFlow();

  const stages = useMemo(
    () => [...(opGraph?.stages ?? [])].sort((a, b) => a.order - b.order),
    [opGraph],
  );
  const [stageId, setStageId] = useState<string | null>(null);
  const activeStageId =
    stageId && stages.some((s) => s.id === stageId) ? stageId : stages[0]?.id ?? null;
  const activeStage = stages.find((s) => s.id === activeStageId) ?? null;
  const hasNumeric = useMemo(
    () => !!opGraph?.edges.some((e) => e.shapeValue),
    [opGraph],
  );

  const [layout, setLayout] = useState<{ stageId: string | null; nodes: Node[]; edges: Edge[] }>({
    stageId: null,
    nodes: [],
    edges: [],
  });

  useEffect(() => {
    if (!opGraph || !activeStageId) return;
    let cancelled = false;
    layoutOpStage(opGraph, activeStageId, { strict: import.meta.env.DEV })
      .then(({ nodes, edges, issues }) => {
        if (cancelled) return;
        if (issues.length > 0) useDashboardStore.getState().appendLayoutIssues(issues);
        setLayout({ stageId: activeStageId, nodes, edges });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[op ELK] layout failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [opGraph, activeStageId]);

  // Re-fit whenever a new stage finishes laying out.
  useEffect(() => {
    if (layout.nodes.length === 0) return;
    const id = requestAnimationFrame(() => fitView({ padding: 0.08, duration: 200 }));
    return () => cancelAnimationFrame(id);
  }, [layout, fitView]);

  if (!opGraph) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        {t.opView.noGraph}
      </div>
    );
  }

  const nodesForStage = layout.stageId === activeStageId ? layout.nodes : [];
  const edgesForStage = layout.stageId === activeStageId ? layout.edges : [];

  return (
    <div className="h-full w-full flex flex-col" style={{ background: OP_CANVAS_BG, color: OP_INK }}>
      <div
        className="shrink-0 flex items-center gap-3 px-3 py-2 border-b overflow-x-auto"
        style={{ borderColor: "#D5DAE1", background: "#F5F6F8EE" }}
      >
        <span className="text-[13px] font-semibold whitespace-nowrap">{opGraph.model.name}</span>
        <nav className="flex gap-1" role="tablist">
          {stages.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === activeStageId}
              onClick={() => {
                setStageId(s.id);
                selectOpNode(null);
              }}
              className="px-2.5 py-1 rounded text-[12.5px] whitespace-nowrap transition-colors"
              style={
                s.id === activeStageId
                  ? { background: OP_INK, color: "#FFFFFF" }
                  : { background: "transparent", color: OP_INK }
              }
            >
              {i + 1}. {s.title}
            </button>
          ))}
        </nav>
        {hasNumeric && (
          <div
            className="ml-auto flex items-center gap-2 shrink-0 text-[12px]"
            title={opGraph.model.configSource}
          >
            <span style={{ color: "#5B6470" }}>{t.opView.shape}</span>
            <div className="flex rounded overflow-hidden" style={{ border: "1px solid #B9C0CA" }}>
              {(["symbolic", "numeric"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={shapeMode === m}
                  onClick={() => setShapeMode(m)}
                  className="px-2.5 py-0.5"
                  style={
                    shapeMode === m
                      ? { background: OP_INK, color: "#FFFFFF" }
                      : { background: "#FFFFFF", color: OP_INK }
                  }
                >
                  {m === "symbolic" ? t.opView.shapeSymbolic : t.opView.shapeNumeric}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {activeStage?.summary && (
        <div className="shrink-0 px-4 py-1.5 text-[12px]" style={{ color: "#3A414D" }}>
          {activeStage.summary}
        </div>
      )}
      <div className="op-graph-canvas flex-1 min-h-0 relative">
        <ReactFlow
          nodes={nodesForStage}
          edges={edgesForStage}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onPaneClick={() => selectOpNode(null)}
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#D5DAE1" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) =>
              n.type === "op-node"
                ? OP_KIND_STYLES[(n as OpFlowNode).data.op.kind].stroke
                : "transparent"
            }
            nodeStrokeColor={(n) => (n.type === "op-group" ? "#D5DAE1" : "transparent")}
            maskColor="rgba(245,246,248,0.7)"
            style={{ background: "#FFFFFF", border: "1px solid #D5DAE1" }}
          />
        </ReactFlow>
        <Legend />
      </div>
    </div>
  );
}

export default function OpGraphView() {
  return (
    <ReactFlowProvider>
      <OpGraphViewInner />
    </ReactFlowProvider>
  );
}
