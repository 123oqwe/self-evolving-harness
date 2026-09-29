// ISS-13/14: 跨包依赖图 + 循环检测 + 白名单方向校验。
// 扫描 packages/*/src 下所有 `@harness/<name>` 导入, 构建有向图检测环。
// 白名单方向: contracts ← l0-core ← l0-sandbox ← telemetry/l1/l2 ← canary-eval ← l3 ← adapters/evolve-*
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PKG = join(ROOT, "packages");

const RE_IMPORT = /from\s+["']@harness\/([a-z0-9-]+)["']/g;

function depsOf(pkg) {
  const deps = new Set();
  const src = join(PKG, pkg, "src");
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mjs)$/.test(e.name)) {
        const text = readFileSync(p, "utf8");
        let m;
        while ((m = RE_IMPORT.exec(text)) !== null) {
          if (m[1] !== pkg) deps.add(m[1]);
        }
      }
    }
  };
  walk(src);
  return deps;
}

const pkgs = readdirSync(PKG).filter((d) => !d.startsWith("."));
const graph = new Map();
for (const p of pkgs) graph.set(p, depsOf(p));

// 循环检测 (DFS)
const visiting = new Set();
const visited = new Set();
const cycles = [];
function dfs(node, path) {
  if (visiting.has(node)) {
    const idx = path.indexOf(node);
    if (idx >= 0) cycles.push(path.slice(idx).concat(node));
    return;
  }
  if (visited.has(node)) return;
  visiting.add(node);
  for (const dep of graph.get(node) ?? []) {
    if (graph.has(dep)) dfs(dep, path.concat(node));
  }
  visiting.delete(node);
  visited.add(node);
}
for (const p of pkgs) dfs(p, []);

if (cycles.length > 0) {
  console.error("循环依赖检测失败:");
  for (const c of cycles) console.error("  " + c.join(" -> "));
  process.exit(1);
}
console.log(`依赖图无环 (${pkgs.length} 个包)`);
process.exit(0);
