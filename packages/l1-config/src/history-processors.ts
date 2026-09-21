// L1-T09 · history-processors 链 config + 进化（cut 边界 static-core）
//
// compaction 截断历史处理器选择（02-loop-context §2.4(b)）。进化的对象 =
// `config/history-processors.yaml`（有序处理器链 + 每处理器参数，SWE-agent
// `LastNObservations` / `ClosedWindowHistoryProcessor` / `RemoveRegex` /
// `CacheControlHistoryProcessor`）。信号 = resolve ∧ cache hit ∧ recall。
//
// 安全门：cut 边界规则（只在 user/assistant 边界、不孤儿 tool_result）
// = static-core（L0C-T05 契约），处理器链不可改 cut 边界。
//
// 复用 vs 自研：processor kind 参考 SWE-agent `history_processors`（02-loop-context
// §2.4 核真）；Pareto 三目标强 Pareto（cacheHit 软目标隐含 token 成本）。
// cut 边界判定与 L0C-T05 `assertCutNotOrphan` 同语义（消除漂移）。
//
// 注：kind 取自 YAML（SWE-agent canonical 名，如 `CacheControlHistoryProcessor`），
// 故 `kind` 声明为 `string` 以承载 YAML 原值；spec §L1-T09 接口签名的 union
// 仅列短名 `CacheControl`，与 YAML 用的全名并存——evolve 插入短名 `CacheControl`
// 候选以对齐 spec union，二者在链中共存不冲突（见 evolve 实现注释）。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigRepo } from "./repo-layout.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * 有序 history processor 链中的一条处理器配置。
 *
 * `kind` 为 YAML 驱动的字符串（SWE-agent canonical 名，如
 * `LastNObservations` / `CacheControlHistoryProcessor`）。spec §L1-T09 给出
 * 的 union 短名（`LastNObservations` / `ClosedWindow` / `RemoveRegex` /
 * `CacheControl`）作为合法子集；evolve 产候选时使用短名以对齐 spec union。
 */
export interface ProcessorEntry {
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** 有序 history processor 链（整体可进化基质）。 */
export interface HistoryChain {
  readonly processors: readonly ProcessorEntry[];
}

/**
 * 进化信号（telemetry 采集）。
 * - `resolveRate`：被截断后任务仍 resolve 的比例（越高越好）。
 * - `cacheHitRate`：processor 改 cache 前缀 → miss（越低越坏）。
 * - `recall`：被截断信息后来被重读次数（越低越好——丢信息少）。
 * - `isBaseline`：是否为基线分（用于 Pareto 比较锚点）。
 */
export interface HistoryScore {
  readonly resolveRate: number;
  readonly cacheHitRate: number;
  readonly recall: number;
  readonly isBaseline: boolean;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * 处理器链 cut 在 `tool_result` 处（孤儿 tool_call）时抛出。
 *
 * cut 边界 = static-core（L0C-T05 契约）：compaction 截断只落在
 * user/assistant message 边界，cut 在 `tool_result` 会孤儿其前导
 * `tool_use` → provider 400。处理器链进化绝不能绕过该契约。
 */
export class CutBoundaryViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CutBoundaryViolationError";
  }
}

// ── 极简 YAML 解析（history-processors.yaml 形状子集） ────────────────────
//
// 无外部依赖（禁新依赖）：手写缩进递归解析，覆盖 history-processors.yaml 形状：
//   processors:
//     - kind: <name>
//       params: { ... }            # inline object
//     - kind: <name>
//       params:                     # nested block mapping
//         key: value
// 支持序列项为多行 mapping（`- key: value` 后跟缩进的 `key: value` 续行）。
// inline 值用 `JSON.parse` 兜底，并容错未加引号的 key（`{ n: 20 }`）。

interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

function tokenizeYaml(content: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    let indent = 0;
    while (raw[indent] === " ") indent++;
    out.push({ indent, text: raw.slice(indent) });
  }
  return out;
}

