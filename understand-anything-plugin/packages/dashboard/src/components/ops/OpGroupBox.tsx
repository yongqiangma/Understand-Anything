import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { OpGroupFlowNode } from "./buildOpLayout";
import { OP_GROUP_STYLES, OP_INK, OP_MUTED } from "./opStyles";

function OpGroupBox({ data }: NodeProps<OpGroupFlowNode>) {
  const { group, width, height } = data;
  const style = OP_GROUP_STYLES[group.kind ?? "default"];
  const badge = group.kind === "repeat" && group.repeat ? `×${group.repeat}` : null;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 8,
        background: style.fill,
        border: `${style.dashed ? 1.2 : 1}px ${style.dashed ? "dashed" : "solid"} ${style.stroke}`,
        pointerEvents: "none",
      }}
    >
      <div className="flex items-baseline gap-2" style={{ padding: "8px 12px 0" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: OP_INK }}>{group.title}</span>
        {badge && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#FFFFFF",
              background: "#B4541F",
              borderRadius: 4,
              padding: "0 6px",
            }}
          >
            {badge}
          </span>
        )}
      </div>
      {group.subtitle && (
        <div style={{ fontSize: 11, color: OP_MUTED, padding: "0 12px" }}>{group.subtitle}</div>
      )}
    </div>
  );
}

export default memo(OpGroupBox);
