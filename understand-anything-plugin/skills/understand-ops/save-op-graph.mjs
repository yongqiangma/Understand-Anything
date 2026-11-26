#!/usr/bin/env node
// Validate `$UA_DIR/intermediate/op-analysis.json` (written by the op-analyzer
// agent) and persist the valid portion to `$UA_DIR/op-graph.json`.
//
// Usage: node save-op-graph.mjs <project-root>
// Exit codes: 0 saved (possibly with dropped items), 1 fatal validation error,
// 2 usage / missing input.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}
const { resolveUaDir, validateOpGraph, saveOpGraph } = core;

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error('Usage: node save-op-graph.mjs <project-root>');
  process.exit(2);
}

const input = join(resolveUaDir(projectRoot), 'intermediate', 'op-analysis.json');
if (!existsSync(input)) {
  console.error(`[understand-ops] Missing ${input}. Did the op-analyzer agent finish?`);
  process.exit(2);
}

let raw;
try {
  raw = JSON.parse(readFileSync(input, 'utf-8'));
} catch (err) {
  console.error(`[understand-ops] op-analysis.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

const result = validateOpGraph(raw);
const counts = { 'auto-corrected': 0, dropped: 0, fatal: 0 };
for (const issue of result.issues) {
  counts[issue.level] = (counts[issue.level] ?? 0) + 1;
  if (issue.level !== 'auto-corrected') {
    console.error(`[understand-ops] ${issue.level}: ${issue.path ? issue.path + ': ' : ''}${issue.message}`);
  }
}

if (!result.success || !result.data) {
  console.error(`[understand-ops] Fatal: ${result.fatal ?? 'unknown error'}`);
  process.exit(1);
}

saveOpGraph(projectRoot, result.data);
const g = result.data;
console.log(JSON.stringify({
  saved: join(resolveUaDir(projectRoot), 'op-graph.json'),
  stages: g.stages.length,
  nodes: g.nodes.length,
  edges: g.edges.length,
  symbols: g.symbols.length,
  autoCorrected: counts['auto-corrected'],
  dropped: counts.dropped,
}));
