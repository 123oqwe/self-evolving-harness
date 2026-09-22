// SEC-T01: L0S-R2 强制交叉验证 — epermHits × exitCode 伪造面丢弃。
//
// 严格对齐 execution/adapt/TASKS.md §SEC-T01 + ERRATA-w01 §L0S-R2 裁决：
// 用户可控 stderr 伪造 'Operation not permitted' 行仍可进 epermHits（证据非证明，
// 固有 surfacing 语义）——CE 消费 epermHits 时须交叉验证 exitCode。
//
// 伪造面：进程成功 exit 0 但 stderr 含伪造 EPERM 行。若盲信 epermHits 会误判 sandbox
// 生效（实际上进程并未被 sandbox 拦截，exit 0 = 成功 = 未触发 EPERM）。本交叉验证
// 在 CE 消费 epermHits 处丢弃此类不自洽证据并告警。
//
// 复用铁律：`VerifierRun`（§CE-T02，含 `exitCode`/`epermHits` 字段）从 `./verifier.js`
// 导入，不重定义形状。`crossCheckEperm` 保持纯函数无副作用，便于后续 L0S/CE 其他
// epermHits 消费点复用。

import type { VerifierRun } from "./verifier.js";

/**
 * 交叉验证结果：epermHits 与 exitCode 是否自洽。
 *
 * - `verdict: "consistent"`：epermHits 与 exitCode 自洽，证据可用。
 * - `verdict: "forged-suspect"`：伪造面（exitCode=0 但 epermHits 非空），证据丢弃。
 * - `reason`：人类可读的裁决依据（含 exitCode/epermHits 状态，便于审计）。
 * - `dropped`：true = 该证据被丢弃（forged-suspect），false = 保留（consistent）。
 */
export interface EpermCrossCheckResult {
  readonly verdict: "consistent" | "forged-suspect";
  readonly reason: string;
  readonly dropped: boolean;
}

/**
 * L0S-R2 强制交叉验证：epermHits 非空但 exitCode===0 → 伪造面，丢弃 + 告警。
 *
 * 判定规则：
 * - `epermHits` 为空（或 undefined）→ `consistent`（无 EPERM 信号，无需交叉验证）。
 * - `epermHits` 非空 + `exitCode !== 0` → `consistent`（EPERM 导致非零 exit，自洽）。
 * - `epermHits` 非空 + `exitCode === 0` → `forged-suspect`（成功 exit 但报 EPERM =
 *   伪造面），`dropped: true`。
 *
 * 依据 ERRATA-w01 §L0S-R2：stderr 是用户可控面，'Operation not permitted' 行可被伪造；
 * exitCode 是进程退出码，不易被 sandbox 内进程伪造。两者须自洽：EPERM 应导致非零 exit。
 */
export function crossCheckEperm(run: {
  exitCode: number;
  epermHits?: string[];
}): EpermCrossCheckResult {
  const hits = run.epermHits ?? [];
  const hasEperm = hits.length > 0;

  // 无 EPERM 信号 → 无需交叉验证。
  if (!hasEperm) {
    return {
      verdict: "consistent",
      reason: `exitCode=${run.exitCode}, epermHits empty — no EPERM signal to cross-check`,
      dropped: false,
    };
  }

  // EPERM 非空 + exitCode!==0 → EPERM 导致非零 exit，自洽。
  if (run.exitCode !== 0) {
    return {
      verdict: "consistent",
      reason: `exitCode=${run.exitCode} (non-zero) consistent with epermHits.length=${hits.length} (EPERM caused non-zero exit)`,
      dropped: false,
    };
  }

  // EPERM 非空 + exitCode===0 → 伪造面：成功 exit 但报 EPERM = 不自洽，丢弃。
  return {
    verdict: "forged-suspect",
    reason:
      `forged-suspect: exitCode=0 但 epermHits 非空 (length=${hits.length}) — ` +
      `EPERM should cause non-zero exit; exit=0 with EPERM in stderr is forgeable surface (L0S-R2)`,
    dropped: true,
  };
}

/**
 * 在 fresh-evidence 门消费 VerifierRun 前过滤伪造面证据。
 *
 * 证据级丢弃：只丢 forged-suspect 证据，不丢整个 run 列表（其他 consistent 证据仍生效）。
 * `warnings` 含被丢证据的 taskId/runId 便于审计（ERRATA L0S-R2 落实：CE 消费端交叉验证）。
 *
 * 返回 `{ kept, dropped, warnings }`：
 * - `kept`：自洽证据（consistent），可继续进入 fresh-evidence 判定。
 * - `dropped`：伪造面证据（forged-suspect），不进入判定。
 * - `warnings`：每条被丢证据一条告警字符串，含 taskId/runId。
 */
export function filterForgedEperm(runs: VerifierRun[]): {
  kept: VerifierRun[];
  dropped: VerifierRun[];
  warnings: string[];
} {
  const kept: VerifierRun[] = [];
  const dropped: VerifierRun[] = [];
  const warnings: string[] = [];

  for (const run of runs) {
    // exactOptionalPropertyTypes: run.epermHits may be undefined; normalize to []
    // (crossCheckEperm internally treats undefined/[] as "no EPERM signal").
    const check = crossCheckEperm({
      exitCode: run.exitCode,
      epermHits: run.epermHits ?? [],
    });
    if (check.dropped) {
      dropped.push(run);
      warnings.push(
        `forged-suspect evidence dropped (L0S-R2): taskId="${run.taskId}", runId="${run.runId}", ` +
          `exitCode=${run.exitCode}, epermHits.length=${run.epermHits?.length ?? 0} — ${check.reason}`,
      );
    } else {
      kept.push(run);
    }
  }

  return { kept, dropped, warnings };
}
