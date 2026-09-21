// L1-T06 · tool description/field-doc 基质 + selection-accuracy 信号采集
//
// registry YAML 形状锁：inputSchema 的 `types`/`required`/`enum` 三组形状键
// 锁 static-core（不可改，比对基准 = 外部注入 `baselineShape` 钉死版本，
// 逐键深度相等）；`description`/`fieldDoc`/`examples` 文本可进化（T07 loop）。
// `name` 字段不可变（MCP 契约 + pi 重名键）。
//
// selection-accuracy 必须与 resolve 联合——单看选中率会让 description 进化
// 「骗」模型选某工具（02-loop-context §2.2 reward hacking 风险）。
// 故 `collectSelectionSignal` 写 `{firstStepCorrect, resolved}` 联合信号。
//
// 复用 TelemetrySink（结构接口 `{ write(event): void }`，ERRATA-w2plus L1 裁决）。

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ConfigRepo } from "./repo-layout.js";
// 复用 L1-T02 已定义的 TelemetrySink 结构接口（ERRATA-w2plus L1 裁决：
// `TelemetrySink = { write(event): void }`，与 `TranscriptWriter` 经 `append` 适配）。
import type { TelemetrySink } from "./compaction-substrate.js";
export type { TelemetrySink };

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * 形状基准（钉死版本 inputSchema 形状键）。
 * 由外部注入（`opts.baselineShape`），比对 registry YAML 解析后的形状键。
 */
export interface BaselineShape {
  readonly types: readonly string[];
  readonly required: readonly string[];
  readonly enum?: Readonly<Record<string, readonly string[]>>;
}

/**
 * 工具文档基质（registry YAML 解析产物）。
 * `name` 不可改（static-core，MCP 契约 + pi 重名键）。
 * `inputSchema` 的 `types`/`required`/`enum` 形状键锁 static-core；
 * `description`/`fieldDoc`/`examples` 可进化（T07）。
 */
export interface ToolDoc {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<{
    types: readonly string[];
    required: readonly string[];
    enum?: Readonly<Record<string, readonly string[]>>;
    properties?: Readonly<Record<string, unknown>>;
  }>;
  readonly fieldDoc: Readonly<Record<string, string>>;
  readonly examples: readonly string[];
}

/**
 * selection-accuracy 联合信号。
 * `firstStepCorrect`：trajectory 第一步 tool_use == 预期最优。
 * `resolved`：选对后该工具真的 resolve 了 task（防「骗选中」）。
 */
export interface SelectionSignal {
  readonly toolSha: string;
  readonly firstStepCorrect: boolean;
  readonly resolved: boolean;
  readonly sampledAt: number;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * inputSchema 形状键（types/required/enum）被改时抛出。
 * 形状锁 static-core：比对基准 = `baselineShape` 钉死版本，逐键深度相等。
 */
export class SchemaShapeLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaShapeLockedError";
  }
}

// ── 常量 ───────────────────────────────────────────────────────────────────

/**
 * 跨工具贬抑语关键词集（大小写不敏感）。
 * 命中 → `load` flag 告警（不阻塞 load，记 `cross_tool_disparagement` 事件）。
 */
export const DISPARAGEMENT_TERMS = [
  "better than",
  "worse than",
  "superior to",
  "inferior to",
] as const;

/** registry 文件根目录（相对 repo root，posix）。 */
const REGISTRY_DIR = "tools/registry";

/** selection 信号 telemetry 事件 type 标识。 */
const SELECTION_EVENT_TYPE = "selection_signal";
/** 跨工具贬抑语告警 telemetry 事件 type 标识。 */
const DISPARAGEMENT_EVENT_TYPE = "cross_tool_disparagement";

// ── 纯函数：schema 形状锁 ───────────────────────────────────────────────────

/**
 * 深度相等（值/数组/普通对象；数组按序比；不处理循环与 Date）。
 * 用于逐键比对 inputSchema 形状键与 baseline。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const ka = Object.keys(oa);
    const kb = Object.keys(ob);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(oa[k], ob[k]));
  }
  return false;
}

/**
 * 断言 registry 解析出的 inputSchema 形状键（types/required/enum）与
 * 钉死 baseline 逐键深度相等；失配 → throw `SchemaShapeLockedError`。
 * `properties` 等非形状键字段不参与比对（可改）。
 *
 * 抽成纯函数供 T07 进化 loop 变异后复检 + L0C-T08 pre-commit 共用。
 */
