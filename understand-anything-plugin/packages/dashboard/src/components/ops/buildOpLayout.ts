import { MarkerType } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import type { GraphIssue } from "@understand-anything/core/schema";
import type { OpEdge, OpGraph, OpGroup, OpNode } from "@understand-anything/core/types";
import { applyElkLayout } from "../../utils/elk-layout";
import type { ElkChild, ElkEdge, ElkInput } from "../../utils/elk-layout";
import { OP_FLOW_STYLES } from "./opStyles";

export interface OpNodeData extends Record<string, unknown> {
  op: OpNode;
}

export interface OpGroupData extends Record<string, unknown> {
  group: OpGroup;
  width: number;
  height: number;
}

export interface OpEdgeData extends Record<string, unknown> {
  edge: OpEdge;
  /** Absolute polyline from ELK (start, bends, end). Absent if ELK gave no route. */
  points?: { x: number; y: number }[];
  /** Absolute centre of the label box ELK reserved, per shape mode. */
  labelPos?: { x: number; y: number };
}

export type OpFlowNode = Node<OpNodeData, "op-node">;
export type OpGroupFlowNode = Node<OpGroupData, "op-group">;
export type OpFlowEdge = Edge<OpEdgeData, "op-edge">;

const GROUP_PADDING = "[top=50,left=26,right=26,bottom=26]";

/** Edge label pill metrics; OpEdgePath renders with the same values. */
export const EDGE_LABEL_FONT_PX = 10.5;
export const EDGE_LABEL_HEIGHT = 18;
export const EDGE_LABEL_MAX_WIDTH = 300;
const EDGE_LABEL_PAD_X = 16;

/** Rough text width so ELK reserves enough room for the rendered text. */
function textWidth(text: string | undefined, px: number, mono = false): number {
  if (!text) return 0;
  let w = 0;
  for (const ch of text) {
    // CJK glyphs are roughly square; latin glyphs ~0.6em (mono ~0.62em).
    w += /[⺀-￿]/.test(ch) ? px : px * (mono ? 0.62 : 0.6);
  }
  return w;
}

export type OpShapeMode = "symbolic" | "numeric";

export function edgeLabelText(edge: OpEdge, mode: OpShapeMode): string {
  const shape = mode === "numeric" ? edge.shapeValue ?? edge.shape : edge.shape;
  return [edge.label, shape].filter(Boolean).join(" · ");
}

/** Width that fits the label in either shape mode, so toggling never needs a re-layout. */
function edgeLabelWidth(edge: OpEdge): number {
  const w = Math.max(
    textWidth(edgeLabelText(edge, "symbolic"), EDGE_LABEL_FONT_PX, true),
    textWidth(edgeLabelText(edge, "numeric"), EDGE_LABEL_FONT_PX, true),
  );
  return w === 0 ? 0 : Math.ceil(Math.min(w + EDGE_LABEL_PAD_X, EDGE_LABEL_MAX_WIDTH));
}

export function opNodeSize(node: OpNode): { width: number; height: number } {
  if (node.kind === "add") return { width: 34, height: 34 };
  const notes = node.notes ?? [];
  const width = Math.ceil(
    Math.max(
      84,
      textWidth(node.name, 12.5) + 28,
      textWidth(node.op, 10.5, true) + 28,
      ...notes.map((n) => textWidth(n, 10.5) + 28),
    ),
  );
  // 12px vertical padding + 2px border + text lines (see OpNodeCard).
  const height = 14 + 17 + (node.op ? 15 : 0) + notes.length * 14;
  return { width: Math.min(width, 320), height };
}

interface StageSlice {
  nodes: OpNode[];
  edges: OpEdge[];
  groups: OpGroup[];
}

export function sliceStage(graph: OpGraph, stageId: string): StageSlice {
  const nodes = graph.nodes.filter((n) => n.stageId === stageId);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const stage = graph.stages.find((s) => s.id === stageId);
  return { nodes, edges, groups: stage?.groups ?? [] };
}

export function edgeId(e: OpEdge, i: number): string {
  return `op-e${i}-${e.source}-${e.target}`;
}

