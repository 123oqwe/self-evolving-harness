// L2-T09b — skill body/scripts Voyager commit-on-success 进化 [V1]
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T09b
//
// skill body（Level-2 指令文本）+ scripts（Level-3 可执行代码）的进化。
//
// **铁律**：LLM-authored skill **默认进 `staging/`**——library drift 实测
// +0.0pp（LLM-authored）vs +16.2pp（human-curated）的直接工程后果。晋升
// active 需 held-out pass 率提升 ≥ τ + 人工签字（config 层）。
//
// scripts 改动必经 sandbox 执行验证（不可读 `~/.ssh`/`.aws`）；breaker
// clause（exec/eval/网络 flag）——scripts 含 `eval()`/
// `child_process.exec`/网络调用自动 flag 需人审。
//
// 复用：Voyager commit-on-success + 版本化 suffix + skip rule（02-memory-skills.md
// 组件 7/8）；anthropics/skills scripts 模式（03-skills.md §2.1）；bigpowers
// craft-skill / security-review；L0S sandbox（WBS L0S-T02/T03）。
//
// 自研：addLLMAuthoredSkill / promoteToActive / breakerScan / sandboxVerify
// TS 实现 + staging 默认落点 + 人工签字检查 + breaker 正则扫描。
//
// ERRATA-w2plus 裁决：
//   L2-04: Skill = SkillVariant（别名统一为 T09b 的 SkillVariant 形状）——
//          复用 description-evo.ts 已定义的 SkillVariant / SkillStatus。
//   L2-06: 无 ctx 签名的函数加可选 ctx（与测试调用一致）：
//          addLLMAuthoredSkill(variant, ctx?) / promoteToActive(id, delta,
//          humanSign, ctx?) / sandboxVerify(id, ctx?)。

import type { MemCtx } from "../memory-tool/commands.js";
import type { Provenance } from "../expel/insight-store.js";
import type { RejectReason } from "../semantic/fact-store.js";
import type { SkillVariant } from "./description-evo.js";

// ---------------------------------------------------------------------------
// breaker clause（exec/eval/network flag）
// ---------------------------------------------------------------------------

/**
 * BreakerFlag —— scripts 中需人审的 breaker 类型。
 *
 * - `eval`: 含 `eval(` 动态求值（任意代码执行）。
 * - `exec`: 含 `child_process.exec`（子进程执行）。
 * - `network`: 含网络调用（`require('http'|'https'|'net'|'dgram'...)` /
 *   `fetch(`/`XMLHttpRequest`）。
 */
export type BreakerFlag = "eval" | "exec" | "network";

