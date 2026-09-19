// L2-T02 (REFACTOR) · 共享 cap guard。
//
// MEMORY.md 的 200 行 / 25KB 硬上限（CC auto-memory 语义）与 L2-T10 active
// 库 C=50 cap 复用同一机制：超出时 **tail 静默丢弃**（不报错）。
//
// 语义：给定一个行数组，从末尾逐行弹出（drop tail）直到同时满足
// `lines.length <= maxLines` 且 `byteLength(lines) <= maxBytes`。
// 保留 head（较早写入的条目），丢弃 tail（最新写入的溢出条目）。
import { Buffer } from "node:buffer";

/**
 * 计算行数组序列化后的 UTF-8 字节数（行间 `\n` + 末尾 `\n`）。
 */
export function linesByteLength(lines: readonly string[]): number {
  return Buffer.byteLength(lines.join("\n") + "\n", "utf8");
}

/**
 * 强制 cap：从 tail 弹出直到满足 `maxLines` 与 `maxBytes`。
 * 返回新数组（不修改入参）。当 `lines` 为空时返回空数组。
 */
export function enforceCap(
  lines: readonly string[],
  maxLines: number,
  maxBytes: number,
): string[] {
  const out: string[] = [...lines];
  while (out.length > 0 && out.length > maxLines) {
    out.pop();
  }
  while (out.length > 0 && linesByteLength(out) > maxBytes) {
    out.pop();
  }
  return out;
}
