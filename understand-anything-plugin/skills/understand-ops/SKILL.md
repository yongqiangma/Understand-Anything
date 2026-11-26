---
name: understand-ops
description: Extract the deep-learning op graph of a model codebase (PyTorch/JAX/etc.) — nn.Module and tensor-function ops grouped by stage, with symbolic shapes on data-flow edges — and show it in the dashboard OP view.
argument-hint: "[model-or-entry-hint] [--config <path>] [--full]"
---

# /understand-ops

Builds an **op-level architecture graph** for a deep-learning model: which modules and tensor ops run, in what order, how tensors flow between them, and what shape each tensor has. The result is `op-graph.json` in the project's data directory and is rendered by the dashboard's **OP view** (stage tabs, trainable / frozen / param-free op colouring, shape labels on edges, symbolic ⇄ numeric shape toggle).

It complements the class-level `/understand` graph instead of replacing it: the structural view keeps listing files, classes and functions; the OP view lists the ops inside them.

## How It Works

- If a knowledge graph exists (`.ua/knowledge-graph.json`, or legacy `.understand-anything/knowledge-graph.json`), use it to locate the model, layer, loss, head and decode-loop code quickly (cheap). Otherwise locate them by searching the source tree.
- The **op-analyzer** agent reads those source files plus the model config, then writes `$UA_DIR/intermediate/op-analysis.json`.
- `save-op-graph.mjs` validates it (error tolerant: invalid items are dropped, aliases normalised) and saves `$UA_DIR/op-graph.json`.

Arguments:

- `model-or-entry-hint` (optional): a class name, file, or directory to focus on, e.g. `DSparkQwen3` or `deepspec/modeling/dspark`. If omitted, pick the main model of the project; if several equally important models exist, analyse the one the README/configs feature first and mention the others in the final report.
- `--config <path>` (optional): the config file whose concrete values fill `shapeValue` / symbol values (e.g. `config/dspark/dspark_qwen3_4b.py`).
- `--full`: ignore an existing knowledge graph and locate code by searching.

## Instructions

### Phase 0: Resolve `PROJECT_ROOT`

Set `PROJECT_ROOT` to the current working directory.

**Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), redirect output to the main repository root. Worktrees managed by Claude Code are ephemeral — the data directory (`.ua/`, or legacy `.understand-anything/`) written there is destroyed when the session ends, taking the op graph with it (issue #133). Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ and the parent of `--git-common-dir` is the main repo root.

```bash
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      echo "[understand-ops] Detected git worktree at $PROJECT_ROOT"
      echo "[understand-ops] Redirecting output to main repo root: $MAIN_ROOT"
      echo "[understand-ops] (Set UNDERSTAND_NO_WORKTREE_REDIRECT=1 to keep PROJECT_ROOT as the worktree.)"
      PROJECT_ROOT="$MAIN_ROOT"
    fi
  fi
fi
```

Use `$PROJECT_ROOT` (not the bare CWD) for every reference to "the current project" / `<project-root>` in subsequent phases.

**Resolve the data directory `$UA_DIR`.** All Understand-Anything artifacts live in the project's data directory. Resolve it once, now that `$PROJECT_ROOT` is known, and reuse `$UA_DIR` for every read and write in later phases:
```bash
UA_DIR="$PROJECT_ROOT/$([ -d "$PROJECT_ROOT/.understand-anything" ] && echo .understand-anything || echo .ua)"
```
This keeps the legacy `.understand-anything/` directory when it already exists (existing projects keep working with no migration) and uses the new `.ua/` otherwise. Because each phase may run in a fresh shell, carry `$UA_DIR` forward like `$PROJECT_ROOT`, re-resolving it with the line above if a later command block needs it.

**Important:** do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/understand-ops` is a symlink into the real plugin checkout. Prefer runtime-provided plugin roots first (for Claude), then fall back to universal symlinks, skill symlink resolution, and common clone-based install paths.

Resolve the plugin root like this. Substitute `<SKILL_DIR>` with this skill's directory (the base directory your platform reported when loading this skill) — this is how plugin installs with no fixed location, such as Devin's, are found:

```bash
SKILL_DIR_RELATIVE=$(cd -P "<SKILL_DIR>" 2>/dev/null && cd ../.. && pwd || echo "")
SKILL_REAL=$(realpath ~/.agents/skills/understand-ops 2>/dev/null || readlink -f ~/.agents/skills/understand-ops 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand-ops 2>/dev/null || readlink -f ~/.copilot/skills/understand-ops 2>/dev/null || echo "")
COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

PLUGIN_ROOT=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT}" \
  "${DEVIN_PLUGIN_ROOT}" \
  "$SKILL_DIR_RELATIVE" \
  "$HOME/.understand-anything-plugin" \
  "$SELF_RELATIVE" \
  "$COPILOT_SELF_RELATIVE" \
  "$HOME/.codex/understand-anything/understand-anything-plugin" \
  "$HOME/.opencode/understand-anything/understand-anything-plugin" \
  "$HOME/.pi/understand-anything/understand-anything-plugin" \
  "$HOME/understand-anything/understand-anything-plugin"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
    PLUGIN_ROOT="$candidate"
    break
  fi
