import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../../store";
import type { OpFlowNode } from "./buildOpLayout";
import { MONO_FONT, OP_KIND_STYLES } from "./opStyles";

const hiddenHandle = "!opacity-0 !w-1 !h-1 !min-w-0 !min-h-0 !border-0";

function OpNodeCard({ data }: NodeProps<OpFlowNode>) {
  const { op } = data;
  const selected = useDashboardStore((s) => s.selectedOpNodeId === op.id);
  const selectOpNode = useDashboardStore((s) => s.selectOpNode);
  const style = OP_KIND_STYLES[op.kind];

  const handles = (
    <>
      <Handle type="target" position={Position.Top} className={hiddenHandle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={hiddenHandle} isConnectable={false} />
    </>
  );

  const ring = selected ? "0 0 0 3px rgba(180,84,31,0.35)" : "0 1px 0 rgba(31,36,48,0.04)";

  if (op.kind === "add") {
    return (
      <div
        onClick={() => selectOpNode(op.id)}
        title={op.summary ?? op.name}
        className="flex items-center justify-center cursor-pointer select-none"
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          background: style.fill,
          border: `${style.strokeWidth}px solid ${style.stroke}`,
          boxShadow: ring,
          color: style.text,
          fontSize: 18,
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {handles}+
      </div>
    );
  }

  return (
    <div
      onClick={() => selectOpNode(op.id)}
      title={op.summary ?? op.name}
      className="cursor-pointer select-none text-center"
      style={{
        padding: "6px 12px",
        borderRadius: style.radius,
        background: style.fill,
        border: `${style.strokeWidth}px ${style.dashed ? "dashed" : "solid"} ${style.stroke}`,
        boxShadow: ring,
        color: style.text,
        maxWidth: 320,
        whiteSpace: "nowrap",
      }}
    >
      {handles}
      <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: "17px" }}>{op.name}</div>
      {op.op && (
        <div
          style={{
            fontSize: 10.5,
            lineHeight: "15px",
            fontFamily: MONO_FONT,
            color: style.subText,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {op.op}
        </div>
      )}
      {(op.notes ?? []).map((note, i) => (
        <div
          key={i}
          style={{
            fontSize: 10.5,
            lineHeight: "14px",
            color: op.kind === "loss" ? style.subText : "#B4541F",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {note}
        </div>
      ))}
    </div>
  );
}

export default memo(OpNodeCard);
