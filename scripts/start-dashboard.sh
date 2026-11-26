#!/usr/bin/env bash
# 分析项目(可选)并启动 Understand-Anything 仪表盘(含 OPs 视图)。
#
# 用法:
#   scripts/start-dashboard.sh [选项] <项目目录> [端口]
#
# 选项:
#   --ops-args "<参数>"  传给 /understand-ops 的参数,如 "DSpark --config config/x.py"
#   --reanalyze         即使已有 op-graph.json 也重新运行 /understand-ops
#   --no-analyze        不运行任何分析,只启动仪表盘
#   -y, --yes           运行分析前不再确认
#   -h, --help          显示帮助
#
# 行为:
#   缺 knowledge-graph.json 时先运行 /understand(仪表盘必须有它才能打开);
#   缺 op-graph.json(或指定 --reanalyze)时运行 /understand-ops;
#   之后启动仪表盘,终端打印 "🔑  Dashboard URL: http://127.0.0.1:<端口>/?token=..."。
#
# 分析通过 Claude Code CLI(claude -p)执行,会消耗 token。可用环境变量 CLAUDE_BIN 指定 CLI 路径。
#
# 示例:
#   scripts/start-dashboard.sh ~/code/FlashMLA
#   scripts/start-dashboard.sh --ops-args "--config configs/x.py" ~/code/FlashMLA 5174
#   scripts/start-dashboard.sh --no-analyze ~/code/DeepSpec
set -euo pipefail

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "错误: $*" >&2; exit 1; }

OPS_ARGS=""; REANALYZE=0; ANALYZE=1; ASSUME_YES=0; POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ops-args) [[ $# -ge 2 ]] || die "--ops-args 需要一个参数"; OPS_ARGS="$2"; shift 2 ;;
    --ops-args=*) OPS_ARGS="${1#*=}"; shift ;;
    --reanalyze) REANALYZE=1; shift ;;
    --no-analyze) ANALYZE=0; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) usage 0 ;;
    -*) die "未知选项: $1(用 --help 查看用法)" ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
