/**
 * L0S-T05 — canary grep 后端
 *
 * 遍历三个确定性数据源 grep canary token：
 *   (1) proxy egress 日志（redact 前的原始出站请求）；
 *   (2) sandbox 单次 runVerify 捕获的 stdout + stderr；
 *   (3) sandbox 可写文件目录（FsRules.allowWrite subtree，排除 denyRead）。
 *
 * 后端抽象（spec REFACTOR）：优先用字符串 `includes` 做命中判定，文件遍历用
 * Node `fs.readdir` 递归。hits 报告 { location, snippet }，snippet 为 canary
 * 命中点前后定长窗口，供 TL-T01 JSONL 落档。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { EgressRequest } from "../credential-masking/masking-proxy.js";

/** canary 命中报告项。 */
export interface CanaryHit {
  location: string;
  snippet: string;
}

/** snippet 窗口半径（命中点前后各取这么多字符）。 */
const SNIPPET_WINDOW = 64;

/**
 * 在 content 中 grep canary，返回每个命中点的窗口 snippet。
 * 返回空数组 = 0 命中。
 */
export function grepString(content: string, canary: string): string[] {
  if (!canary || canary.length === 0 || content.length === 0) return [];
  if (!content.includes(canary)) return [];
  const snippets: string[] = [];
  let idx = content.indexOf(canary);
  while (idx !== -1) {
    const start = Math.max(0, idx - SNIPPET_WINDOW);
    const end = Math.min(content.length, idx + canary.length + SNIPPET_WINDOW);
    snippets.push(content.slice(start, end));
    idx = content.indexOf(canary, idx + canary.length);
  }
  return snippets;
}

/**
 * 在原始 egress 请求（redact 前）中 grep canary。返回带字段定位的 snippet
 * 列表（形如 `Authorization: <snippet>` / `body: <snippet>` / `url: <snippet>`）。
 */
export function grepEgressRequest(req: EgressRequest, canary: string): string[] {
  const out: string[] = [];
  if (typeof req.url === "string" && req.url.length > 0) {
    for (const s of grepString(req.url, canary)) out.push(`url: ${s}`);
  }
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") {
      for (const s of grepString(v, canary)) out.push(`${k}: ${s}`);
    }
  }
  if (typeof req.body === "string" && req.body.length > 0) {
    for (const s of grepString(req.body, canary)) out.push(`body: ${s}`);
  }
  return out;
}

/**
 * 在 sandbox stdout/stderr capture 中 grep canary。返回带 `stdout:` / `stderr:`
 * 前缀的 snippet 列表。
 */
export function grepCapture(
  stdout: string,
  stderr: string,
  canary: string,
): string[] {
  const out: string[] = [];
  for (const s of grepString(stdout, canary)) out.push(`stdout: ${s}`);
  for (const s of grepString(stderr, canary)) out.push(`stderr: ${s}`);
  return out;
}

/**
 * 递归扫描 allowWrite subtree 下所有文件，grep canary。命中项 location 形如
 * `file:<absPath>`。denyRead 路径前缀下的文件跳过（不读，防自指探测）。
 */
export function grepFiles(
  roots: string[],
  denyRead: string[],
  canary: string,
): CanaryHit[] {
  if (!canary || canary.length === 0) return [];
  const hits: CanaryHit[] = [];

  const isDenied = (p: string): boolean =>
    denyRead.some((d) => d.length > 0 && (p === d || p.startsWith(d)));

  const scan = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      if (isDenied(full)) continue;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        scan(full);
      } else if (st.isFile()) {
        let content: string;
        try {
          content = readFileSync(full, "utf8");
        } catch {
          continue;
        }
        for (const s of grepString(content, canary)) {
          hits.push({ location: `file:${full}`, snippet: s });
        }
      }
    }
  };

  for (const r of roots) {
    if (typeof r === "string" && r.length > 0) scan(r);
  }
  return hits;
}
