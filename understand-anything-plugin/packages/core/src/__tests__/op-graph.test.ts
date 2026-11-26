import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateOpGraph } from "../op-schema.js";
import { saveOpGraph, loadOpGraph } from "../persistence/index.js";
import type { OpGraph } from "../types.js";

const base = (): OpGraph => ({
  version: "1.0.0",
  kind: "ops",
  project: {
    name: "demo",
    languages: ["python"],
    frameworks: ["pytorch"],
    description: "demo",
    analyzedAt: "2026-11-17T00:00:00.000Z",
    gitCommitHash: "abc",
  },
  model: { name: "Tiny", framework: "pytorch" },
  symbols: [{ name: "B", description: "batch", value: "1" }],
  stages: [
    {
      id: "s1",
      order: 0,
      title: "Backbone",
      summary: "one layer",
      phase: "train",
      groups: [{ id: "layer", title: "DecoderLayer", kind: "repeat", repeat: 5 }],
    },
  ],
  nodes: [
    { id: "x", stageId: "s1", name: "hidden", kind: "tensor" },
    { id: "q", stageId: "s1", groupId: "layer", name: "q_proj", op: "Linear(H→Hq·D)", kind: "param" },
    { id: "y", stageId: "s1", name: "out", kind: "output" },
  ],
  edges: [
    { source: "x", target: "q", flow: "data", shape: "[B, L, H]", shapeValue: "[1, 4096, 2560]" },
    { source: "q", target: "y", flow: "data" },
  ],
});

describe("validateOpGraph", () => {
  it("accepts a valid graph unchanged", () => {
    const r = validateOpGraph(base());
    expect(r.success).toBe(true);
    expect(r.data?.nodes).toHaveLength(3);
    expect(r.data?.edges).toHaveLength(2);
    expect(r.issues.filter((i) => i.level !== "auto-corrected")).toHaveLength(0);
  });

  it("is fatal for non-objects, missing stages and empty nodes", () => {
    expect(validateOpGraph(null).fatal).toBeDefined();
    expect(validateOpGraph({ ...base(), stages: [] }).fatal).toMatch(/stages/);
    expect(validateOpGraph({ ...base(), nodes: [] }).fatal).toMatch(/nodes/);
  });

  it("normalizes kind and flow aliases", () => {
    const g = base() as unknown as Record<string, unknown>;
    (g.nodes as Array<Record<string, unknown>>)[1].kind = "Trainable";
    (g.edges as Array<Record<string, unknown>>)[0].flow = "draft";
    (g.edges as Array<Record<string, unknown>>)[1].flow = "mask";
    const r = validateOpGraph(g);
    expect(r.data?.nodes[1].kind).toBe("param");
    expect(r.data?.edges.map((e) => e.flow)).toEqual(["data", "index"]);
  });

  it("drops nodes in unknown stages and their dangling edges", () => {
    const g = base();
    g.nodes[2].stageId = "nope";
    const r = validateOpGraph(g);
    expect(r.success).toBe(true);
    expect(r.data?.nodes.map((n) => n.id)).toEqual(["x", "q"]);
    expect(r.data?.edges).toHaveLength(1);
    expect(r.issues.some((i) => i.level === "dropped" && i.category === "edge")).toBe(true);
  });

  it("clears unknown groupId, drops self-loops and duplicates", () => {
    const g = base();
    g.nodes[0].groupId = "ghost";
    g.edges.push({ source: "q", target: "q", flow: "data" });
    g.edges.push({ ...g.edges[0] });
    const r = validateOpGraph(g);
    expect(r.data?.nodes[0].groupId).toBeUndefined();
    expect(r.data?.edges).toHaveLength(2);
  });

  it("breaks group parent cycles", () => {
    const g = base();
    g.stages[0].groups = [
      { id: "a", title: "A", parentId: "b" },
      { id: "b", title: "B", parentId: "a" },
    ];
    const r = validateOpGraph(g);
    const groups = r.data?.stages[0].groups ?? [];
    expect(groups.some((x) => !x.parentId)).toBe(true);
  });

  it("defaults version, kind and model", () => {
    const g = base() as unknown as Record<string, unknown>;
    delete g.version;
    delete g.kind;
    delete g.model;
    const r = validateOpGraph(g);
    expect(r.data?.version).toBe("1.0.0");
    expect(r.data?.kind).toBe("ops");
    expect(r.data?.model.name).toBe("demo");
  });
});

const testRoot = join(tmpdir(), "ua-op-persist-test");

describe("op graph persistence", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(testRoot, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("returns null when missing", () => {
    expect(loadOpGraph(testRoot)).toBeNull();
  });

  it("round-trips and relativizes absolute paths", () => {
    const g = base();
    g.nodes[1].filePath = join(testRoot, "model", "attn.py");
    g.stages[0].sourceFiles = [join(testRoot, "model", "layer.py"), "/elsewhere/secret/cfg.py"];
    saveOpGraph(testRoot, g);
    const raw = JSON.parse(readFileSync(join(testRoot, ".ua", "op-graph.json"), "utf-8"));
    expect(raw.nodes[1].filePath).toBe(join("model", "attn.py"));
    expect(raw.stages[0].sourceFiles).toEqual([join("model", "layer.py"), "cfg.py"]);
    const loaded = loadOpGraph(testRoot);
    expect(loaded?.nodes).toHaveLength(3);
  });
});