[[ ${#POSITIONAL[@]} -ge 1 && ${#POSITIONAL[@]} -le 2 ]] || usage 1

PROJECT_INPUT="${POSITIONAL[0]}"
PORT="${POSITIONAL[1]:-5173}"
[[ -d "$PROJECT_INPUT" ]] || die "目录不存在: $PROJECT_INPUT"
PROJECT_DIR="$(cd "$PROJECT_INPUT" && pwd)"
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  die "端口需为 1024-65535 之间的数字: $PORT"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_ROOT="$REPO_ROOT/understand-anything-plugin"
DASHBOARD_DIR="$PLUGIN_ROOT/packages/dashboard"
CORE_DIR="$PLUGIN_ROOT/packages/core"

ua_dir() {
  if [[ -d "$PROJECT_DIR/.understand-anything" ]]; then echo "$PROJECT_DIR/.understand-anything"
  else echo "$PROJECT_DIR/.ua"; fi
}

# ---- 依赖与构建(save-op-graph.mjs 和仪表盘都需要 core) ----
command -v node >/dev/null || die "未安装 Node.js(需要 >= 18)"
if ! command -v pnpm >/dev/null; then
  if command -v corepack >/dev/null; then echo "→ 通过 corepack 启用 pnpm"; corepack enable pnpm
  else die "未安装 pnpm,请运行: npm install -g pnpm"; fi
fi
if [[ ! -d "$DASHBOARD_DIR/node_modules" || ! -d "$CORE_DIR/node_modules" ]]; then
  echo "→ 安装依赖(仅首次)"
  (cd "$REPO_ROOT" && (pnpm install --frozen-lockfile || pnpm install))
fi
if [[ ! -f "$CORE_DIR/dist/index.js" || "${REBUILD_CORE:-0}" == "1" ]]; then
  echo "→ 构建 @understand-anything/core"
  (cd "$REPO_ROOT" && pnpm --filter @understand-anything/core build)
fi

# ---- 分析(通过 Claude Code CLI 执行技能) ----
find_claude() {
  if [[ -n "${CLAUDE_BIN:-}" ]]; then
    command -v "$CLAUDE_BIN" 2>/dev/null && return 0
    return 1
  fi
  local c npm_bin=""
  command -v claude 2>/dev/null && return 0
  command -v npm >/dev/null && npm_bin="$(npm prefix -g 2>/dev/null)/bin/claude"
  for c in "$HOME/.claude/local/claude" "$HOME/.local/bin/claude" \
           "/opt/homebrew/bin/claude" "/usr/local/bin/claude" "$npm_bin"; do
    [[ -n "$c" && -x "$c" ]] && { echo "$c"; return 0; }
  done
  return 1
}
claude_missing() {
  cat >&2 <<EOF
错误: 未找到 Claude Code CLI${CLAUDE_BIN:+(CLAUDE_BIN=$CLAUDE_BIN)}。
脚本需要命令行版的 claude 来执行 /$1;Claude 桌面应用不提供这个命令。任选其一:
  1) 安装 CLI 后重试:  npm install -g @anthropic-ai/claude-code
     首次运行 claude 完成登录;若走公司网关,需设置 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN
  2) 已安装但不在 PATH:  CLAUDE_BIN=/path/to/claude bash $0 ...
  3) 在 Claude Code 或桌面应用里手动运行 /understand 和 /understand-ops,
     然后用 --no-analyze 只启动仪表盘
EOF
  exit 1
}
CLAUDE_PATH=""
run_skill() {  # $1 = 技能名, $2 = 技能参数
  local skill="$1" args="$2" skill_dir="$PLUGIN_ROOT/skills/$1"
  [[ -f "$skill_dir/SKILL.md" ]] || die "找不到技能: $skill_dir/SKILL.md"
  [[ -n "$CLAUDE_PATH" ]] || CLAUDE_PATH="$(find_claude)" || claude_missing "$skill"
  local prompt
  prompt="Run the /$skill skill on the project in the current working directory.
Skill instructions: $skill_dir/SKILL.md (read it and follow it exactly).
SKILL_DIR is $skill_dir and the plugin root is $PLUGIN_ROOT.
Skill arguments: ${args:-<none>}
Run non-interactively: make reasonable default choices instead of asking questions.
Skip the final 'launch the dashboard' phase; the calling script starts the dashboard itself."
  echo "→ 运行 /$skill ${args}(工作目录: $PROJECT_DIR)"
  ( cd "$PROJECT_DIR" && CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$CLAUDE_PATH" -p "$prompt" \
      --add-dir "$PLUGIN_ROOT" \
      --permission-mode acceptEdits \
      --allowedTools "Read,Write,Edit,Glob,Grep,Task,Agent,Bash" </dev/null ) \
    || die "/$skill 执行失败(见上方 claude 输出)。若提示 Not logged in,请先在终端运行 $CLAUDE_PATH 完成登录"
}

confirm() {
  (( ASSUME_YES )) && return 0
  [[ -t 0 ]] || die "非交互终端,请加 -y 确认运行分析,或加 --no-analyze 跳过"
  local ans; read -r -p "$1 [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

NEED_KG=0; NEED_OPS=0
UA_DIR="$(ua_dir)"
[[ -f "$UA_DIR/knowledge-graph.json" ]] || NEED_KG=1
[[ -f "$UA_DIR/op-graph.json" && $REANALYZE -eq 0 ]] || NEED_OPS=1

if (( ANALYZE )) && (( NEED_KG || NEED_OPS )); then
  CLAUDE_PATH="$(find_claude)" || claude_missing "$( (( NEED_KG )) && echo understand || echo understand-ops )"
  echo "→ 使用 Claude Code CLI: $CLAUDE_PATH"
  echo "将对 $PROJECT_DIR 运行:"
  (( NEED_KG ))  && echo "  · /understand(生成 knowledge-graph.json,仪表盘必需)"
  (( NEED_OPS )) && echo "  · /understand-ops ${OPS_ARGS}(生成 op-graph.json)"
  echo "  分析由 Claude Code 执行,会读取源码、写入 $(basename "$UA_DIR")/,并消耗 token。"
  confirm "继续?" || die "已取消"
  if (( NEED_KG )); then
    run_skill understand ""
    UA_DIR="$(ua_dir)"
    [[ -f "$UA_DIR/knowledge-graph.json" ]] || die "/understand 未生成 $UA_DIR/knowledge-graph.json"
  fi
  if (( NEED_OPS )); then
    run_skill understand-ops "$OPS_ARGS"
    UA_DIR="$(ua_dir)"
    [[ -f "$UA_DIR/op-graph.json" ]] || die "/understand-ops 未生成 $UA_DIR/op-graph.json"
  fi
fi

UA_DIR="$(ua_dir)"
[[ -f "$UA_DIR/knowledge-graph.json" ]] \
  || die "$UA_DIR/knowledge-graph.json 不存在,仪表盘无法打开。去掉 --no-analyze 重新运行,或先运行 /understand"
echo "✓ 代码结构图: $UA_DIR/knowledge-graph.json"
[[ -f "$UA_DIR/op-graph.json" ]] && echo "✓ OP 图:      $UA_DIR/op-graph.json" \
  || echo "· 未找到 op-graph.json(OPs 视图为空)"

echo "→ 启动仪表盘: $PROJECT_DIR (端口 $PORT),按 Ctrl+C 停止"
cd "$DASHBOARD_DIR"
GRAPH_DIR="$PROJECT_DIR" exec npx vite --host 127.0.0.1 --port "$PORT" --strictPort
