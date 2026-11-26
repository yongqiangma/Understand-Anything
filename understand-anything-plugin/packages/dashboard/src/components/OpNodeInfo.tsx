import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import type { OpEdge, OpGraph, OpNode } from "@understand-anything/core/types";
import { OP_FLOW_STYLES, OP_KIND_STYLES } from "./ops/opStyles";

function KindBadge({ node }: { node: OpNode }) {
  const { t } = useI18n();
  const s = OP_KIND_STYLES[node.kind];
  return (
    <span
      className="text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded"
      style={{
        background: s.fill,
        color: node.kind === "loss" ? "#FFFFFF" : s.stroke,
        border: `1px ${s.dashed ? "dashed" : "solid"} ${s.stroke}`,
      }}
    >
      {t.opView.kinds[node.kind]}
    </span>
  );
}

function EdgeRow({
  edge,
  other,
  dir,
  onSelect,
}: {
  edge: OpEdge;
  other: OpNode | undefined;
  dir: "in" | "out";
  onSelect: (id: string) => void;
}) {
  const shapeMode = useDashboardStore((s) => s.opShapeMode);
  const style = OP_FLOW_STYLES[edge.flow];
  const shape = shapeMode === "numeric" ? edge.shapeValue ?? edge.shape : edge.shape;
  return (
    <button
      type="button"
      onClick={() => other && onSelect(other.id)}
      className="w-full flex items-center gap-2 text-left text-xs py-1 px-2 rounded hover:bg-elevated transition-colors"
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: style.stroke }} />
      <span className="text-text-muted shrink-0">{dir === "in" ? "←" : "→"}</span>
      <span className="text-text-primary truncate">{other?.name ?? (dir === "in" ? edge.source : edge.target)}</span>
      {shape && (
        <span className="ml-auto font-mono text-[10.5px] text-text-secondary shrink-0">{shape}</span>
      )}
    </button>
  );
}

function SymbolsTable({ graph }: { graph: OpGraph }) {
  const { t } = useI18n();
  if (graph.symbols.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
        {t.opView.symbols}
      </h3>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-text-muted text-left">
            <th className="font-medium py-1 pr-2">{t.opView.symbol}</th>
            <th className="font-medium py-1 pr-2">{t.opView.meaning}</th>
            <th className="font-medium py-1 text-right">{t.opView.value}</th>
          </tr>
        </thead>
        <tbody>
          {graph.symbols.map((s) => (
            <tr key={s.name} className="border-t border-border-subtle align-top">
              <td className="py-1 pr-2 font-mono text-text-primary whitespace-nowrap">{s.name}</td>
              <td className="py-1 pr-2 text-text-secondary">{s.description}</td>
              <td className="py-1 font-mono text-right text-text-primary whitespace-nowrap">
                {s.value ?? <span className="text-text-muted">{t.opView.runtime}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sidebar panel for the OP view: selected op details, or model overview + symbols. */
export default function OpNodeInfo() {
  const { t } = useI18n();
  const opGraph = useDashboardStore((s) => s.opGraph);
  const selectedId = useDashboardStore((s) => s.selectedOpNodeId);
  const selectOpNode = useDashboardStore((s) => s.selectOpNode);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  if (!opGraph) return null;

  const byId = new Map(opGraph.nodes.map((n) => [n.id, n]));
  const node = selectedId ? byId.get(selectedId) : undefined;

  if (!node) {
    const { model } = opGraph;
    return (
      <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
          {t.opView.title}
        </div>
        <h2 className="text-lg font-heading text-text-primary mb-2">{model.name}</h2>
        {model.description && (
          <p className="text-sm text-text-secondary mb-3 leading-relaxed">{model.description}</p>
        )}
        {model.configSource && (
          <div className="text-xs text-text-secondary mb-4">
            <span className="text-text-muted">{t.opView.config}: </span>
            <span className="font-mono">{model.configSource}</span>
          </div>
        )}
        <SymbolsTable graph={opGraph} />
      </div>
    );
  }

  const stage = opGraph.stages.find((s) => s.id === node.stageId);
  const group = stage?.groups?.find((g) => g.id === node.groupId);
  const incoming = opGraph.edges.filter((e) => e.target === node.id);
  const outgoing = opGraph.edges.filter((e) => e.source === node.id);
  const ref = node.refNodeId ? byId.get(node.refNodeId) : undefined;

  return (
    <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <KindBadge node={node} />
        {stage && <span className="text-[10px] text-text-muted">{stage.title}</span>}
        {group && (
          <span className="text-[10px] text-text-muted">
            › {group.title}
            {group.kind === "repeat" && group.repeat ? ` ×${group.repeat}` : ""}
          </span>
        )}
      </div>
      <h2 className="text-lg font-heading text-text-primary mb-1">{node.name}</h2>
      {node.op && <div className="font-mono text-xs text-text-secondary mb-3">{node.op}</div>}
      {node.summary && (
        <p className="text-sm text-text-secondary mb-3 leading-relaxed">{node.summary}</p>
      )}
      {(node.notes ?? []).map((n, i) => (
        <p key={i} className="text-xs text-accent mb-1">{n}</p>
      ))}
      {node.module && (
        <div className="text-xs text-text-secondary my-3">
          <span className="text-text-muted">{t.opView.module}: </span>
          <span className="font-mono">{node.module}</span>
        </div>
      )}
      {ref && (
        <button
          type="button"
          onClick={() => selectOpNode(ref.id)}
          className="text-xs text-accent hover:underline mb-3 block"
        >
          ↳ {ref.name}
        </button>
      )}
      {node.filePath && (
        <div className="text-xs text-text-secondary mb-4 rounded-lg border border-border-subtle bg-elevated/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-text-muted mb-1">{t.common.file}</div>
              <div className="font-mono truncate" title={node.filePath}>
                {node.filePath}
                {node.lineRange && (
                  <span className="ml-2 text-text-muted">
                    L{node.lineRange[0]}-{node.lineRange[1]}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => openCodeViewer(node.id)}
              className="shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border border-accent/30 text-accent hover:text-accent-bright hover:border-accent/60 transition-colors"
            >
              {t.opView.openSource}
            </button>
          </div>
        </div>
      )}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
            {t.common.connections}
          </h3>
          {incoming.map((e, i) => (
            <EdgeRow key={`in-${i}`} edge={e} other={byId.get(e.source)} dir="in" onSelect={selectOpNode} />
          ))}
          {outgoing.map((e, i) => (
            <EdgeRow key={`out-${i}`} edge={e} other={byId.get(e.target)} dir="out" onSelect={selectOpNode} />
          ))}
        </div>
      )}
    </div>
  );
}