done

if [ -z "$PLUGIN_ROOT" ]; then
  echo "Error: Cannot find the understand-anything plugin root."
  echo "Checked:"
  echo "  - ${CLAUDE_PLUGIN_ROOT:-<unset CLAUDE_PLUGIN_ROOT>}"
  echo "  - ${DEVIN_PLUGIN_ROOT:-<unset DEVIN_PLUGIN_ROOT>}"
  echo "  - ${SKILL_DIR_RELATIVE:-<unresolved path derived from the skill directory>}"
  echo "  - $HOME/.understand-anything-plugin"
  echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/understand-ops>}"
  echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/understand-ops>}"
  echo "  - $HOME/.codex/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.opencode/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.pi/understand-anything/understand-anything-plugin"
  echo "  - $HOME/understand-anything/understand-anything-plugin"
  echo "Make sure the plugin is installed correctly."
  exit 1
fi
```

Use `$PLUGIN_ROOT` for every reference to agent definitions in subsequent phases.

**Ensure core is built.** `save-op-graph.mjs` imports `@understand-anything/core`:

```bash
if [ ! -f "$PLUGIN_ROOT/packages/core/dist/index.js" ]; then
  cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @understand-anything/core build
fi
mkdir -p "$UA_DIR/intermediate"
```

### Phase 1: Locate the model code

1. If `$UA_DIR/knowledge-graph.json` exists and `--full` was not passed, read it and collect candidate nodes whose name, summary, tags or filePath mention model building blocks: `nn.Module` subclasses, `forward`, attention / MLP / norm / embedding / head / loss / decoder layer, `generate` / decode / sampling / speculative loops, configs. Record their `filePath` and `lineRange`. Do the same freshness check as `/understand-domain` Phase 1 (best-effort warning only, never block).
2. Otherwise (or to fill gaps) search the source tree, skipping the data directory, virtualenvs, `node_modules`, and tests:
   ```bash
   cd "$PROJECT_ROOT" && grep -rlE "nn\\.Module|torch\\.nn|flax\\.linen|def forward\\(|def __call__\\(" --include=*.py . | grep -vE "/(\\.ua|\\.understand-anything|\\.venv|venv|node_modules|tests?)/" | head -200
   ```
3. Pick the **target model** (honour `model-or-entry-hint`). Build a short file list, typically 3–15 files:
   - the top-level model class and its decoder/encoder layer, attention, MLP, norm, embedding;
   - the training entry: input construction (masking, anchor / block sampling, position ids), loss and output heads;
   - the inference entry: generate / decode / verify / accept loop, if present;
   - the config file (`--config`, or the one matching the model name). Read concrete hyper-parameters from it.
4. Get project metadata for the `project` block: name, languages, frameworks, a one-line description, `analyzedAt` (ISO now), and `gitCommitHash` (`git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo ""`).

### Phase 2: Op analysis

1. Read the agent prompt at `$PLUGIN_ROOT/agents/op-analyzer.md`.
2. Dispatch one subagent with that prompt plus: `PROJECT_ROOT`, the output path `$UA_DIR/intermediate/op-analysis.json`, the project metadata, the file list from Phase 1 (with line ranges and knowledge-graph node ids when known), the chosen config path, and any user hint.
3. The agent reads the listed files itself and writes the op graph JSON to the output path. Wait for it to finish.

### Phase 3: Validate and save

```bash
node "<SKILL_DIR>/save-op-graph.mjs" "$PROJECT_ROOT"
```

- Exit 0: saved. Report the printed counts; if `dropped > 0`, show the dropped lines from stderr. When more than ~20% of nodes or edges were dropped, re-dispatch the op-analyzer once with the stderr messages and ask it to fix only those items, then re-run the script.
- Exit 1 (fatal): show the error, re-dispatch the op-analyzer once with the error, re-run. If it fails again, stop and report.
- After success, delete `$UA_DIR/intermediate/op-analysis.json`.

### Phase 4: Launch the dashboard

Auto-trigger `/understand-dashboard`. The dashboard detects `op-graph.json` and shows an **OP** toggle in the header next to Domain / Structural. Tell the user they can switch shapes between symbolic and the config's numeric values with the toggle in the OP view.
