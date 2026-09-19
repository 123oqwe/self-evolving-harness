// L2-T02 · memory tool 六命令实现（Anthropic memory_20250818 行为对齐）。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T02（含 ERRATA-w2plus MemCtx 裁决）。
//
// 实现六命令（view/create/str_replace/insert/delete/rename）的行为；命令集、
// input schema、return string、str_replace 唯一性、create 拒绝覆写、canonical-path
// 校验全部对齐 Anthropic reference + L0C-T06 static-core 契约——L2 **不改** schema，
// 只实现行为。
//
// `/memories/<topic>` 虚拟前缀映射到 `data/active/memory/<userId>/<projectId>/<topic>.md`
// 物理文件；delete/rename 归档到 `archive/memory/<userId>/<projectId>/<topic>.<ts>.md`
// （never-auto-delete，不物理删除）。MEMORY.md 索引 ≤200 行 / ≤25KB tail 静默丢弃。
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  copyFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { canonicalMemoryPath } from "./path-guard.js";
import {
  appendMemoryIndexLine,
  removeMemoryIndexLine,
  replaceMemoryIndexLine,
  MAX_LINES,
  MAX_BYTES,
} from "./memory-index.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

export type MemCommand =
  | "view"
  | "create"
  | "str_replace"
  | "insert"
  | "delete"
  | "rename";

export interface MemInput {
  command: MemCommand;
  path: string; // /memories/<topic> 虚拟前缀
  old_str?: string;
  new_str?: string;
  line?: number;
  content?: string;
  /** rename 目标路径（/memories/<new-topic>）。 */
  new_path?: string;
}

/**
 * L2 memory 上下文。ERRATA-w2plus 裁决：`baseDir` + provenance 字段可选注入。
 * T02 仅消费 `userId`/`projectId`/`baseDir`；其余字段供后续任务（T03a/T04b/T10...）使用。
 */
export interface MemCtx {
  userId: string;
  projectId: string;
  baseDir?: string;
  sessionId?: string;
  taskId?: string;
  promptHash?: string;
  agentId?: string;
  warnings?: string[];
  selectiveForgetting?: () => number;
}

export type MemResult =
  | { content: string; isError: false }
  | { content: string; isError: true };

export { MAX_LINES, MAX_BYTES };

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------

const DEFAULT_BASE_DIR = process.cwd();

function baseDirOf(ctx: MemCtx): string {
  return ctx.baseDir ?? DEFAULT_BASE_DIR;
}

/** 某用户/项目的 active memory 目录。 */
function activeMemoryDir(ctx: MemCtx): string {
  return join(
    baseDirOf(ctx),
    "data/active/memory",
    ctx.userId,
    ctx.projectId,
  );
}

/** 某 topic 的物理文件路径。 */
function physFile(ctx: MemCtx, topic: string): string {
  return join(activeMemoryDir(ctx), `${topic}.md`);
}

/** MEMORY.md 索引文件路径。 */
function indexPath(ctx: MemCtx): string {
  return join(activeMemoryDir(ctx), "MEMORY.md");
}