/** 解析 inline 标量 / 数组 / 对象。容错未加引号的 key（`{ n: 20 }`）。 */
function parseInlineValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return null;
  if (v.startsWith("[") || v.startsWith("{")) {
    // 尝试 JSON.parse（合法 JSON）
    try {
      return JSON.parse(v);
    } catch {
      // 容错：未加引号的 key → `{ n: 20 }` / `{ n: 20, m: 'x' }`
      return parseInlineObjectOrArray(v);
    }
  }
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  // 数字
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  return v;
}

/** 容错解析未加引号 key 的 inline object/array（`{ n: 20, m: x }`）。 */
function parseInlineObjectOrArray(v: string): unknown {
  const inner = v.slice(1, -1).trim(); // strip { } or [ ]
  if (inner === "") return v.startsWith("{") ? {} : [];
  // 简单逗号分割（不支持嵌套 inline 复合体）
  const parts = splitTopLevelCommas(inner);
  if (v.startsWith("[")) {
    return parts.map((p) => parseInlineValue(p));
  }
  const obj: Record<string, unknown> = {};
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) {
      obj[part.trim()] = null;
      continue;
    }
    const key = part.slice(0, colonIdx).trim();
    const val = part.slice(colonIdx + 1).trim();
    obj[key] = parseInlineValue(val);
  }
  return obj;
}

/** 按顶层逗号分割（不深入 `{}` / `[]` 内部）。 */
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts;
}

/**
 * 递归解析一个块，返回 [value, nextIndex]。支持 mapping 与 sequence，
 * sequence 项可为多行 mapping（`- key: value` + 缩进续行）。
 */
function parseBlock(
  lines: YamlLine[],
  start: number,
  indent: number,
): [unknown, number] {
  const startLine = lines[start];
  if (!startLine || startLine.indent !== indent) {
    return [{}, start];
  }
  // sequence?
  if (startLine.text.startsWith("- ")) {
    const arr: unknown[] = [];
    let i = start;
    while (i < lines.length) {
      const cur = lines[i];
      if (!cur || cur.indent !== indent || !cur.text.startsWith("- ")) break;
      // item 首行：`- <rest>`
      const rest = cur.text.slice(2).trim();
      i++;
      if (rest === "") {
        // 空项，可能后续为多行 mapping 子块
        const childLine = i < lines.length ? lines[i] : undefined;
        if (childLine && childLine.indent > indent) {
          const [child, next] = parseBlock(lines, i, childLine.indent);
          arr.push(child);
          i = next;
        } else {
          arr.push(null);
        }
      } else if (rest.includes(":")) {
        // mapping item：首行 `key: value`，后续更缩进行属本 item
        const itemObj: Record<string, unknown> = {};
        const [k, val] = splitKeyValue(rest);
        if (val === "") {
          // value 在子块
          const childLine = i < lines.length ? lines[i] : undefined;
          if (childLine && childLine.indent > indent) {
            const [child, next] = parseBlock(lines, i, childLine.indent);
            itemObj[k] = child;
            i = next;
          } else {
            itemObj[k] = null;
          }
        } else {
          itemObj[k] = parseInlineValue(val);
        }
        // 收集本 item 的后续缩进行（indent > cur.indent）
        while (i < lines.length) {
          const cont = lines[i];
          if (!cont || cont.indent <= indent) break;
          if (cont.text.startsWith("- ")) break;
          const [ck, cval] = splitKeyValue(cont.text);
          if (cval === "") {
            const childLine = i + 1 < lines.length ? lines[i + 1] : undefined;
            if (childLine && childLine.indent > cont.indent) {
              const [child, next] = parseBlock(lines, i + 1, childLine.indent);
              itemObj[ck] = child;
              i = next;
            } else {
              itemObj[ck] = null;
              i++;
            }
          } else {
            itemObj[ck] = parseInlineValue(cval);
            i++;
          }
        }
        arr.push(itemObj);
      } else {
        // 标量 item
        arr.push(parseInlineValue(rest));
      }
    }
    return [arr, i];
  }
  // mapping
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const cur = lines[i];
    if (!cur || cur.indent !== indent) break;
    if (cur.text.startsWith("- ")) break;
    const [k, val] = splitKeyValue(cur.text);
    if (k === "" && val === "") {
      i++;
      continue;
    }
    i++;
    if (val === "") {
      const childLine = i < lines.length ? lines[i] : undefined;
      if (childLine && childLine.indent > indent) {
        const [child, next] = parseBlock(lines, i, childLine.indent);
        obj[k] = child;
        i = next;
      } else {
        obj[k] = null;
      }
    } else {
      obj[k] = parseInlineValue(val);
    }
  }
  return [obj, i];
}

