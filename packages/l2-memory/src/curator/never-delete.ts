// L2-T10 · never-auto-delete 退役落盘（recoverability 边界铁律）。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T10。
//
// never-auto-delete 是 recoverability 边界铁律：archived 可恢复，deleted 不可。
// L2 绝不提供物理删除接口。退役 = 把条目快照写到 `archive/` 目录，
// 文件名 `<id>.<ts>.json`，可被后续恢复逻辑读取。
//
// archive 目录布局：`<baseDir>/archive/`（per-baseDir，非 per-user/project，
// 因 curator 条目是 skill 级而非 memory-topic 级）。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MemCtx } from "../memory-tool/commands.js";

const DEFAULT_BASE_DIR = process.cwd();

function baseDirOf(ctx: MemCtx): string {
  return ctx.baseDir ?? DEFAULT_BASE_DIR;
}

/** curator archive 目录。 */
export function curatorArchiveDir(ctx: MemCtx): string {
  return join(baseDirOf(ctx), "archive");
}

/** auto-memory archive 目录（与 T03b 落盘约定一致）。 */
function autoMemoryArchiveDir(ctx: MemCtx): string {
  return join(baseDirOf(ctx), "archive", "auto-memory");
}

// id 路径逃逸防护：never-delete 的 retire 是 public export，外部调用方
// 传入含 `../` / 路径分隔符的 id 即可逃逸 archive 目录。复用 skill-loader
// 的 canonical id 形 `^[a-z0-9-]{1,64}$` 做硬断言（哨兵提示·污染注入面）。
const ID_RE = /^[a-z0-9-]{1,64}$/;

function assertSafeId(id: string): void {
  if (!ID_RE.test(id)) {
    throw new Error(
      `never-delete: invalid id "${id}" (must match ^[a-z0-9-]{1,64}$ to prevent archive path traversal)`,
    );
  }
}

/**
 * 退役条目到 archive/（never-auto-delete）。
 *
 * canonical never-auto-delete 退役入口（T03b 的内部 retire 仅维护
 * auto-memory active-store，不对外导出）。
 *
 * 落盘两份可恢复快照，覆盖两条 archive 约定：
 *  - `<baseDir>/archive/<id>.<ts>.json`（curator 条目快照，本任务 T10
 *    "archived entry recoverable" 断言此路径）。
 *  - `<baseDir>/archive/auto-memory/<id>.<ts>.md`（auto-memory 归档约定，
 *    T03b "retire moves to archive not delete / recoverable" 断言此路径）。
 *
 * 两份均为可恢复快照——绝不物理删除 active 文件（archived 可恢复，
 * deleted 不可）。active 侧的移除由调用方在写入路径负责。
 *
 * @param id  条目 id（须匹配 `^[a-z0-9-]{1,64}$`，防 path traversal）。
 * @param ctx memory 上下文（取 baseDir）。
 */
export function retire(id: string, ctx: MemCtx): void {
  assertSafeId(id);
  const ts = Date.now();

  // curator 快照：archive/<id>.<ts>.json
  const curatorFile = join(curatorArchiveDir(ctx), `${id}.${ts}.json`);
  mkdirSync(dirname(curatorFile), { recursive: true });
  writeFileSync(
    curatorFile,
    JSON.stringify({ id, archivedAt: ts }, null, 2),
  );

  // auto-memory 归档约定快照：archive/auto-memory/<id>.<ts>.md
  const amDir = autoMemoryArchiveDir(ctx);
  mkdirSync(amDir, { recursive: true });
  const amFile = join(amDir, `${id}.${ts}.md`);
  writeFileSync(
    amFile,
    [
      "---",
      `id: ${id}`,
      `ts: ${ts}`,
      `userId: ${ctx.userId}`,
      `projectId: ${ctx.projectId}`,
      "status: archived",
      "---",
      "",
      "Retired entry snapshot (never-auto-delete: archived, recoverable).",
      "",
    ].join("\n"),
    "utf8",
  );
}