export function assertShapeLocked(
  toolName: string,
  manifest: {
    readonly types: readonly string[];
    readonly required: readonly string[];
    readonly enum?: Readonly<Record<string, readonly string[]>>;
  },
  baseline: BaselineShape,
): void {
  if (!deepEqual(manifest.types, baseline.types)) {
    throw new SchemaShapeLockedError(
      `inputSchema.types shape locked for tool '${toolName}': baseline ${JSON.stringify(
        baseline.types,
      )} != manifest ${JSON.stringify(manifest.types)}`,
    );
  }
  if (!deepEqual(manifest.required, baseline.required)) {
    throw new SchemaShapeLockedError(
      `inputSchema.required shape locked for tool '${toolName}': baseline ${JSON.stringify(
        baseline.required,
      )} != manifest ${JSON.stringify(manifest.required)}`,
    );
  }
  if (!deepEqual(manifest.enum ?? {}, baseline.enum ?? {})) {
    throw new SchemaShapeLockedError(
      `inputSchema.enum shape locked for tool '${toolName}': baseline ${JSON.stringify(
        baseline.enum ?? {},
      )} != manifest ${JSON.stringify(manifest.enum ?? {})}`,
    );
  }
}

/**
 * 大小写不敏感扫描 description 是否命中贬抑语关键词集。
 * 命中 → 返回命中的关键词数组；未命中 → 空数组。
 */
export function detectDisparagement(
  description: string,
): readonly string[] {
  const lower = description.toLowerCase();
  return DISPARAGEMENT_TERMS.filter((term) => lower.includes(term));
}

// ── 极简 YAML 解析（registry 形状子集） ─────────────────────────────────────
//
// 无外部依赖（禁新依赖）：手写缩进递归解析，覆盖 registry YAML 形状：
//   key: <scalar|inline-array|inline-object>
//   key:
//     <nested mapping / sequence>
//   - <list item scalar>
// inline 值用 `JSON.parse` 兜底 `["a","b"]` / `{}` / `"str"`。

interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

function tokenize(content: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    // 跳过空行与注释行
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    let indent = 0;
    while (raw[indent] === " ") indent++;
    out.push({ indent, text: raw.slice(indent) });
  }
  return out;
}

function parseInline(value: string): unknown {
  const v = value.trim();
  if (v === "") return null;
  if (v.startsWith("[") || v.startsWith("{")) {
    try {
      return JSON.parse(v);
    } catch {
      // 容错：单引号或裸数组 → 退化为字符串
      return v;
    }
  }
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * 递归解析一个块（mapping 或 sequence），返回 [value, nextIndex]。
 * `indent` 为本块的缩进级别。
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
      const itemRaw = cur.text.slice(2).trim();
      // item 可能是 inline 值或 key: value（mapping item）—— registry 只需 scalar item
      arr.push(parseInline(itemRaw));
      i++;
    }
    return [arr, i];
  }
  // mapping
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const cur = lines[i];
    if (!cur || cur.indent !== indent) break;
    if (cur.text.startsWith("- ")) break; // 兄弟 sequence 不属于此 mapping
    const colonIdx = cur.text.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = cur.text.slice(0, colonIdx).trim();
    const rest = cur.text.slice(colonIdx + 1).trim();
    i++;
    if (rest === "") {
      // nested block：子行缩进 > indent
      const childLine = i < lines.length ? lines[i] : undefined;
      if (childLine && childLine.indent > indent) {
        const [child, next] = parseBlock(lines, i, childLine.indent);
        obj[key] = child;
        i = next;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseInline(rest);
    }
  }
  return [obj, i];
}

function parseYaml(content: string): Record<string, unknown> {
  const lines = tokenize(content);
  if (lines.length === 0) return {};
  const first = lines[0]!;
  const [val] = parseBlock(lines, 0, first.indent);
  return (val as Record<string, unknown>) ?? {};
}

// ── ToolDoc 构建 + 冻结 ─────────────────────────────────────────────────────

function toStringArray(v: unknown): readonly string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

function toStringMap(v: unknown): Readonly<Record<string, string>> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = String(val ?? "");
    }
    return Object.freeze(out);
  }
  return Object.freeze({});
}

function buildToolDoc(parsed: Record<string, unknown>): ToolDoc {
  const name = String(parsed.name ?? "");
  const description = String(parsed.description ?? "");
  const rawSchema = (parsed.inputSchema ?? {}) as Record<string, unknown>;
  const types = toStringArray(rawSchema.types);
  const required = toStringArray(rawSchema.required);
  const enumVal = (rawSchema.enum ?? undefined) as
    | Readonly<Record<string, readonly string[]>>
    | undefined;
  const propertiesVal = (rawSchema.properties ?? undefined) as
    | Readonly<Record<string, unknown>>
    | undefined;
  const fieldDoc = toStringMap(parsed.fieldDoc);
  const examples = toStringArray(parsed.examples);

  const inputSchema: ToolDoc["inputSchema"] = {
    types: Object.freeze(types) as readonly string[],
    required: Object.freeze(required) as readonly string[],
    ...(enumVal !== undefined ? { enum: Object.freeze(enumVal) } : {}),
    ...(propertiesVal !== undefined
      ? { properties: Object.freeze(propertiesVal) }
      : {}),
  };

  const doc: ToolDoc = {
    name,
    description,
    inputSchema: Object.freeze(inputSchema) as ToolDoc["inputSchema"],
    fieldDoc,
    examples: Object.freeze(examples.slice()) as readonly string[],
  };
  return Object.freeze(doc) as ToolDoc;
}

