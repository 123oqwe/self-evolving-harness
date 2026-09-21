// L2-T11 — commit-on-success terminal-verdict 门 + 版本后缀回滚 + staging 门 [V1]
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T11
//
// commit-on-success 的 "success" 必须有 ≥1 个 mechanical terminal-verdict
// （exit code，bigpowers verify-work 铁律）——**禁** prose claim 触发 commit
// （防 reward hack：agent 声称完成以触发 commit）。commit 原子性
// （delete stale embedding + re-add new + version-suffix nameV{n}）保证
// "index 持唯一最新版" 不变量（Voyager assertion）。
//
// 复用：bigpowers verify-work terminal-verdict gate（≥1 shell exit code 即
// 裁决，单次连续运行，禁跨 run 合并证据）；Voyager add_new_skill 版本化 +
// index 持最新版（commit 原子性 + 版本后缀）。
//
// 自研：commitOnSuccess / rollback TS 实现 + terminal-verdict 检查 + commit
// 原子性（delete+re-add+version）+ index 唯一最新版不变量 + 版本后缀回滚
// + getLatestVersion / getIndexVersions 辅助断言（ERRATA-w2plus L2-T11 裁决
// 「index 持唯一最新版」不变量缺查询接口）。
//
// ERRATA-w2plus 裁决：
//   L2-T11: 导出 getLatestVersion 辅助断言。
//   L2-06:  无 ctx 签名的函数加可选 ctx（rollback / getLatestVersion /
//          getIndexVersions 加可选 ctx，与测试调用一致）。
//
// 设计铁律：
//   1. **terminal-verdict**——verdict 缺失（prose claim only）或 exitCode
//      !== 0 → reject "no terminal verdict"，绝不 commit。
//   2. **commit 原子性**——delete stale index 条目 + re-add 新版 + 版本后缀
//      nameV{n}；index 始终只持一个（最新）版本。filesystem archive 保留
//      全版本历史供 rollback（archive ≠ vector index）。
//   3. **index 持唯一最新版**——破坏它使 vectordb 与 filesystem drift
//      （02-memory-skills.md 组件 8 不变量）。

import type { MemCtx } from "../memory-tool/commands.js";
import type { Provenance } from "../expel/insight-store.js";
import type { RejectReason } from "../semantic/fact-store.js";
import type { SkillVariant } from "../skill-evo/description-evo.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名）
// ---------------------------------------------------------------------------

/**
 * VerdictResult —— terminal-verdict 裁决结果。exitCode=0 = pass。
 *
 * 形状对齐 bigpowers verify-work 的 "≥1 shell 命令 exit code 即裁决"：
 * 单次连续运行，禁跨 run 合并证据。
 */
export interface VerdictResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * CommittedSkill —— commit 成功的 skill 变体。
 *
 * `name` 带版本后缀 `nameV{n}`；`version` 为递增整数；`status` 固定
 * `'active'`（commit 即晋升 active；staging 门在调用方——LLM-authored
 * 默认 staging，commitOnSuccess 只在 terminal-verdict pass 后才被调用）。
 */
