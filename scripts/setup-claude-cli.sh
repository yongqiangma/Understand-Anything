#!/usr/bin/env bash
# 安装 Claude Code CLI,并按 Claude 桌面应用(第三方网关模式)的配置写入 ~/.claude/settings.json。
#
# 用法:
#   scripts/setup-claude-cli.sh [选项]
#
# 选项:
#   --dry-run         只显示将写入的配置(密钥打码),不安装、不写文件
#   --skip-install    不安装 CLI,只做配置
#   --model <id>      指定默认模型(默认取桌面配置中的第一个模型)
#   --no-verify       写完配置后不调用 claude -p 做连通性测试
#   --ask-key         忽略桌面配置里读到的密钥,手动输入
#   -h, --help        显示帮助
#
# 读取顺序(先找到的优先):
#   1) MDM 托管配置  /Library/Managed Preferences/[<用户>/]com.anthropic.claudefordesktop.plist
#   2) 本地配置库    ~/Library/Application Support/Claude-3p/configLibrary/
# 读到的 inferenceGatewayBaseUrl / AuthScheme / Models / CustomHeaders 会转成
# ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY / ANTHROPIC_MODEL / ANTHROPIC_CUSTOM_HEADERS。
# 密钥若在桌面配置中是加密的或用了 SSO,脚本会让你手动输入(输入不回显)。
# 写入前会备份原 settings.json,只改 env 等相关字段,其他设置保持不变。
set -euo pipefail

usage() { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "错误: $*" >&2; exit 1; }
info() { echo "→ $*"; }

DRY_RUN=0; SKIP_INSTALL=0; VERIFY=1; ASK_KEY=0; MODEL_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --no-verify) VERIFY=0; shift ;;
    --ask-key) ASK_KEY=1; shift ;;
    --model) [[ $# -ge 2 ]] || die "--model 需要一个参数"; MODEL_OVERRIDE="$2"; shift 2 ;;
    --model=*) MODEL_OVERRIDE="${1#*=}"; shift ;;
    -h|--help) usage 0 ;;
    *) die "未知参数: $1(用 --help 查看用法)" ;;
  esac
done

command -v node >/dev/null || die "需要 Node.js >= 18(仪表盘本身也需要),请先安装: https://nodejs.org 或 brew install node"

APP_SUPPORT="${CLAUDE_3P_DIR:-$HOME/Library/Application Support/Claude-3p}"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

# ---------- 1. 安装 CLI ----------
find_claude() {
  command -v claude 2>/dev/null && return 0
  local c npm_bin=""
  command -v npm >/dev/null && npm_bin="$(npm prefix -g 2>/dev/null)/bin/claude"
  for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" \
           "/opt/homebrew/bin/claude" "/usr/local/bin/claude" "$npm_bin"; do
    [[ -n "$c" && -x "$c" ]] && { echo "$c"; return 0; }
  done
  return 1
}

CLAUDE_PATH="$(find_claude || true)"
if [[ -n "$CLAUDE_PATH" ]]; then
  info "已安装 Claude Code CLI: $CLAUDE_PATH ($("$CLAUDE_PATH" --version 2>/dev/null || echo '版本未知'))"
elif (( SKIP_INSTALL || DRY_RUN )); then
  info "未安装 Claude Code CLI(--skip-install/--dry-run,跳过安装)"
else
  info "安装 Claude Code CLI"
  if command -v npm >/dev/null && npm install -g @anthropic-ai/claude-code; then
    :
  else
    echo "  npm 全局安装失败(常见原因是全局目录无写权限),改用官方安装脚本"
    command -v curl >/dev/null || die "没有 curl,无法下载官方安装脚本"
    curl -fsSL https://claude.ai/install.sh | bash || die "安装失败。可手动运行: npm install -g @anthropic-ai/claude-code"
  fi
  hash -r
  CLAUDE_PATH="$(find_claude || true)"
  [[ -n "$CLAUDE_PATH" ]] || die "安装完成但找不到 claude,请把 ~/.local/bin 或 \$(npm prefix -g)/bin 加入 PATH 后重试"
  info "安装完成: $CLAUDE_PATH"
  case ":$PATH:" in *":$(dirname "$CLAUDE_PATH"):"*) ;;
    *) echo "  注意: $(dirname "$CLAUDE_PATH") 不在 PATH 中,建议加入 ~/.zshrc: export PATH=\"$(dirname "$CLAUDE_PATH"):\$PATH\"" ;;
  esac
fi