/** Build the nested ELK input: groups become compound nodes, ops are leaves. */
export function buildElkInput(slice: StageSlice): ElkInput {
  const groupById = new Map(slice.groups.map((g) => [g.id, g]));
  const childrenOf = new Map<string, ElkChild[]>();
  const push = (parent: string, child: ElkChild) => {
    const list = childrenOf.get(parent) ?? [];
    list.push(child);
    childrenOf.set(parent, list);
  };

  for (const n of slice.nodes) {
    const size = opNodeSize(n);
    push(n.groupId && groupById.has(n.groupId) ? n.groupId : "root", { id: n.id, ...size });
  }

  const build = (groupId: string): ElkChild & { layoutOptions?: Record<string, string> } => ({
    id: groupId,
    // Compound nodes are resized by ELK to fit their children; a tiny seed
    // size keeps repairElkInput from flagging them as dimensionless.
    width: 40,
    height: 40,
    children: [
      ...slice.groups.filter((g) => g.parentId === groupId).map((g) => build(g.id)),
      ...(childrenOf.get(groupId) ?? []),
    ],
    layoutOptions: { "elk.padding": GROUP_PADDING },
  });

  const topGroups = slice.groups.filter((g) => !g.parentId || !groupById.has(g.parentId));
  // Empty groups (no ops anywhere below) would render as blank boxes — skip them.
  const hasLeaf = (c: ElkChild): boolean =>
    c.children === undefined || c.children.some((x) => hasLeaf(x));
  const prune = (c: ElkChild): ElkChild =>
    c.children ? { ...c, children: c.children.filter(hasLeaf).map(prune) } : c;

  const children = [...topGroups.map((g) => build(g.id)), ...(childrenOf.get("root") ?? [])]
    .filter(hasLeaf)
    .map(prune);

  return {
    id: "root",
    layoutOptions: {
      algorithm: "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      // Labels get their own slot between layers instead of sitting on top of nodes.
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.edgeLabels.sideSelection": "SMART_DOWN",
      "elk.spacing.edgeLabel": "4",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.layered.spacing.edgeNodeBetweenLayers": "28",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
      "elk.spacing.nodeNode": "44",
      "elk.spacing.edgeNode": "26",
      "elk.spacing.edgeEdge": "16",
      "elk.layered.mergeEdges": "false",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.thoroughness": "25",
      "elk.padding": "[top=28,left=28,right=28,bottom=28]",
    },
    children,
    edges: slice.edges.map((e, i) => {
      const width = edgeLabelWidth(e);
      return {
        id: edgeId(e, i),
        sources: [e.source],
        targets: [e.target],
        ...(width > 0 ? { labels: [{ text: edgeLabelText(e, "symbolic"), width, height: EDGE_LABEL_HEIGHT }] } : {}),
      };
    }),
  };
}

export interface OpLayoutResult {
  nodes: Node[];
  edges: OpFlowEdge[];
  issues: GraphIssue[];
  width: number;
  height: number;
}

/**
 * Run ELK and convert the nested result into React Flow nodes. ELK reports
 * child coordinates relative to their compound parent, which is exactly how
 * React Flow positions nodes with `parentId`, so positions are copied as-is.
 * Parents are emitted before their children (React Flow requirement).
 */
export async function layoutOpStage(
  graph: OpGraph,
  stageId: string,
  opts: { strict?: boolean } = {},
): Promise<OpLayoutResult> {
  const slice = sliceStage(graph, stageId);
  const input = buildElkInput(slice);
  const { positioned, issues } = await applyElkLayout(input, opts);

  const opById = new Map(slice.nodes.map((n) => [n.id, n]));
  const groupById = new Map(slice.groups.map((g) => [g.id, g]));
  const out: Node[] = [];

  const walk = (children: ElkChild[], parentId?: string) => {
    for (const c of children) {
      const position = { x: c.x ?? 0, y: c.y ?? 0 };
      const group = groupById.get(c.id);
      if (group && c.children) {
        const width = c.width ?? 0;
        const height = c.height ?? 0;
        const gNode: OpGroupFlowNode = {
          id: c.id,
          type: "op-group",
          position,
          data: { group, width, height },
          style: { width, height },
          selectable: false,
          draggable: false,
          zIndex: 0,
          ...(parentId ? { parentId } : {}),
        };
        out.push(gNode);
        walk(c.children, c.id);
        continue;
      }
      const op = opById.get(c.id);
      if (!op) continue;
      const nNode: OpFlowNode = {
        id: c.id,
        type: "op-node",
        position,
        data: { op },
        draggable: false,
        zIndex: 2,
        ...(parentId ? { parentId } : {}),
      };
      out.push(nNode);
    }
  };
  walk(positioned.children ?? []);

  const rendered = new Set(out.map((n) => n.id));
  // ELK reports edge sections and labels relative to the edge's container
  // (the lowest common ancestor group), so shift them by its absolute origin.
  const origin = new Map<string, { x: number; y: number }>([["root", { x: 0, y: 0 }]]);
  const routeById = new Map<string, ElkEdge>();
  const collect = (node: { children?: ElkChild[]; edges?: ElkEdge[] }, ox: number, oy: number) => {
    for (const pe of node.edges ?? []) routeById.set(pe.id, pe);
    for (const c of node.children ?? []) {
      const cx = ox + (c.x ?? 0);
      const cy = oy + (c.y ?? 0);
      origin.set(c.id, { x: cx, y: cy });
      collect(c as ElkChild & { edges?: ElkEdge[] }, cx, cy);
    }
  };
  collect(positioned, 0, 0);
  const edges: OpFlowEdge[] = slice.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => rendered.has(e.source) && rendered.has(e.target))
    .map(({ e, i }) => {
      const id = edgeId(e, i);
      const route = routeById.get(id);
      const o = origin.get(route?.container ?? "root") ?? { x: 0, y: 0 };
      const shift = (p: { x: number; y: number }) => ({ x: p.x + o.x, y: p.y + o.y });
      const sec = route?.sections?.[0];
      const points = sec
        ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map(shift)
        : undefined;
      const lbl = route?.labels?.[0];
      const labelPos =
        lbl && lbl.x != null && lbl.y != null
          ? shift({ x: lbl.x + lbl.width / 2, y: lbl.y + lbl.height / 2 })
          : undefined;
      return {
        id,
        source: e.source,
        target: e.target,
        type: "op-edge" as const,
        data: { edge: e, points, labelPos },
        zIndex: 1,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: OP_FLOW_STYLES[e.flow].stroke,
          width: 14,
          height: 14,
        },
      };
    });

  return {
    nodes: out,
    edges,
    issues,
    width: (positioned as ElkChild).width ?? 0,
    height: (positioned as ElkChild).height ?? 0,
  };
}