const RE_EVAL = /\beval\s*\(/;
// scripts 引用 child_process（require/import）或调用 .exec( → exec breaker
const RE_EXEC = /child_process|\.exec\s*\(/;
// require('http' | 'https' | 'net' | 'dgram' | 'tls' | 'child_process' 中的 net
const RE_NETWORK =
  /require\(\s*['"](https?|net|dgram|tls|child_process)['"]|new\s+WebSocket|fetch\s*\(|XMLHttpRequest/;

/**
 * breakerScan —— 扫描 scripts 文本，flag exec/eval/network breaker。
 *
 * 含 breaker 的 scripts **不**自动晋升，需人审（config 层签字）。
 *
 * @param scripts Level-3 可执行代码文本
 * @returns 命中的 breaker flag 列表（去重；无命中 → 空数组）
 */
export function breakerScan(scripts: string): BreakerFlag[] {
  const flags: BreakerFlag[] = [];
  if (scripts == null) return flags;
  if (RE_EVAL.test(scripts)) flags.push("eval");
  if (RE_EXEC.test(scripts)) flags.push("exec");
  if (RE_NETWORK.test(scripts)) flags.push("network");
  // 去重（同一 breaker 多次命中只计一次）
  return Array.from(new Set(flags));
}

// ---------------------------------------------------------------------------
// LLM-authored skill 默认 staging
// ---------------------------------------------------------------------------

/** 内部：单调递增的 skill id 计数器（V1 进程内稳定；L3 可换持久 store）。 */
let skillSeq = 0;

/**
 * 内部 staging 注册表（V1 进程内；L3 可换持久 store）。
 *
 * `addLLMAuthoredSkill` 落库时按 id 登记 SkillVariant，供 `promoteToActive`
 * 按 id 查回 staging 源内容（body/scripts/description/name）——避免晋升
 * 出空壳 active 变体（伪造信号面：active 库被注入 body="" 的空 skill）。
 */
const stagingRegistry = new Map<string, SkillVariant>();

/**
 * addLLMAuthoredSkill —— 注册 LLM-authored skill 变体。
 *
 * **铁律**：默认 status='staging'（**不**进 active 库）——LLM-authored
 * +0.0pp gap 决定人 governance 必需（PRD §6.5、02-memory-skills.md 组件 7
 * 关键裁决）。version 从 1 起；id 由本函数生成。
 *
 * @param variant skill 变体（不含 id/status/version）
 * @param _ctx 可选 MemCtx（provenance 追溯；V1 保留）
 * @returns status='staging' 的 SkillVariant
 */
export function addLLMAuthoredSkill(
  variant: Omit<SkillVariant, "id" | "status" | "version">,
  _ctx?: MemCtx,
): SkillVariant {
  skillSeq += 1;
  const now = Date.now();
  const provenance: Provenance =
    variant.provenance ??
    ({
      sessionId: _ctx?.sessionId ?? "unknown",
      taskId: _ctx?.taskId ?? "L2-T09b",
      promptHash: _ctx?.promptHash ?? "unknown",
      agentId: _ctx?.agentId ?? "unknown",
      ts: now,
    } as Provenance);

  // exactOptionalPropertyTypes:true —— 不可把 `string | undefined` 显式赋给
  // `scripts?: string` / `description?: string`。用条件展开：仅当源值非
  // undefined 时才写该键（缺键 == optional 未设，符合类型契约）。
  const sv: SkillVariant = {
    id: `skill-${now.toString(36)}-${skillSeq}`,
    name: variant.name,
    version: 1,
    body: variant.body,
    status: "staging",
    provenance,
    ...(variant.scripts !== undefined && { scripts: variant.scripts }),
    ...(variant.description !== undefined && {
      description: variant.description,
    }),
  };
  stagingRegistry.set(sv.id, sv);
  return sv;
}

// ---------------------------------------------------------------------------
// staging → active 晋升门（held-out pass 率提升 ≥ τ + 人工签字）
// ---------------------------------------------------------------------------

/** V1 晋升阈值 τ（held-out pass 率提升下限）。 */
const PROMOTE_TAU = 0.0; // 严格提升（delta > 0）才晋升

/**
 * promoteToActive —— 将 staging skill 晋升为 active。
 *
 * 晋升门（全部满足才 active）：
 *   1. `heldOutPassDelta > PROMOTE_TAU`（held-out pass 率严格提升）；
 *      delta <= 0 → reject "held-out regression"。
 *   2. `humanSign === true`（人 governance 必需）；
 *      false → reject "human signoff required"。
 *
 * 晋升率 ≤ 20% 是 V1 验收门（PRD §8.2）——staging 门要严。
 *
 * @param id 目标 skill
 * @param heldOutPassDelta staging vs active 在 held-out 上的 pass 率 delta
 * @param humanSign 人工签字（true=已签字）
 * @param _ctx 可选 MemCtx（side channel warnings；V1 保留）
 * @returns 晋升成功 → SkillVariant（status='active'）；拒绝 → RejectReason
 */
export function promoteToActive(
  id: string,
  heldOutPassDelta: number,
  humanSign: boolean,
  _ctx?: MemCtx,
): SkillVariant | RejectReason {
  // 门 1：held-out pass 率严格提升
  if (heldOutPassDelta <= PROMOTE_TAU) {
    const msg =
      heldOutPassDelta < 0
        ? `held-out regression: heldOutPassDelta=${heldOutPassDelta} < 0`
        : `held-out regression: heldOutPassDelta=${heldOutPassDelta} (no improvement, delta must be > ${PROMOTE_TAU})`;
    _ctx?.warnings?.push(`[l2-t09b] promoteToActive rejected: ${msg}`);
    return { ok: false, reason: "type_user_higher_gate", msg };
  }

  // 门 2：人 governance 必需（人工签字）
  if (!humanSign) {
    const msg = "human signoff required: humanSign=false";
    _ctx?.warnings?.push(`[l2-t09b] promoteToActive rejected: ${msg}`);
    return { ok: false, reason: "type_user_higher_gate", msg };
  }

  // 晋升成功：承袭 staging 源内容（body/scripts/description/name），
  // version+1，provenance 追溯——避免向 active 库注入空壳 skill
  // （伪造信号面：active 变体须承袭 staging 源语义内容）。
  const now = Date.now();
  const provenance: Provenance = {
    sessionId: _ctx?.sessionId ?? "unknown",
    taskId: _ctx?.taskId ?? "L2-T09b",
    promptHash: _ctx?.promptHash ?? "unknown",
    agentId: _ctx?.agentId ?? "unknown",
    ts: now,
  };

  const source = stagingRegistry.get(id);
  const promoted: SkillVariant = {
    id,
    name: source?.name ?? id,
    version: (source?.version ?? 0) + 1,
    status: "active",
    body: source?.body ?? "",
    provenance,
    ...(source?.scripts !== undefined && { scripts: source.scripts }),
    ...(source?.description !== undefined && {
      description: source.description,
    }),
  };
  // 晋升后从 staging 注册表移除（已转 active，避免重复晋升同版本）。
  if (source) stagingRegistry.delete(id);
  return promoted;
}

// ---------------------------------------------------------------------------
// sandbox 执行验证（委托 L0S sandbox）
// ---------------------------------------------------------------------------

/** L0S sandbox runSandboxed 结果形状（本地定义，避免跨包类型耦合）。 */
interface SandboxResult {
  ok: boolean;
  denied?: string[];
}

/**
 * sandboxVerify —— scripts 在 sandbox 执行验证。
 *
 * 委托 `@harness/l0-sandbox` 的 `runSandboxed`（WBS L0S-T02/T03）。scripts
 * 在 sandbox 中执行，**不可读 `~/.ssh`/`.aws`**——若 sandbox 报告
 * denied 命中敏感路径（`.ssh`/`.aws`），判定 skill **未**通过验证（返回
 * false）；sandbox 自身失败（ok=false）同样返回 false。
 *
 * 动态 import 避免本模块在 module-load 阶段硬绑定 L0S（L0S 可按需替换）。
 *
 * @param id 目标 skill
 * @param _ctx 可选 MemCtx
 * @returns true=通过 sandbox 验证；false=未通过（敏感路径访问/sandbox 失败）
 */
export async function sandboxVerify(
  id: string,
  _ctx?: MemCtx,
): Promise<boolean> {
  // 动态 import：避免硬依赖 L0S 的导出形状（V1 委托；mock 可替换）。
  const mod = (await import("@harness/l0-sandbox")) as {
    runSandboxed?: (
      skillId: string,
      ctx?: unknown,
    ) => Promise<SandboxResult>;
  };
  const runSandboxed = mod.runSandboxed;
  if (typeof runSandboxed !== "function") {
    // L0S 未提供 runSandboxed——保守拒绝（fail-closed）。
    _ctx?.warnings?.push(
      `[l2-t09b] sandboxVerify: runSandboxed unavailable, rejecting skill "${id}"`,
    );
    return false;
  }

  const result = await runSandboxed(id, _ctx);
  if (!result?.ok) {
    // sandbox 执行失败 → 拒绝
    return false;
  }
  const denied = result.denied ?? [];
  // 敏感路径访问（.ssh/.aws）→ skill 尝试越权 → 拒绝
  const sensitive = [".ssh", ".aws", ".gnupg", ".config/gh"];
  for (const d of denied) {
    if (sensitive.some((s) => d.includes(s))) {
      _ctx?.warnings?.push(
        `[l2-t09b] sandboxVerify: skill "${id}" attempted sensitive path "${d}"`,
      );
      return false;
    }
  }
  return true;
}