# ---------- 2. 读取桌面应用的网关配置 ----------
SOURCES=()
for p in "/Library/Managed Preferences/$(id -un)/com.anthropic.claudefordesktop.plist" \
         "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist"; do
  [[ -r "$p" ]] || continue
  if command -v plutil >/dev/null && plutil -convert json -o "$TMPD/mdm.json" "$p" 2>/dev/null; then
    SOURCES+=("MDM|$TMPD/mdm.json|$p")
  fi
  break
done
[[ -d "$APP_SUPPORT/configLibrary" ]] && SOURCES+=("LIB|$APP_SUPPORT/configLibrary|")

cat > "$TMPD/read.mjs" <<'JS'
import fs from "node:fs"; import path from "node:path";
const out = {}; const keys = ["inferenceProvider","inferenceGatewayBaseUrl","inferenceGatewayApiKey",
  "inferenceGatewayAuthScheme","inferenceModels","inferenceCustomHeaders","inferenceCredentialKind",
  "inferenceCredentialHelper"];
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
function collect(o, src) {            // 递归找键,先找到的优先
  if (!o || typeof o !== "object") return;
  for (const [k, v] of Object.entries(o)) {
    if (keys.includes(k) && out[k] === undefined && v !== "" && v !== null) out[k] = v;
    else if (v && typeof v === "object" && !keys.includes(k)) collect(v, src);
  }
  if (Object.keys(out).length && !out._source) out._source = src;
}
function pickLib(dir) {               // _meta.json 中记录的已应用配置;否则取最近修改的
  const meta = readJson(path.join(dir, "_meta.json")) || {};
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json") && f !== "_meta.json");
  const ids = new Set(files.map(f => f.slice(0, -5)));
  const find = o => { if (!o || typeof o !== "object") return null;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && ids.has(v) && /appl|activ|current|select/i.test(k)) return v;
      if (v && typeof v === "object") { const r = find(v); if (r) return r; } }
    return null; };
  let id = find(meta);
  if (!id) { for (const v of JSON.stringify(meta).match(/"([^"]+)"/g) || []) { const s = v.slice(1, -1); if (ids.has(s)) { id = s; break; } } }
  if (!id && files.length) id = files.map(f => [f, fs.statSync(path.join(dir, f)).mtimeMs]).sort((a, b) => b[1] - a[1])[0][0].slice(0, -5);
  return id ? path.join(dir, id + ".json") : null;
}
for (const s of process.argv.slice(2)) {
  const [kind, p, label] = s.split("|");
  if (kind === "MDM") collect(readJson(p), "MDM " + (label || p));
  if (kind === "LIB") { const f = pickLib(p); if (f) collect(readJson(f), f); }
}
// 规范化
const m = out.inferenceModels; let models = [];
const asArr = v => typeof v === "string" ? (v.trim().startsWith("[") ? (readJsonStr(v) || []) : v.split(/[,\n]/)) : (Array.isArray(v) ? v : []);
function readJsonStr(s) { try { return JSON.parse(s); } catch { return null; } }
for (const x of asArr(m)) { const id = typeof x === "string" ? x.trim() : (x && (x.id || x.model || x.name)); if (id) models.push(String(id)); }
let h = out.inferenceCustomHeaders; if (typeof h === "string" && /^[\[{]/.test(h.trim())) h = readJsonStr(h) ?? h;
let headers = "";
if (Array.isArray(h)) headers = h.map(x => typeof x === "string" ? x : (x && x.name ? `${x.name}: ${x.value ?? ""}` : "")).filter(Boolean).join("\n");
else if (h && typeof h === "object") headers = Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\n");
else if (typeof h === "string") headers = h;
const key = out.inferenceGatewayApiKey;
const keyUsable = typeof key === "string" && key.length >= 8 && /^[\x21-\x7e]+$/.test(key)
  && !/^(v1\d|djE[wx]|enc:|encrypted)/i.test(key);
const helper = typeof out.inferenceCredentialHelper === "string" ? out.inferenceCredentialHelper
  : (out.inferenceCredentialHelper && (out.inferenceCredentialHelper.command || out.inferenceCredentialHelper.path)) || "";
fs.writeFileSync(process.env.OUT, JSON.stringify({
  source: out._source || "", provider: out.inferenceProvider || "",
  baseUrl: typeof out.inferenceGatewayBaseUrl === "string" ? out.inferenceGatewayBaseUrl.trim() : "",
  scheme: String(out.inferenceGatewayAuthScheme || "bearer").toLowerCase(),
  models, headers, credKind: out.inferenceCredentialKind || "", helper,
  hasKey: key !== undefined, key: keyUsable ? key : "" }));
JS
OUT="$TMPD/cfg.json" node "$TMPD/read.mjs" "${SOURCES[@]+"${SOURCES[@]}"}" \
  || die "解析桌面配置失败"
chmod 600 "$TMPD/cfg.json"
cfg() { node -e 'const c=require(process.argv[1]);const v=c[process.argv[2]];process.stdout.write(Array.isArray(v)?v.join("\n"):String(v??""))' "$TMPD/cfg.json" "$1"; }

# ---------- 3. 汇总、补全缺失项 ----------
SRC="$(cfg source)"; BASE_URL="$(cfg baseUrl)"; SCHEME="$(cfg scheme)"
HEADERS="$(cfg headers)"; CRED_KIND="$(cfg credKind)"; HELPER="$(cfg helper)"
API_KEY="$(cfg key)"; HAS_KEY="$(cfg hasKey)"
MODELS=(); while IFS= read -r l || [[ -n "$l" ]]; do [[ -n "$l" ]] && MODELS+=("$l"); done < <(cfg models)

if [[ -n "$SRC" ]]; then info "读取到桌面应用配置: $SRC"
else echo "· 没有读到桌面应用的网关配置,需要手动输入"; fi

ask() {  # $1 提示, $2 变量名, $3=secret 时不回显
  [[ -t 0 ]] || die "缺少「$1」且当前不是交互终端,无法输入"
  local v
  if [[ "${3:-}" == secret ]]; then read -r -s -p "$1: " v; echo; else read -r -p "$1: " v; fi
  printf -v "$2" '%s' "$v"
}
[[ -n "$BASE_URL" ]] || ask "网关地址 (ANTHROPIC_BASE_URL,例如 https://gateway.example.com)" BASE_URL
BASE_URL="${BASE_URL%/}"
[[ "$BASE_URL" =~ ^https?:// ]] || die "网关地址需以 http:// 或 https:// 开头: $BASE_URL"
[[ "$SCHEME" == "x-api-key" || "$SCHEME" == "bearer" ]] || SCHEME="bearer"

USE_HELPER=0
(( ASK_KEY )) && { API_KEY=""; HELPER=""; HAS_KEY=false; }
if [[ -z "$API_KEY" ]]; then
  if [[ -n "$HELPER" ]]; then
    USE_HELPER=1; info "桌面配置使用凭据助手,CLI 同样使用它: apiKeyHelper = $HELPER"
  elif (( DRY_RUN )); then
    API_KEY="<将在实际运行时输入>"
  else
    if [[ "$CRED_KIND" == "interactive" ]]; then
      echo "· 桌面应用用的是 SSO 登录(inferenceCredentialKind=interactive),CLI 无法复用该登录态。"
      echo "  请输入管理员发放的网关 API Key,或用 --dry-run 查看后手动在 settings.json 里配置 apiKeyHelper。"
    elif [[ "$HAS_KEY" == "true" ]]; then
      echo "· 桌面配置里的 API Key 是加密存储的(系统钥匙串),脚本读不到明文,请手动输入一次。"
    fi
    ask "网关 API Key(输入不回显)" API_KEY secret
    [[ -n "$API_KEY" ]] || die "API Key 不能为空"
  fi
fi

MODEL="${MODEL_OVERRIDE:-${MODELS[0]:-}}"
[[ -n "$MODEL" ]] || { (( DRY_RUN )) && MODEL="<未设置>" || ask "默认模型 ID (ANTHROPIC_MODEL,如 claude-sonnet-4-5)" MODEL; }
pick() {  # 按名称(不区分大小写)挑选同族模型,找不到就用默认模型
  local m lc; for m in "${MODELS[@]+"${MODELS[@]}"}"; do
    lc="$(printf '%s' "$m" | tr '[:upper:]' '[:lower:]')"
    [[ "$lc" == *"$1"* ]] && { echo "$m"; return; }
  done; echo "$MODEL"; }
OPUS_M="$(pick opus)"; SONNET_M="$(pick sonnet)"; HAIKU_M="$(pick haiku)"

# ---------- 4. 合并写入 ~/.claude/settings.json ----------
cat > "$TMPD/merge.mjs" <<'JS'
import fs from "node:fs";
const E = process.env, file = E.SETTINGS;
let s = {};
if (fs.existsSync(file)) {
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { console.error(`错误: ${file} 不是合法 JSON,请先修复或移走它`); process.exit(2); }
}
const env = { ...(s.env || {}) };
env.ANTHROPIC_BASE_URL = E.BASE_URL;
delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_API_KEY;
if (E.USE_HELPER === "1") s.apiKeyHelper = E.HELPER;
else { delete s.apiKeyHelper; env[E.SCHEME === "x-api-key" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"] = E.API_KEY; }
const set = (k, v) => { if (v) env[k] = v; else delete env[k]; };
set("ANTHROPIC_MODEL", E.MODEL);
set("ANTHROPIC_DEFAULT_OPUS_MODEL", E.OPUS_M);
set("ANTHROPIC_DEFAULT_SONNET_MODEL", E.SONNET_M);
set("ANTHROPIC_DEFAULT_HAIKU_MODEL", E.HAIKU_M);
set("ANTHROPIC_CUSTOM_HEADERS", E.HEADERS);
s.env = env;
const text = JSON.stringify(s, null, 2) + "\n";
if (E.DRY_RUN === "1") {
  const mask = v => v.length <= 8 ? "****" : v.slice(0, 4) + "****" + v.slice(-4);
  const shown = JSON.parse(text);
  for (const k of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]) if (shown.env[k] && !shown.env[k].startsWith("<")) shown.env[k] = mask(shown.env[k]);
  if (shown.env.ANTHROPIC_CUSTOM_HEADERS) shown.env.ANTHROPIC_CUSTOM_HEADERS = "<已设置,内容不显示>";
  console.log(JSON.stringify(shown, null, 2));
} else {
  fs.writeFileSync(file, text, { mode: 0o600 }); fs.chmodSync(file, 0o600);
}
JS

if (( DRY_RUN )); then
  info "[dry-run] 将写入 $SETTINGS 的内容(密钥已打码):"
else
  mkdir -p "$(dirname "$SETTINGS")"
  if [[ -f "$SETTINGS" ]]; then
    BACKUP="$SETTINGS.bak.$(date +%Y%m%d-%H%M%S)"
    cp -p "$SETTINGS" "$BACKUP"; chmod 600 "$BACKUP"
    info "已备份原配置: $BACKUP"
  fi
fi
# 密钥只经环境变量传给 node,不出现在命令行参数和日志中
SETTINGS="$SETTINGS" DRY_RUN="$DRY_RUN" BASE_URL="$BASE_URL" SCHEME="$SCHEME" API_KEY="$API_KEY" \
USE_HELPER="$USE_HELPER" HELPER="$HELPER" MODEL="$MODEL" OPUS_M="$OPUS_M" SONNET_M="$SONNET_M" \
HAIKU_M="$HAIKU_M" HEADERS="$HEADERS" node "$TMPD/merge.mjs" || die "写入 $SETTINGS 失败"
unset API_KEY

AUTH_DESC="$([[ $USE_HELPER == 1 ]] && echo "apiKeyHelper" || { [[ $SCHEME == x-api-key ]] && echo "ANTHROPIC_API_KEY (x-api-key)" || echo "ANTHROPIC_AUTH_TOKEN (Bearer)"; })"
echo "  网关:   $BASE_URL"
echo "  认证:   $AUTH_DESC"
echo "  模型:   $MODEL  (opus=$OPUS_M, sonnet=$SONNET_M, haiku=$HAIKU_M)"
[[ -n "$HEADERS" ]] && echo "  自定义请求头: $(printf '%s\n' "$HEADERS" | sed 's/:.*//' | paste -sd, -)"
(( DRY_RUN )) && { info "[dry-run] 未写入任何文件"; exit 0; }
info "已写入 $SETTINGS(权限 600)"

# ---------- 5. 连通性测试 ----------
if (( VERIFY )) && [[ -n "$CLAUDE_PATH" ]]; then
  info "测试: claude -p \"Reply with just OK\""
  if REPLY="$(cd "$TMPD" && "$CLAUDE_PATH" -p "Reply with just OK" </dev/null 2>&1)"; then
    echo "  模型回复: $(printf '%s' "$REPLY" | head -c 200)"
    info "配置完成。现在可以运行: bash scripts/start-dashboard.sh ~/code/FlashMLA"
  else
    echo "  调用失败:"; printf '%s\n' "$REPLY" | head -20 | sed 's/^/    /'
    cat <<EOF
  排查建议:
    · 401/403: 密钥错误或认证方式不对,可重新运行本脚本;若网关要求 x-api-key,把桌面配置的 AuthScheme 设为 x-api-key 后重试
    · 404/模型不存在: 用 --model <网关里的模型ID> 重新运行
    · 网络/证书错误: 公司代理需设置 HTTPS_PROXY,自签证书需设置 NODE_EXTRA_CA_CERTS
    · 恢复旧配置: cp "${BACKUP:-<无备份>}" "$SETTINGS"
EOF
    exit 1
  fi
fi