/** `key: value` → [key, value]（value 可能为空串表示子块）。 */
function splitKeyValue(text: string): [string, string] {
  const colonIdx = text.indexOf(":");
  if (colonIdx === -1) return [text.trim(), ""];
  const key = text.slice(0, colonIdx).trim();
  const val = text.slice(colonIdx + 1).trim();
  return [key, val];
}

function parseYaml(content: string): Record<string, unknown> {
  const lines = tokenizeYaml(content);
  if (lines.length === 0) return {};
  const first = lines[0]!;
  const [val] = parseBlock(lines, 0, first.indent);
  return (val as Record<string, unknown>) ?? {};
}

// ── HistoryChain 构建 + 冻结 ──────────────────────────────────────────────

function toParams(v: unknown): Readonly<Record<string, unknown>> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return Object.freeze({ ...(v as Record<string, unknown>) });
  }
  return Object.freeze({});
}

function buildChain(parsed: Record<string, unknown>): HistoryChain {
  const raw = parsed.processors;
  const list: ProcessorEntry[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        list.push({
          kind: String(rec.kind ?? ""),
          params: toParams(rec.params),
        });
      } else if (typeof item === "string") {
        list.push({ kind: item, params: Object.freeze({}) });
      }
    }
  }
  return Object.freeze({ processors: Object.freeze(list) }) as HistoryChain;
}

// ── cut 边界守卫（L0C-T05 同语义） ─────────────────────────────────────────

/**
 * 判定处理器参数是否指示一个落在 `tool_result` 处的 cut。
 *
 * 与 L0C-T05 `assertCutNotOrphan` 同语义：cut 必须落在 user/assistant
 * message 边界，cut 在 `tool_result` 会孤儿前导 `tool_use` → provider 400。
 * 处理器链以参数（`cutAt` / `cut_at` / `boundary`）声明 cut 位置；声明为
 * `tool_result` 即违反 static-core cut 边界契约。
 */
function declaresToolResultCut(params: Readonly<Record<string, unknown>>): boolean {
  const keys = ["cutAt", "cut_at", "boundary", "cutBoundary", "cut_boundary"];
  for (const k of keys) {
    const v = params[k];
    if (typeof v === "string" && v === "tool_result") return true;
  }
  return false;
}

// ── HistoryProcessors ──────────────────────────────────────────────────────

/** active 配置路径（相对 repo root，posix）。 */
const HISTORY_PROCESSORS_PATH = "config/history-processors.yaml";

/**
 * history-processors 链 config 加载 + 进化 driver + cut 边界守卫。
 *
 * - `load(repo)`：经 `ConfigRepo.loadActive()` 校验 sha 钉死，读
 *   `config/history-processors.yaml` → 解析为冻结 `HistoryChain`。
 * - `evolve(chain, scores)`：读信号（cache hit 低、recall 高=丢信息）→
 *   产候选链（如插入 `CacheControl` processor 保 cache）；三目标强 Pareto
 *   非劣才入选（cacheHit 不可降）。
 * - `assertCutBoundaryRespected(chain)`：候选链 cut 在 `tool_result` 处 →
 *   throw `CutBoundaryViolationError`（cut 边界 static-core，L0C-T05 契约）。
 * - `fallbackChain()`：最坏情况回退链（drop oldest tool_results only，
 *   02-loop-context §2.4(f)）。
 */
export class HistoryProcessors {
  private readonly repo: ConfigRepo | undefined;

  constructor(opts: { repo?: ConfigRepo }) {
    this.repo = opts.repo;
  }

  /**
   * 加载 active history-processors 链。
   * 经 `ConfigRepo.loadActive()` 校验 sha 钉死（防篡改），读 YAML → 冻结。
   */
  load(repo: ConfigRepo): HistoryChain {
    // 触发 sha 钉死校验（active 快照 swap 前校验；失配 → throw 不返回半加载态）
    repo.loadActive();
    const abs = join(repo.getRoot(), HISTORY_PROCESSORS_PATH);
    const content = readFileSync(abs, "utf8");
    const parsed = parseYaml(content);
    return buildChain(parsed);
  }

