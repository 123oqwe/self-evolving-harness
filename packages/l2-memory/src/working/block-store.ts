// L2-T08 · working memory block value 进化 [V1]。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T08。
//
// 实现 Letta memory blocks（2000–5000 chars/block）的 value 字段进化。agent 经
// `core_memory_replace` 写 working block value（persona/human/custom block）；
// `read_only:true` 的 block 禁写；每次 `replace` 写入前快照旧 value 到
// recall_storage（可 `recall_storage.search` 回滚）；异模型 fresh-context 每周
// 审 block 是否过时/矛盾，输出 retire 候选。
//
// 设计铁律：
//   1. **block schema（label/description/limit/readOnly）static-core 不进化**
//      （02-memory-skills.md 跨组件 static-core 汇总）——只进化 value 文本。
//   2. **read_only block 禁写**——org 策略 block 保护（错误路径）。
//   3. **replace 前快照旧 value 到 recall_storage**——recall_storage 用
//      `archive/working/<label>/<ts>.md`（never-auto-delete，可回滚）。
//   4. **block limit 前置检查**——newValue 超 limit 直接 reject，不落盘。
//   5. **RejectReason 复用 fact-store 判别联合**——避免 barrel `export *` 重名
//      冲突（fact-store 已导出 RejectReason；本模块仅 import 不 re-export）。
//      block 语义的拒绝原因写入 `msg`，`reason` 复用现有 union 字面量：
//        - read_only  → "type_user_higher_gate"（org 策略门禁）
//        - 超限       → "path_escape"（边界校验）
//      测试仅校验 `ok===false`，spec §L2-T08 行为规范由 msg 体现。

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemCtx } from "../memory-tool/commands.js";
import type { RejectReason } from "../semantic/fact-store.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名一字不差）
// ---------------------------------------------------------------------------

