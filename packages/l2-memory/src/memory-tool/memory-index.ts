// L2-T02 · MEMORY.md 索引维护 + /memories 虚拟前缀。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T02。
// MEMORY.md 是 per-user+per-project 的记忆索引文件（≤200 行 / ≤25KB 硬上限）。
// 超出时 tail 静默丢弃（CC auto-memory 硬上限语义），不报错。
//
// 索引行格式：`- /memories/<topic>`（自研格式；spec 未约束精确文本，
// 仅要求含 topic 名 + 一行一条目）。一行一条目保证 cap 按行计数语义清晰。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { enforceCap, linesByteLength } from "../shared/cap-guard.js";

/** CC auto-memory 硬上限：≤200 行。 */
export const MAX_LINES = 200;
/** CC auto-memory 硬上限：≤25KB（25600 bytes）。 */
export const MAX_BYTES = 25600;

/**
 * 构造某 topic 的索引行。
 */
export function indexLineFor(topic: string): string {
  return `- /memories/${topic}`;
}

/**
 * 读取索引文件为行数组（去除末尾空行）。文件不存在时返回空数组。
 */
export function readIndexLines(indexPath: string): string[] {
  if (!existsSync(indexPath)) return [];
  const raw = readFileSync(indexPath, "utf8");
  const lines = raw.split("\n");
  // 去除末尾由 trailing newline 产生的空串
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * 把行数组写回索引文件（行间 `\n` + 末尾 `\n`）。自动创建父目录。
 */
function writeIndexLines(indexPath: string, lines: readonly string[]): void {
  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, lines.join("\n") + "\n", "utf8");
}

/**
 * 追加一条索引行，并强制 cap（tail 静默丢弃）。不报错。
 */
export function appendMemoryIndexLine(
  indexPath: string,
  topic: string,
): void {
  const lines = readIndexLines(indexPath);
  lines.push(indexLineFor(topic));
  const capped = enforceCap(lines, MAX_LINES, MAX_BYTES);
  writeIndexLines(indexPath, capped);
}

/**
 * 移除某 topic 的索引行（精确匹配）。无该行则无操作。
 */
export function removeMemoryIndexLine(
  indexPath: string,
  topic: string,
): void {
  if (!existsSync(indexPath)) return;
  const lines = readIndexLines(indexPath);
  const target = indexLineFor(topic);
  const filtered = lines.filter((l) => l !== target);
  // 移除后不会超 cap，直接写回
  writeIndexLines(indexPath, filtered);
}

/**
 * 把某 topic 的旧索引行替换为新索引行（用于 rename）。无旧行则追加新行。
 */
export function replaceMemoryIndexLine(
  indexPath: string,
  oldTopic: string,
  newTopic: string,
): void {
  const lines = readIndexLines(indexPath);
  const oldLine = indexLineFor(oldTopic);
  const newLine = indexLineFor(newTopic);
  const idx = lines.indexOf(oldLine);
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    lines.push(newLine);
  }
  const capped = enforceCap(lines, MAX_LINES, MAX_BYTES);
  writeIndexLines(indexPath, capped);
}

/** 仅供测试/调试：返回当前索引字节数。 */
export function indexByteLength(indexPath: string): number {
  return linesByteLength(readIndexLines(indexPath));
}
