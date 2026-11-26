import { z } from "zod";
import type { GraphIssue } from "./schema.js";
import type { OpGraph } from "./types.js";

/**
 * Validation for the deep-learning op graph (`op-graph.json`) produced by
 * the `/understand-ops` skill. Self-contained (only type imports from
 * schema.ts) so it can be re-exported from the browser-safe `./schema`
 * subpath without creating a runtime import cycle.
 */

export const OpNodeKindSchema = z.enum([
  "param",
  "frozen",
  "fn",
  "tensor",
  "output",
  "target",
  "target_output",
  "add",
  "loss",
  "decision",
]);

export const OpEdgeFlowSchema = z.enum(["data", "target", "index", "control"]);

/** Common LLM spellings mapped to canonical op node kinds. */
export const OP_NODE_KIND_ALIASES: Record<string, string> = {
  op: "param",
  trainable: "param",
  module: "param",
  layer: "param",
  frz: "frozen",
  freeze: "frozen",
  function: "fn",
  func: "fn",
  functional: "fn",
  input: "tensor",
  in: "tensor",
  out: "output",
  result: "output",
  tgt: "target",
  tgtout: "target_output",
  "target-output": "target_output",
  residual: "add",
  sum: "add",
  criterion: "loss",
  dec: "decision",
  branch: "decision",
  condition: "decision",
};

/** Common LLM spellings mapped to canonical edge flows. */
export const OP_EDGE_FLOW_ALIASES: Record<string, string> = {
  d: "data",
  draft: "data",
  tensor: "data",
  activation: "data",
  t: "target",
  tgt: "target",
  i: "index",
  mask: "index",
  indices: "index",
  idx: "index",
  g: "control",
  other: "control",
  exec: "control",
  execution: "control",
};

export const OpSymbolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  value: z.string().optional(),
});

export const OpGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  subtitle: z.string().optional(),
  kind: z.enum(["default", "repeat", "loop", "target"]).optional(),
  repeat: z.number().int().positive().optional(),
  parentId: z.string().optional(),
});

export const OpStageSchema = z.object({
  id: z.string().min(1),
  order: z.number(),
  title: z.string(),
  summary: z.string(),
  phase: z.enum(["train", "infer", "both"]).optional(),
  sourceFiles: z.array(z.string()).optional(),
  groups: z.array(OpGroupSchema).optional(),
});

export const OpNodeSchema = z.object({
  id: z.string().min(1),
  stageId: z.string().min(1),
  groupId: z.string().optional(),
  name: z.string().min(1),
  op: z.string().optional(),
  kind: OpNodeKindSchema,
  module: z.string().optional(),
  summary: z.string().optional(),
  notes: z.array(z.string()).optional(),
  filePath: z.string().optional(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
  refNodeId: z.string().optional(),
});

export const OpEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  flow: OpEdgeFlowSchema,
  shape: z.string().optional(),
  shapeValue: z.string().optional(),
  label: z.string().optional(),
  dashed: z.boolean().optional(),
});

const OpProjectSchema = z.object({
  name: z.string(),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  description: z.string(),
  analyzedAt: z.string(),
  gitCommitHash: z.string(),
});

const OpModelSchema = z.object({
  name: z.string(),
  framework: z.string().optional(),
  configSource: z.string().optional(),
  description: z.string().optional(),
});