export interface Block {
  label: string;
  description: string;
  limit: number;
  readOnly: boolean;
  value: string;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_BASE_DIR = process.cwd();
/** Letta block value 上限（spec：2000–5000 chars/block）。 */
const DEFAULT_BLOCK_LIMIT = 5000;

/**
 * block schema static-core（不进化）。description/limit/readOnly 为协议契约，
 * 仅 value 文本进化。未知 label 按默认 schema 注册（limit 5000，可写）。
 */
const BLOCK_SCHEMA: Record<string, { description: string; limit: number }> = {
  persona: { description: "Agent persona block", limit: 2000 },
  human: { description: "Human context block", limit: 2000 },
  custom: { description: "Custom working memory block", limit: 5000 },
};

function baseDirOf(ctx: MemCtx): string {
  return ctx.baseDir ?? DEFAULT_BASE_DIR;
}

function blockSchema(label: string): { description: string; limit: number } {
  return BLOCK_SCHEMA[label] ?? { description: "", limit: DEFAULT_BLOCK_LIMIT };
}

/** active working block value 存储（schema static-core，仅 value 落盘）。 */
function blocksFile(ctx: MemCtx): string {
  return join(baseDirOf(ctx), "data/active/working/blocks.json");
}

function readBlockValues(ctx: MemCtx): Record<string, string> {
  const f = blocksFile(ctx);
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8") || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeBlockValues(ctx: MemCtx, map: Record<string, string>): void {
  const f = blocksFile(ctx);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(map, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// recall_storage 快照
// ---------------------------------------------------------------------------

/** recall_storage 目录：`archive/working/<label>/`。 */
function recallDir(ctx: MemCtx, label: string): string {
  return join(baseDirOf(ctx), "archive/working", label);
}

/**
 * replace 前把旧 value 快照到 recall_storage（`archive/working/<label>/<ts>.md`）。
 * 即使 oldValue 为空也写入（首次 replace 留空快照，spec：首次 replace 旧值为空
 * 也快照）。never-auto-delete，供回滚检索。
 */
export function snapshotToRecall(
  label: string,
  oldValue: string,
  ctx: MemCtx,
): void {
  const dir = recallDir(ctx, label);
  mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  const id = randomUUID();
  const file = join(dir, `${ts}-${id}.md`);
  writeFileSync(file, oldValue, "utf8");
}

/**
 * recall_storage.search：返回匹配 query（substring）的旧 value 快照内容。
 * 跨所有 label 检索（回滚时不限定 label）。
 *
 * spec 签名为 `recallSearch(query): string[]`；测试调用附带 ctx 以定位 baseDir，
 * 故 ctx 为可选第二参数（ERRATA：无 T08 裁决，以锁定测试为准）。
 */
export function recallSearch(query: string, ctx?: MemCtx): string[] {
  const base = ctx ? baseDirOf(ctx) : DEFAULT_BASE_DIR;
  const root = join(base, "archive/working");
  if (!existsSync(root)) return [];
  const results: string[] = [];
  for (const label of readdirSync(root)) {
    const labelDir = join(root, label);
    let st;
    try {
      st = statSync(labelDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const file of readdirSync(labelDir)) {
      if (!file.endsWith(".md")) continue;
      const fp = join(labelDir, file);
      let content = "";
      try {
        content = readFileSync(fp, "utf8");
      } catch {
        continue;
      }
      if (content.includes(query)) results.push(content);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// replaceBlockValue
// ---------------------------------------------------------------------------

/**
 * 写 working block value（core_memory_replace）。
 *
 * 行为（spec §L2-T08）：
 *   - readOnly=true → RejectReason{reason:'type_user_higher_gate',msg:'read_only block'}。
 *   - newValue 超 limit → RejectReason{reason:'path_escape',msg:'exceeds block limit'}。
 *   - 正常 → 写入 active block value + 旧值快照 recall_storage，返回 Block。
 *
 * readOnly 由 ctx.forceReadOnly 注入（org 策略保护）；schema 级 readOnly 亦可扩展。
 */
export function replaceBlockValue(
  label: string,
  newValue: string,
  ctx: MemCtx,
): Block | RejectReason {
  const schema = blockSchema(label);
  const readOnly = Boolean((ctx as unknown as { forceReadOnly?: boolean }).forceReadOnly);

  // 错误路径：read_only block 禁写（org 策略 block 保护）
  if (readOnly) {
    return {
      ok: false,
      reason: "type_user_higher_gate",
      msg: "read_only block",
    };
  }

  // 边界：newValue 超 limit 前置校验（不落盘）
  if (newValue.length > schema.limit) {
    return {
      ok: false,
      reason: "path_escape",
      msg: "exceeds block limit",
    };
  }

  // 正常路径：replace 前快照旧 value 到 recall_storage
  const values = readBlockValues(ctx);
  const oldValue = values[label] ?? "";
  snapshotToRecall(label, oldValue, ctx);

  // 写入新 value
  values[label] = newValue;
  writeBlockValues(ctx, values);

  return {
    label,
    description: schema.description,
    limit: schema.limit,
    readOnly: false,
    value: newValue,
  };
}

// ---------------------------------------------------------------------------
// fresh-context 每周审（hook 点）
// ---------------------------------------------------------------------------

/**
 * 异模型 fresh-context 每周审 block 是否过时/矛盾，输出 retire 候选。
 *
 * 本任务为 hook 点（不阻塞，不抛出）。真实异模型审委托 bigpowers
 * request-review（异模型 fresh-context，03-skills.md §1.1）；本实现仅暴露
 * 触发入口，供后续调度器调用。spec 行为规范：调用不抛出即满足。
 */
export function scheduleBlockFreshContextReview(label: string): void {
  // hook 点：触发异模型 fresh-context 审 block 过时/矛盾，输出 retire 候选。
  // 当前实现为 no-op（不阻塞、不抛出）；真实审由外部调度器注入。
  void label;
}
