/**
 * L0S-T03 — FsRules 解析 + prefix match + narrower-allow-reopens-wider-deny。
 *
 * 规则算法（裁决 L0S-T03）：
 * - A1：`reason` 格式 `'<ruleKind>: <resolved absolute prefix>'`，
 *   ruleKind ∈ {denyRead, denyWrite, allowRead, allowWrite}。
 * - A2：最长前缀匹配；allow 与 deny 前缀等长时 allow 优先
 *   （narrower-allow 重开 wider-deny 的退化情形）。
 * - A3：`isDenied` 内部自动 `fs.realpath` 解析 symlink 后再匹配。
 * - A5：`denyRead` 路径同时禁止 read 与 write（写包含读语义）。
 *
 * L0S-R3（ERRATA 固化）：当某 path 未命中任何 deny 前缀 = 无约束语义，
 * 返回 denied=false（默认 allow），与「both-empty=无约束」一致。
 */

import type { FsRules } from "../os-sandbox/types.js";
import { resolveSymlink } from "./normalize.js";

/** 解析后的 FsRules：所有前缀均为规范化绝对路径。 */
export interface ResolvedFsRules {
  allowWrite: string[];
  denyWrite: string[];
  denyRead: string[];
  allowRead: string[];
}

/**
 * 把 FsRules 中所有 `~`/相对前缀展开为规范化绝对路径。
 * `workspaceCwd` 用于将来策略注入（A6：写范围由 FsRules 表达）。
 */
export function resolveFsRules(
  rules: FsRules,
  _workspaceCwd: string,
): ResolvedFsRules {
  // 规则前缀同样经 resolveSymlink 规范化（realpath canonical），
  // 与 isDenied 对输入 path 的 realpath 解析保持同一基准，
  // 避免 /tmp → /private/tmp 之类 OS symlink 造成的前缀错配。
  const resolveAll = (arr: readonly string[]): string[] =>
    arr.map((p) => resolveSymlink(p));
  return {
    allowWrite: resolveAll(rules.allowWrite),
    denyWrite: resolveAll(rules.denyWrite),
    denyRead: resolveAll(rules.denyRead),
    allowRead: resolveAll(rules.allowRead),
  };
}

/** 路径边界感知的前缀匹配。root `/` 匹配一切绝对路径。 */
function prefixMatches(path: string, prefix: string): boolean {
  if (prefix === "/") return path.startsWith("/");
  if (path === prefix) return true;
  return path.startsWith(prefix + "/");
}

/** 在前缀集中找最长匹配；返回该前缀或 undefined。 */
function longestMatch(
  path: string,
  prefixes: readonly string[],
): string | undefined {
  let best: string | undefined;
  for (const pfx of prefixes) {
    if (prefixMatches(path, pfx)) {
      if (best === undefined || pfx.length > best.length) {
        best = pfx;
      }
    }
  }
  return best;
}

interface LabeledPrefix {
  prefix: string;
  ruleKind: "denyRead" | "denyWrite" | "allowRead" | "allowWrite";
}

/**
 * 判定 path 在指定 kind 下是否被拒。
 *
 * deny 集合：
 *   - read kind → denyRead（denyWrite 不阻断 read）
 *   - write kind → denyRead ∪ denyWrite（A5：denyRead 隐含 denyWrite）
 * allow 集合：
 *   - read kind → allowRead
 *   - write kind → allowWrite（重开 denyRead 与 denyWrite）
 *
 * 决策：取最长 deny 前缀长度 D、最长 allow 前缀长度 A。
 *   - D == 0：无约束 → not denied
 *   - A >= D：allow 重开（等长 allow 优先，A2）→ not denied
 *   - A < D：denied，reason='<denyRuleKind>: <denyPrefix>'
 */
export function isDenied(
  path: string,
  rules: ResolvedFsRules,
  kind: "read" | "write",
): { denied: boolean; reason?: string } {
  const resolved = resolveSymlink(path);

  const denyList: LabeledPrefix[] = [];
  for (const pfx of rules.denyRead) {
    denyList.push({ prefix: pfx, ruleKind: "denyRead" });
  }
  if (kind === "write") {
    for (const pfx of rules.denyWrite) {
      denyList.push({ prefix: pfx, ruleKind: "denyWrite" });
    }
  }

  const allowList: LabeledPrefix[] =
    kind === "read"
      ? rules.allowRead.map((pfx) => ({
          prefix: pfx,
          ruleKind: "allowRead" as const,
        }))
      : rules.allowWrite.map((pfx) => ({
          prefix: pfx,
          ruleKind: "allowWrite" as const,
        }));

  // 最长 deny
  let denyHit: LabeledPrefix | undefined;
  for (const lp of denyList) {
    if (prefixMatches(resolved, lp.prefix)) {
      if (denyHit === undefined || lp.prefix.length > denyHit.prefix.length) {
        denyHit = lp;
      }
    }
  }

  // 最长 allow
  let allowHit: LabeledPrefix | undefined;
  for (const lp of allowList) {
    if (prefixMatches(resolved, lp.prefix)) {
      if (allowHit === undefined || lp.prefix.length > allowHit.prefix.length) {
        allowHit = lp;
      }
    }
  }

  const dLen = denyHit ? denyHit.prefix.length : 0;
  const aLen = allowHit ? allowHit.prefix.length : 0;

  if (dLen === 0) return { denied: false };
  if (aLen >= dLen) return { denied: false };

  return {
    denied: true,
    reason: `${denyHit!.ruleKind}: ${denyHit!.prefix}`,
  };
}