export interface OpGraphValidationResult {
  success: boolean;
  data?: OpGraph;
  issues: GraphIssue[];
  fatal?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function zodMsg(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

function normalizeEnum(
  raw: unknown,
  aliases: Record<string, string>,
): unknown {
  if (typeof raw !== "string") return raw;
  const lower = raw.trim().toLowerCase();
  return aliases[lower] ?? lower;
}

/**
 * Tiered validation for an op graph:
 * - fatal: not an object, invalid project/model, no valid stages, no valid nodes
 * - dropped: invalid stages/groups/nodes/edges, nodes in unknown stages,
 *   dangling or self-loop edges, duplicate ids
 * - auto-corrected: missing version/kind/symbols, aliased enums, unknown groupId
 */
export function validateOpGraph(data: unknown): OpGraphValidationResult {
  const issues: GraphIssue[] = [];
  const fail = (message: string): OpGraphValidationResult => {
    issues.push({ level: "fatal", category: "structure", message });
    return { success: false, issues, fatal: message };
  };

  if (!isRecord(data)) return fail("Op graph must be a JSON object");

  let version = data.version;
  if (typeof version !== "string" || !version) {
    version = "1.0.0";
    issues.push({ level: "auto-corrected", category: "version", message: "Missing version, defaulted to 1.0.0" });
  }
  if (data.kind !== "ops") {
    issues.push({ level: "auto-corrected", category: "kind", message: `kind set to "ops" (was ${JSON.stringify(data.kind)})` });
  }

  const project = OpProjectSchema.safeParse(data.project);
  if (!project.success) return fail(`Invalid project metadata: ${zodMsg(project.error)}`);

  const model = OpModelSchema.safeParse(
    isRecord(data.model) ? data.model : { name: project.data.name },
  );
  if (!model.success) return fail(`Invalid model metadata: ${zodMsg(model.error)}`);
  if (!isRecord(data.model)) {
    issues.push({ level: "auto-corrected", category: "model", message: "Missing model, defaulted to project name" });
  }

  // symbols
  const symbols: OpGraph["symbols"] = [];
  if (Array.isArray(data.symbols)) {
    data.symbols.forEach((s, i) => {
      const r = OpSymbolSchema.safeParse(s);
      if (r.success) symbols.push(r.data);
      else issues.push({ level: "dropped", category: "symbol", message: zodMsg(r.error), path: `symbols[${i}]` });
    });
  } else if (data.symbols !== undefined) {
    issues.push({ level: "auto-corrected", category: "symbol", message: "symbols was not an array, replaced with []" });
  }

  // stages + groups
  if (!Array.isArray(data.stages)) return fail("stages must be an array");
  const stages: OpGraph["stages"] = [];
  const stageIds = new Set<string>();
  const groupIdsByStage = new Map<string, Set<string>>();
  data.stages.forEach((raw, i) => {
    if (!isRecord(raw)) {
      issues.push({ level: "dropped", category: "stage", message: "Stage is not an object", path: `stages[${i}]` });
      return;
    }
    const candidate: Record<string, unknown> = { ...raw, order: typeof raw.order === "number" ? raw.order : i };
    if (typeof raw.summary !== "string") candidate.summary = "";
    const groupsRaw = Array.isArray(raw.groups) ? raw.groups : [];
    candidate.groups = undefined;
    const r = OpStageSchema.safeParse(candidate);
    if (!r.success) {
      issues.push({ level: "dropped", category: "stage", message: zodMsg(r.error), path: `stages[${i}]` });
      return;
    }
    if (stageIds.has(r.data.id)) {
      issues.push({ level: "dropped", category: "stage", message: `Duplicate stage id ${r.data.id}`, path: `stages[${i}]` });
      return;
    }
    const gids = new Set<string>();
    const groups: NonNullable<OpGraph["stages"][number]["groups"]> = [];
    groupsRaw.forEach((g, j) => {
      const gr = OpGroupSchema.safeParse(g);
      if (!gr.success || gids.has(gr.data.id)) {
        issues.push({ level: "dropped", category: "group", message: gr.success ? `Duplicate group id ${gr.data.id}` : zodMsg(gr.error), path: `stages[${i}].groups[${j}]` });
        return;
      }
      gids.add(gr.data.id);
      groups.push(gr.data);
    });
    for (const g of groups) {
      if (g.parentId && (!gids.has(g.parentId) || g.parentId === g.id)) {
        issues.push({ level: "auto-corrected", category: "group", message: `Group ${g.id} parentId ${g.parentId} not found, cleared` });
        delete g.parentId;
      }
    }
    stageIds.add(r.data.id);
    groupIdsByStage.set(r.data.id, gids);
    stages.push({ ...r.data, ...(groups.length ? { groups } : {}) });
  });
  if (stages.length === 0) return fail("Op graph has no valid stages");
  stages.sort((a, b) => a.order - b.order);

  // break parent cycles among groups so renderers can walk parent chains safely
  for (const stage of stages) {
    const byId = new Map((stage.groups ?? []).map((g) => [g.id, g]));
    for (const g of stage.groups ?? []) {
      const seen = new Set<string>([g.id]);
      let cur = g.parentId ? byId.get(g.parentId) : undefined;
      while (cur) {
        if (seen.has(cur.id)) {
          issues.push({ level: "auto-corrected", category: "group", message: `Group parent cycle at ${g.id}, parentId cleared` });
          delete g.parentId;
          break;
        }
        seen.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
  }

  // nodes
  if (!Array.isArray(data.nodes)) return fail("nodes must be an array");
  const nodes: OpGraph["nodes"] = [];
  const nodeIds = new Set<string>();
  data.nodes.forEach((raw, i) => {
    if (!isRecord(raw)) {
      issues.push({ level: "dropped", category: "node", message: "Node is not an object", path: `nodes[${i}]` });
      return;
    }
    const candidate: Record<string, unknown> = { ...raw };
    const kind = normalizeEnum(raw.kind, OP_NODE_KIND_ALIASES);
    if (kind !== raw.kind) {
      candidate.kind = kind;
      issues.push({ level: "auto-corrected", category: "node", message: `kind ${JSON.stringify(raw.kind)} -> ${JSON.stringify(kind)}`, path: `nodes[${i}].kind` });
    }
    if (typeof raw.notes === "string") candidate.notes = [raw.notes];
    const r = OpNodeSchema.safeParse(candidate);
    if (!r.success) {
      issues.push({ level: "dropped", category: "node", message: zodMsg(r.error), path: `nodes[${i}]` });
      return;
    }
    const n = r.data;
    if (nodeIds.has(n.id)) {
      issues.push({ level: "dropped", category: "node", message: `Duplicate node id ${n.id}`, path: `nodes[${i}]` });
      return;
    }
    if (!stageIds.has(n.stageId)) {
      issues.push({ level: "dropped", category: "node", message: `Node ${n.id} references unknown stage ${n.stageId}`, path: `nodes[${i}]` });
      return;
    }
    if (n.groupId && !groupIdsByStage.get(n.stageId)?.has(n.groupId)) {
      issues.push({ level: "auto-corrected", category: "node", message: `Node ${n.id} groupId ${n.groupId} not in stage ${n.stageId}, cleared`, path: `nodes[${i}].groupId` });
      delete n.groupId;
    }
    nodeIds.add(n.id);
    nodes.push(n);
  });
  if (nodes.length === 0) return fail("Op graph has no valid nodes");

  // edges
  const edges: OpGraph["edges"] = [];
  const edgeKeys = new Set<string>();
  const rawEdges = Array.isArray(data.edges) ? data.edges : [];
  if (!Array.isArray(data.edges)) {
    issues.push({ level: "auto-corrected", category: "edge", message: "edges was not an array, replaced with []" });
  }
  rawEdges.forEach((raw, i) => {
    if (!isRecord(raw)) {
      issues.push({ level: "dropped", category: "edge", message: "Edge is not an object", path: `edges[${i}]` });
      return;
    }
    const candidate: Record<string, unknown> = { ...raw };
    const flow = normalizeEnum(raw.flow ?? "data", OP_EDGE_FLOW_ALIASES);
    if (flow !== raw.flow) candidate.flow = flow;
    const r = OpEdgeSchema.safeParse(candidate);
    if (!r.success) {
      issues.push({ level: "dropped", category: "edge", message: zodMsg(r.error), path: `edges[${i}]` });
      return;
    }
    const e = r.data;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      issues.push({ level: "dropped", category: "edge", message: `Edge ${e.source} -> ${e.target} references a missing node`, path: `edges[${i}]` });
      return;
    }
    if (e.source === e.target) {
      issues.push({ level: "dropped", category: "edge", message: `Self-loop on ${e.source}`, path: `edges[${i}]` });
      return;
    }
    const key = `${e.source}\u0000${e.target}\u0000${e.flow}\u0000${e.shape ?? ""}`;
    if (edgeKeys.has(key)) {
      issues.push({ level: "dropped", category: "edge", message: `Duplicate edge ${e.source} -> ${e.target}`, path: `edges[${i}]` });
      return;
    }
    edgeKeys.add(key);
    edges.push(e);
  });

  return {
    success: true,
    data: {
      version: version as string,
      kind: "ops",
      project: project.data,
      model: model.data,
      symbols,
      stages,
      nodes,
      edges,
    },
    issues,
  };
}