/** archive 目录（per-user+per-project，防跨用户恢复错文件）。 */
function archiveDir(ctx: MemCtx): string {
  return join(
    baseDirOf(ctx),
    "archive/memory",
    ctx.userId,
    ctx.projectId,
  );
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function ok(content: string): MemResult {
  return { content, isError: false };
}

function err(content: string): MemResult {
  return { content, isError: true };
}

function ensureDir(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// 六命令
// ---------------------------------------------------------------------------

function cmdView(input: MemInput, ctx: MemCtx): MemResult {
  const path = input.path;
  const cp = canonicalMemoryPath(path);
  if (!cp.ok) return err(cp.error);
  const file = physFile(ctx, cp.topic);
  if (!existsSync(file)) {
    return err(`memory not found: ${path}`);
  }
  return ok(readFileSync(file, "utf8"));
}

function cmdCreate(input: MemInput, ctx: MemCtx): MemResult {
  const path = input.path;
  const cp = canonicalMemoryPath(path);
  if (!cp.ok) return err(cp.error);
  const content = input.content;
  if (typeof content !== "string") {
    return err("create requires `content` string");
  }
  const file = physFile(ctx, cp.topic);
  if (existsSync(file)) {
    // create 拒绝覆写（never-auto-delete / no-silent-clobber）
    return err(
      `create refuses to overwrite existing memory: ${path} (never-auto-delete)`,
    );
  }
  ensureDir(file);
  writeFileSync(file, content, "utf8");
  appendMemoryIndexLine(indexPath(ctx), cp.topic);
  return ok(`Created memory at ${path} and added entry to MEMORY.md.`);
}

function cmdStrReplace(input: MemInput, ctx: MemCtx): MemResult {
  const path = input.path;
  const cp = canonicalMemoryPath(path);
  if (!cp.ok) return err(cp.error);
  const oldStr = input.old_str;
  const newStr = input.new_str;
  if (typeof oldStr !== "string" || typeof newStr !== "string") {
    return err("str_replace requires `old_str` and `new_str` strings");
  }
  const file = physFile(ctx, cp.topic);
  if (!existsSync(file)) {
    return err(`memory not found: ${path}`);
  }
  const content = readFileSync(file, "utf8");
  const count = countOccurrences(content, oldStr);
  if (count !== 1) {
    // str_replace 唯一性强制
    return err(
      `old_str not unique: found ${count} match(es) in ${path} (requires exactly 1)`,
    );
  }
  const updated = content.replace(oldStr, newStr);
  writeFileSync(file, updated, "utf8");
  return ok(`Edited ${path}.`);
}

function cmdInsert(input: MemInput, ctx: MemCtx): MemResult {
  const path = input.path;
  const cp = canonicalMemoryPath(path);
  if (!cp.ok) return err(cp.error);
  const line = input.line;
  const content = input.content;
  if (typeof line !== "number" || typeof content !== "string") {
    return err("insert requires `line` (number) and `content` (string)");
  }
  const file = physFile(ctx, cp.topic);
  if (!existsSync(file)) {
    return err(`memory not found: ${path}`);
  }
  const raw = readFileSync(file, "utf8");
  const lines = raw.length === 0 ? [] : raw.split("\n");
  // 末尾 trailing newline → 移除末尾空串以保持语义
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const insertIdx = Math.max(0, Math.min(line, lines.length));
  const inserted = content.split("\n");
  lines.splice(insertIdx, 0, ...inserted);
  writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return ok(`Inserted into ${path} at line ${insertIdx}.`);
}

function cmdDelete(input: MemInput, ctx: MemCtx): MemResult {
  const path = input.path;
  const cp = canonicalMemoryPath(path);
  if (!cp.ok) return err(cp.error);
  const file = physFile(ctx, cp.topic);
  if (!existsSync(file)) {
    return err(`memory not found: ${path}`);
  }
  // 归档到 archive/memory/<userId>/<projectId>/<topic>.<ts>.md（不物理删除）
  const ts = Date.now();
  const archiveFile = join(archiveDir(ctx), `${cp.topic}.${ts}.md`);
  ensureDir(archiveFile);
  copyFileSync(file, archiveFile);
  unlinkSync(file);
  removeMemoryIndexLine(indexPath(ctx), cp.topic);
  return ok(`Deleted ${path} (archived to ${archiveFile}).`);
}

function cmdRename(input: MemInput, ctx: MemCtx): MemResult {
  const oldPath = input.path;
  const newPath = input.new_path;
  if (typeof newPath !== "string") {
    return err("rename requires `new_path` string");
  }
  const cpOld = canonicalMemoryPath(oldPath);
  if (!cpOld.ok) return err(cpOld.error);
  const cpNew = canonicalMemoryPath(newPath);
  if (!cpNew.ok) return err(cpNew.error);
  const oldFile = physFile(ctx, cpOld.topic);
  if (!existsSync(oldFile)) {
    return err(`memory not found: ${oldPath}`);
  }
  const newFile = physFile(ctx, cpNew.topic);
  if (existsSync(newFile)) {
    return err(`rename refuses to overwrite existing memory: ${newPath}`);
  }
  // 归档旧文件副本（never-auto-delete 语义），再移动
  const ts = Date.now();
  const archiveFile = join(archiveDir(ctx), `${cpOld.topic}.${ts}.md`);
  ensureDir(archiveFile);
  copyFileSync(oldFile, archiveFile);
  ensureDir(newFile);
  writeFileSync(newFile, readFileSync(oldFile, "utf8"), "utf8");
  unlinkSync(oldFile);
  replaceMemoryIndexLine(indexPath(ctx), cpOld.topic, cpNew.topic);
  return ok(`Renamed ${oldPath} to ${newPath} (prior version archived).`);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 执行 memory tool 六命令。纯同步、无副作用外溢（除文件系统写入外）。
 * 任何校验失败返回 `{ isError: true, content }`，不抛出。
 */
export function executeMemory(input: MemInput, ctx: MemCtx): MemResult {
  switch (input.command) {
    case "view":
      return cmdView(input, ctx);
    case "create":
      return cmdCreate(input, ctx);
    case "str_replace":
      return cmdStrReplace(input, ctx);
    case "insert":
      return cmdInsert(input, ctx);
    case "delete":
      return cmdDelete(input, ctx);
    case "rename":
      return cmdRename(input, ctx);
    default:
      return err(`unknown command: ${(input as { command?: string }).command}`);
  }
}