export interface CommittedSkill {
  id: string;
  name: string; // 形如 `{baseName}V{n}`
  version: number;
  body: string;
  status: "active";
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// per-baseDir 状态：archive（全版本历史，供 rollback）+ index（唯一最新版）
// ---------------------------------------------------------------------------

/**
 * 单 (baseDir, name) 的存储：
 *   - `archive`: 全版本历史（version → SkillVariant），供 rollback 恢复。
 *   - `latest`:  vector index 当前持有的唯一版本号（null = 无）。
 *
 * "index 持唯一最新版" 不变量由 `latest` 单值保证——commit / rollback 均
 * 仅置单一版本号，旧版从 index 移除（archive 仍保留历史）。
 */
interface NameStore {
  archive: Map<number, SkillVariant>;
  latest: number | null;
}

/** baseDir → name → NameStore。按 ctx.baseDir 隔离，测试间互不污染。 */
const stores = new Map<string, Map<string, NameStore>>();

function baseDirOf(ctx: MemCtx | undefined): string {
  return ctx?.baseDir ?? process.cwd();
}

function getStore(baseDir: string, name: string): NameStore {
  let perBase = stores.get(baseDir);
  if (!perBase) {
    perBase = new Map();
    stores.set(baseDir, perBase);
  }
  let ns = perBase.get(name);
  if (!ns) {
    ns = { archive: new Map(), latest: null };
    perBase.set(name, ns);
  }
  return ns;
}

// ---------------------------------------------------------------------------
// commit-on-success terminal-verdict 门
// ---------------------------------------------------------------------------

/**
 * commitOnSuccess —— terminal-verdict pass 后原子性 commit skill 变体。
 *
 * **门**：`verdict` 缺失（prose claim only）或 `verdict.exitCode !== 0`
 * → reject "no terminal verdict"（防 reward hack：agent 声称完成不算）。
 *
 * **commit 原子性**（通过后）：
 *   1. delete stale index 条目（`latest` 置新版本，旧版从 index 移除）；
 *   2. re-add 新版 embedding（archive 登记新版本 SkillVariant）；
 *   3. 版本后缀 `nameV{maxVersion+1}`（首次 → nameV1，后续递增）。
 *
 * "index 持唯一最新版" 不变量：commit 后 `latest` 恒为单一最新版本号。
 *
 * @param candidate 待 commit 的 staging skill 变体
 * @param verdict   terminal-verdict（exit code 裁决）
 * @param ctx       MemCtx（provenance 追溯 + side channel warnings）
 * @returns commit 成功 → CommittedSkill；拒绝 → RejectReason（ok:false）
 */
export function commitOnSuccess(
  candidate: SkillVariant,
  verdict: VerdictResult,
  ctx: MemCtx,
): CommittedSkill | RejectReason {
  // terminal-verdict 门：verdict 缺失或 exitCode !== 0 → reject
  if (
    !verdict ||
    typeof verdict.exitCode !== "number" ||
    verdict.exitCode !== 0
  ) {
    const msg =
      "no terminal verdict: commit requires verdict.exitCode === 0 (prose claim rejected)";
    ctx?.warnings?.push(`[l2-t11] commitOnSuccess rejected: ${msg}`);
    return { ok: false, reason: "type_user_higher_gate", msg };
  }

  const baseDir = baseDirOf(ctx);
  const ns = getStore(baseDir, candidate.name);

  // 版本后缀递增：maxVersion + 1（首次 commit → 1）
  let maxV = 0;
  for (const v of ns.archive.keys()) {
    if (v > maxV) maxV = v;
  }
  const newVersion = maxV + 1;
  const newName = `${candidate.name}V${newVersion}`;

  const now = Date.now();
  const provenance: Provenance = {
    sessionId: ctx?.sessionId ?? "unknown",
    taskId: ctx?.taskId ?? "L2-T11",
    promptHash: ctx?.promptHash ?? "unknown",
    agentId: ctx?.agentId ?? "unknown",
    ts: now,
  };

  const committed: CommittedSkill = {
    id: candidate.id,
    name: newName,
    version: newVersion,
    body: candidate.body,
    status: "active",
    provenance,
  };

  // commit 原子性：archive 登记新版（供 rollback）+ index 置唯一最新版
  // （delete stale = latest 覆盖为 newVersion，旧版从 index 移除）。
  const archived: SkillVariant = {
    ...candidate,
    name: newName,
    version: newVersion,
    status: "active",
    provenance,
  };
  ns.archive.set(newVersion, archived);
  ns.latest = newVersion;

  return committed;
}

// ---------------------------------------------------------------------------
// 版本后缀回滚
// ---------------------------------------------------------------------------

/**
 * rollback —— 回滚 active 库到指定版本，重建 index。
 *
 * 从 archive 恢复 `nameV{toVersion}` 的 SkillVariant，并把 index 重建为
 * 仅持 `toVersion`（唯一最新版）。对应 spec 行为：commit 后 vector index
 * 持最新版，rollback 后 active 库恢复前版 suffix 文件 + 重建 embedding。
 *
 * @param name      skill base name（无版本后缀）
 * @param toVersion 目标版本号
 * @param ctx       可选 MemCtx（定位 baseDir；ERRATA L2-06）
 * @returns 恢复的 SkillVariant（version = toVersion）
 */
export function rollback(
  name: string,
  toVersion: number,
  ctx?: MemCtx,
): SkillVariant {
  const baseDir = baseDirOf(ctx);
  const ns = getStore(baseDir, name);
  const restored = ns.archive.get(toVersion);
  if (!restored) {
    throw new Error(
      `[l2-t11] rollback: version ${toVersion} of "${name}" not found in archive`,
    );
  }
  // 重建 index：仅持 toVersion（唯一最新版）
  ns.latest = toVersion;
  return restored;
}

// ---------------------------------------------------------------------------
// index 查询接口（ERRATA-w2plus L2-T11 裁决：不变量缺查询接口）
// ---------------------------------------------------------------------------

/**
 * getLatestVersion —— 查询 name 在 vector index 中持有的最新版本号。
 *
 * "index 持唯一最新版" 不变量辅助断言：返回唯一最新版本号，无则 null。
 *
 * 注：ERRATA-w2plus 原裁决建议返回 `{ version: string; sha: string }`，
 * 但锁定测试（tests/L2/T11.spec.ts）以数字版本号断言（`.toBe(n)`），
 * 测试为不可改契约 → 实现返回数字版本号（测试优先）。
 *
 * @param name skill base name
 * @param ctx  可选 MemCtx（定位 baseDir）
 * @returns 最新版本号，或 null（无 commit）
 */
export function getLatestVersion(name: string, ctx?: MemCtx): number | null {
  const baseDir = baseDirOf(ctx);
  const ns = getStore(baseDir, name);
  return ns.latest;
}

/**
 * getIndexVersions —— 查询 name 在 vector index 中持有的全部版本号。
 *
 * "index 持唯一最新版" 不变量：始终返回长度 ≤ 1 的数组（仅最新版）。
 * 多于 1 条即不变量被破坏（vectordb/filesystem drift）。
 *
 * @param name skill base name
 * @param ctx  可选 MemCtx（定位 baseDir）
 * @returns 版本号数组（正常路径长度 1；无 commit → 空数组）
 */
export function getIndexVersions(name: string, ctx?: MemCtx): number[] {
  const baseDir = baseDirOf(ctx);
  const ns = getStore(baseDir, name);
  return ns.latest === null ? [] : [ns.latest];
}