// ── ToolRegistry ───────────────────────────────────────────────────────────

export interface ToolRegistryOptions {
  readonly telemetry: TelemetrySink;
  readonly repo?: ConfigRepo;
  /** 形状基准（钉死版本 inputSchema 形状键）；缺省时跳过形状锁校验。 */
  readonly baselineShape?: BaselineShape;
}

/**
 * tool description/field-doc 基质加载器 + selection-accuracy 信号采集器。
 *
 * - `load(repo)`：经 `ConfigRepo.loadActive()` 校验 sha 钉死，读 `tools/registry/*.yaml`，
 *   解析为冻结的 `ToolDoc`；`inputSchema` 形状键失配 → throw `SchemaShapeLockedError`；
 *   description 命中贬抑语 → flag 告警（不阻塞 load）。
 * - `collectSelectionSignal(signal)`：写 selection ∧ resolve 联合信号 telemetry 事件。
 */
export class ToolRegistry {
  private readonly telemetry: TelemetrySink;
  private readonly repo: ConfigRepo | undefined;
  private readonly baselineShape: BaselineShape | undefined;

  constructor(opts: ToolRegistryOptions) {
    this.telemetry = opts.telemetry;
    this.repo = opts.repo;
    this.baselineShape = opts.baselineShape;
  }

  /**
   * 加载 registry 基质：校验 sha 钉死 → 读 `tools/registry/*.yaml` → 解析冻结。
   * `baselineShape` 存在时校验 inputSchema 形状键逐键深度相等，失配 → throw。
   * description 贬抑语 → 告警事件（不阻塞）。
   */
  load(repo: ConfigRepo): Record<string, ToolDoc> {
    const activeRepo = repo ?? this.repo;
    if (!activeRepo) {
      throw new Error("ToolRegistry.load: no ConfigRepo provided");
    }
    // sha 钉死校验（全 lock.files）；失配 → throw ShaMismatchError，绝不半加载。
    activeRepo.loadActive();
    const registryDir = join(activeRepo.getRoot(), REGISTRY_DIR);
    let entries: string[] = [];
    try {
      entries = readdirSync(registryDir).filter((f) => /\.ya?ml$/i.test(f));
    } catch {
      // registry 目录缺失 → 返回空 map（无基质可加载，但非错误路径）
      return Object.freeze({}) as Record<string, ToolDoc>;
    }
    const docs: Record<string, ToolDoc> = {};
    for (const file of entries) {
      const abs = join(registryDir, file);
      const content = readFileSync(abs, "utf8");
      const parsed = parseYaml(content);
      const doc = buildToolDoc(parsed);
      // schema 形状锁（static-core）：逐键深度相等比对 baseline
      if (this.baselineShape) {
        assertShapeLocked(
          doc.name,
          {
            types: doc.inputSchema.types,
            required: doc.inputSchema.required,
            ...(doc.inputSchema.enum !== undefined
              ? { enum: doc.inputSchema.enum }
              : {}),
          },
          this.baselineShape,
        );
      }
      // 跨工具贬抑语扫描（不阻塞 load，记告警事件）
      const hits = detectDisparagement(doc.description);
      if (hits.length > 0) {
        this.telemetry.write({
          event: DISPARAGEMENT_EVENT_TYPE,
          tool: doc.name,
          terms: hits,
          description: doc.description,
        });
      }
      docs[doc.name] = doc;
    }
    return Object.freeze(docs) as Record<string, ToolDoc>;
  }

  /**
   * 写 selection ∧ resolve 联合信号 telemetry 事件。
   * 选对+resolve 与 选对+未resolve 均落 telemetry（T07 用联合判定）。
   */
  collectSelectionSignal(signal: SelectionSignal): void {
    this.telemetry.write({
      event: SELECTION_EVENT_TYPE,
      toolSha: signal.toolSha,
      firstStepCorrect: signal.firstStepCorrect,
      resolved: signal.resolved,
      sampledAt: signal.sampledAt,
    });
  }
}
