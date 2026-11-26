import type { OpEdgeFlow, OpNodeKind } from "@understand-anything/core/types";

/**
 * Colours for the OP view. They follow the reference architecture diagrams
 * (light "paper" canvas): orange = trainable draft ops, teal = target model,
 * violet = parameter-free ops and index/mask flows, grey = frozen / control.
 */
export const OP_CANVAS_BG = "#F5F6F8";
export const OP_INK = "#1F2430";
export const OP_MUTED = "#5B6470";

export interface OpKindStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed?: boolean;
  text: string;
  subText: string;
  radius: number;
}

export const OP_KIND_STYLES: Record<OpNodeKind, OpKindStyle> = {
  param: { fill: "#FCE9DC", stroke: "#B4541F", strokeWidth: 1.2, text: OP_INK, subText: "#4A5260", radius: 4 },
  fn: { fill: "#F1EFFA", stroke: "#8A7FC6", strokeWidth: 1.2, text: OP_INK, subText: "#4A5260", radius: 4 },
  frozen: { fill: "#EEF0F3", stroke: "#7A8491", strokeWidth: 1.2, dashed: true, text: OP_INK, subText: "#4A5260", radius: 4 },
  tensor: { fill: "#FFFFFF", stroke: OP_INK, strokeWidth: 1.2, text: OP_INK, subText: "#4A5260", radius: 8 },
  output: { fill: "#FFFFFF", stroke: "#B4541F", strokeWidth: 1.8, text: OP_INK, subText: "#4A5260", radius: 4 },
  target: { fill: "#DDEFEC", stroke: "#23736C", strokeWidth: 1.2, text: OP_INK, subText: "#4A5260", radius: 4 },
  target_output: { fill: "#FFFFFF", stroke: "#23736C", strokeWidth: 1.8, text: OP_INK, subText: "#4A5260", radius: 4 },
  add: { fill: "#FFFFFF", stroke: OP_INK, strokeWidth: 1.2, text: OP_INK, subText: "#4A5260", radius: 999 },
  loss: { fill: OP_INK, stroke: OP_INK, strokeWidth: 1.2, text: "#FFFFFF", subText: "#D5DAE1", radius: 4 },
  decision: { fill: "#FFF8E6", stroke: "#B98A1B", strokeWidth: 1.2, text: OP_INK, subText: "#4A5260", radius: 4 },
};

export interface OpFlowStyle {
  stroke: string;
  pillText: string;
}

export const OP_FLOW_STYLES: Record<OpEdgeFlow, OpFlowStyle> = {
  data: { stroke: "#B4541F", pillText: "#8A3C12" },
  target: { stroke: "#23736C", pillText: "#165650" },
  index: { stroke: "#5B4BA8", pillText: "#43358A" },
  control: { stroke: "#7A8491", pillText: "#4A5260" },
};

export interface OpGroupStyle {
  fill: string;
  stroke: string;
  dashed?: boolean;
}

export const OP_GROUP_STYLES: Record<"default" | "repeat" | "loop" | "target", OpGroupStyle> = {
  default: { fill: "#FFFFFF", stroke: "#D5DAE1" },
  repeat: { fill: "#FBF3EE", stroke: "#E6C3AD" },
  loop: { fill: "rgba(255,255,255,0.4)", stroke: "#9AA3AF", dashed: true },
  target: { fill: "#EEF6F5", stroke: "#A9CFCA" },
};

export const OP_KIND_ORDER: OpNodeKind[] = [
  "param",
  "frozen",
  "fn",
  "target",
  "tensor",
  "output",
  "target_output",
  "add",
  "loss",
  "decision",
];

export const OP_FLOW_ORDER: OpEdgeFlow[] = ["data", "target", "index", "control"];

export const MONO_FONT = '"JetBrains Mono", Menlo, Consolas, monospace';