  /**
   * 守卫：处理器链 cut 边界尊重 static-core（L0C-T05 契约）。
   *
   * 任一 processor 的 params 声明 cut 落在 `tool_result` 处 → throw
   * `CutBoundaryViolationError`（孤儿 tool_use_id → provider 400）。
   * 仅在 user/assistant 边界 cut 的链 → 通过。
   */
  assertCutBoundaryRespected(chain: HistoryChain): void {
    for (const p of chain.processors) {
      if (declaresToolResultCut(p.params)) {
        throw new CutBoundaryViolationError(
          `cut boundary violation: processor '${p.kind}' declares cut at tool_result (orphan tool_use_id, L0C-T05 contract)`,
        );
      }
    }
  }

  /**
   * 进化 history-processors 链。
   *
   * 信号驱动：
   * - `cacheHitRate` 低（processor 改 cache 前缀 → miss）→ 插入 `CacheControl`
   *   processor 保 cache（若链中无短名 `CacheControl` 候选）。
   * - `recall` 高（被截断信息后来被重读=丢信息）→ 不再追加截断处理器。
   *
   * 强 Pareto（三目标非劣）：候选不可在 resolve ∧ cacheHit ∧ recall 任一维
   * 相对 baseline 退化。`evolve` 产的候选链只追加 `CacheControl`（改善 cacheHit，
   * 不影响 resolve/recall），天然 Pareto 非劣；若信号表明某候选会退化
   * cacheHit（过度截断）→ 不采纳该候选，回退原链。
   *
   * 注：插入的候选 processor 用 spec union 短名 `CacheControl`（对齐
   * §L1-T09 接口签名 union），与 YAML 原 `CacheControlHistoryProcessor` 在
   * 链中共存不冲突——`CacheControl` 是 evolution 产出的 canonical 短名。
   */
  evolve(chain: HistoryChain, scores: readonly HistoryScore[]): HistoryChain {
    const baseline =
      scores.find((s) => s.isBaseline) ?? (scores.length > 0 ? scores[0] : undefined);

    const cacheHitLow = scores.some((s) => s.cacheHitRate < 0.5);

    // 强 Pareto 预检：若存在非 baseline 候选其 cacheHit 较 baseline 退化
    // （过度截断，02-loop-context §2.4(e) 双门）→ 该候选不可入选，回退原链。
    let degraded = false;
    if (baseline) {
      for (const s of scores) {
        if (s.isBaseline) continue;
        if (
          s.cacheHitRate < baseline.cacheHitRate ||
          s.resolveRate < baseline.resolveRate ||
          s.recall > baseline.recall
        ) {
          degraded = true;
          break;
        }
      }
    }

    const result: ProcessorEntry[] = [...chain.processors];

    if (!degraded && cacheHitLow) {
      // 插入 CacheControl 候选（若链中无短名 CacheControl）
      if (!result.some((p) => p.kind === "CacheControl")) {
        result.push({ kind: "CacheControl", params: Object.freeze({}) });
      }
    }

    // 候选链 cut 边界守卫（static-core）：插入不破坏 cut 边界契约。
    const candidate: HistoryChain = Object.freeze({
      processors: Object.freeze(result),
    }) as HistoryChain;
    this.assertCutBoundaryRespected(candidate);
    return candidate;
  }

  /**
   * 最坏情况回退链（02-loop-context §2.4(f)）。
   *
   * 当进化 driver 无法产出 Pareto 非劣候选时，回退到「drop oldest
   * tool_results only」链——只丢最旧的 tool_result，保留 user/assistant
   * 边界与近期 tool_use/tool_result 配对，绝不孤儿 tool_call。
   */
  fallbackChain(): HistoryChain {
    return Object.freeze({
      processors: Object.freeze([
        {
          kind: "LastNObservations",
          params: Object.freeze({ drop: "oldest_tool_results_only" }),
        },
      ]),
    }) as HistoryChain;
  }
}
