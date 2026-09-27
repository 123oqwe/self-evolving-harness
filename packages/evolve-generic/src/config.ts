// PLG-T07: evolve-generic — YAML 声明式通用适配器配置。
//
// Spec: execution/plugin/TASKS.md §PLG-T07 (config.ts)。
// 复用铁律（§0.2）：本文件只定义 GenericAdapterConfig 类型 + YAML 加载/校验，
// 不重造 HarnessPort 契约（@harness/adapters）或 Trajectory/LLMPort（@harness/l3-engine）。
//
// 依赖纪律：spec 执行提示 (4) 建议 `yaml` 包，但本任务"禁新依赖"门控下不可引入。
// 本文件内置一个**受限子集 YAML 解析器**（覆盖 fixture/示例所用语法：标量 /
// 双引号串 / 内联 `[...]` `{...}` / 缩进 block map / block sequence），零外部依赖。
// 受限子集足以解析全部 fixture 与 grokbuild/dsh 示例；非通用 YAML 实现。

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 配置类型（spec 接口签名逐字对齐）
// ---------------------------------------------------------------------------

export type GenericTrajectoryFormat = "jsonl" | "json" | "sqlite" | "none";

export interface GenericAdapterConfig {
  readonly harnessId: string;
  readonly verified: boolean;
  readonly substrate: {
    readonly idPrefix: string;
    readonly diskRoot: string;
    readonly repoRoot: string;
    readonly pathMap: Record<string, string>;
  };
  readonly trajectory: {
    readonly format: GenericTrajectoryFormat;
    readonly path: string;
    readonly table?: string;
    readonly sessionField?: string;
    readonly diagnosisFields: string[];
    readonly glob?: string;
  };
  readonly deploy: {
    readonly syncTarget?: string;
    readonly restartHint: string;
  };
  readonly llm: { readonly passThrough: true };
}

/** YAML schema 非法（缺 harnessId / substrate / format 非 4 选一 等）。 */
export class InvalidGenericConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGenericConfigError";
  }
}

// ---------------------------------------------------------------------------
// 受限子集 YAML 解析器
// ---------------------------------------------------------------------------

interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

function tokenize(src: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const raw of src.split(/\r?\n/)) {
    // 跳过空行与注释行
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const m = /^([ ]*)(.*)$/.exec(raw);
    if (!m) continue;
    out.push({ indent: m[1]!.length, text: m[2]!.replace(/\s+$/, "") });
  }
  return out;
}

function parseScalar(s: string): unknown {
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1);
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

/** 在顶层的分隔符（不进入引号/括号内部）拆分。 */
function splitTopLevel(src: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inDq = false;
  let inSq = false;
  let cur = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inDq) {
      cur += ch;
      if (ch === '"') inDq = false;
      continue;
    }
    if (inSq) {
      cur += ch;
      if (ch === "'") inSq = false;
      continue;
    }
    if (ch === '"') { inDq = true; cur += ch; continue; }
    if (ch === "'") { inSq = true; cur += ch; continue; }
    if (ch === "[" || ch === "{") { depth++; cur += ch; continue; }
    if (ch === "]" || ch === "}") { depth--; cur += ch; continue; }
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function parseInlineValue(raw: string): unknown {
  const s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    return splitTopLevel(inner, ",").map((p) => parseScalar(p.trim()));
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return {};
    const obj: Record<string, unknown> = {};
    for (const pair of splitTopLevel(inner, ",")) {
      const colon = pair.indexOf(":");
      if (colon === -1) continue;
      const k = pair.slice(0, colon).trim();
      obj[k] = parseScalar(pair.slice(colon + 1).trim());
    }
    return obj;
  }
  return parseScalar(s);
}

interface ParseResult {
  readonly value: unknown;
  readonly next: number;
}

function parseBlock(lines: YamlLine[], start: number, indent: number): ParseResult {
  if (start >= lines.length) return { value: null, next: start };
  const first = lines[start]!;
  if (first.text.startsWith("-")) {
    // block sequence
    const arr: unknown[] = [];
    let i = start;
    while (i < lines.length && lines[i]!.indent === indent && lines[i]!.text.startsWith("-")) {
      const itemRaw = lines[i]!.text.replace(/^-\s*/, "").trim();
      if (itemRaw === "") {
        // nested block under this item
        if (i + 1 < lines.length && lines[i + 1]!.indent > indent) {
          const child = parseBlock(lines, i + 1, lines[i + 1]!.indent);
          arr.push(child.value);
          i = child.next;
        } else {
          arr.push(null);
          i++;
        }
      } else {
        arr.push(parseInlineValue(itemRaw));
        i++;
      }
    }
    return { value: arr, next: i };
  }
  // block map
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length && lines[i]!.indent === indent && !lines[i]!.text.startsWith("-")) {
    const line = lines[i]!;
    const colon = line.text.indexOf(":");
    if (colon === -1) {
      i++;
      continue;
    }
    const key = line.text.slice(0, colon).trim();
    const valRaw = line.text.slice(colon + 1).trim();
    if (valRaw === "") {
      if (i + 1 < lines.length && lines[i + 1]!.indent > indent) {
        const child = parseBlock(lines, i + 1, lines[i + 1]!.indent);
        obj[key] = child.value;
        i = child.next;
      } else {
        obj[key] = null;
        i++;
      }
    } else {
      obj[key] = parseInlineValue(valRaw);
      i++;
    }
  }
  return { value: obj, next: i };
}

function parseYaml(src: string): unknown {
  const lines = tokenize(src);
  if (lines.length === 0) return null;
  return parseBlock(lines, 0, lines[0]!.indent).value;
}

// ---------------------------------------------------------------------------
// schema 校验
// ---------------------------------------------------------------------------

const VALID_FORMATS: readonly GenericTrajectoryFormat[] = ["jsonl", "json", "sqlite", "none"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new InvalidGenericConfigError(`invalid config: ${field} must be a non-empty string`);
  }
  return v;
}

function asBool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") {
    throw new InvalidGenericConfigError(`invalid config: ${field} must be a boolean`);
  }
  return v;
}

function asStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) {
    throw new InvalidGenericConfigError(`invalid config: ${field} must be an array`);
  }
  return v.map((x, idx) => {
    if (typeof x !== "string") {
      throw new InvalidGenericConfigError(`invalid config: ${field}[${idx}] must be a string`);
    }
    return x;
  });
}

function asStringRecord(v: unknown, field: string): Record<string, string> {
  if (!isObject(v)) {
    throw new InvalidGenericConfigError(`invalid config: ${field} must be a map`);
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "string") {
      throw new InvalidGenericConfigError(`invalid config: ${field}.${k} must be a string`);
    }
    out[k] = val;
  }
  return out;
}

export function validateConfig(raw: unknown): GenericAdapterConfig {
  if (!isObject(raw)) {
    throw new InvalidGenericConfigError("invalid config: root must be a map");
  }
  // harnessId
  if (raw.harnessId === undefined) {
    throw new InvalidGenericConfigError("invalid config: missing harnessId");
  }
  const harnessId = asString(raw.harnessId, "harnessId");
  const verified = asBool(raw.verified, "verified");

  const subRaw = raw.substrate;
  if (!isObject(subRaw)) {
    throw new InvalidGenericConfigError("invalid config: missing substrate");
  }
  const substrate = {
    idPrefix: asString(subRaw.idPrefix, "substrate.idPrefix"),
    diskRoot: asString(subRaw.diskRoot, "substrate.diskRoot"),
    repoRoot: asString(subRaw.repoRoot, "substrate.repoRoot"),
    pathMap: asStringRecord(subRaw.pathMap, "substrate.pathMap"),
  };

  const trajRaw = raw.trajectory;
  if (!isObject(trajRaw)) {
    throw new InvalidGenericConfigError("invalid config: missing trajectory");
  }
  if (typeof trajRaw.format !== "string" || !VALID_FORMATS.includes(trajRaw.format as GenericTrajectoryFormat)) {
    throw new InvalidGenericConfigError(
      `invalid config: trajectory.format must be one of ${VALID_FORMATS.join("/")}`,
    );
  }
  const format = trajRaw.format as GenericTrajectoryFormat;
  const trajectory: GenericAdapterConfig["trajectory"] = {
    format,
    path: typeof trajRaw.path === "string" ? trajRaw.path : "",
    diagnosisFields: asStringArray(trajRaw.diagnosisFields, "trajectory.diagnosisFields"),
    ...(typeof trajRaw.table === "string" ? { table: trajRaw.table } : {}),
    ...(typeof trajRaw.sessionField === "string" ? { sessionField: trajRaw.sessionField } : {}),
    ...(typeof trajRaw.glob === "string" ? { glob: trajRaw.glob } : {}),
  };

  const depRaw = raw.deploy;
  if (!isObject(depRaw)) {
    throw new InvalidGenericConfigError("invalid config: missing deploy");
  }
  const deploy: GenericAdapterConfig["deploy"] = {
    restartHint: asString(depRaw.restartHint, "deploy.restartHint"),
    ...(typeof depRaw.syncTarget === "string" ? { syncTarget: depRaw.syncTarget } : {}),
  };

  const llmRaw = raw.llm;
  if (!isObject(llmRaw) || llmRaw.passThrough !== true) {
    throw new InvalidGenericConfigError("invalid config: llm.passThrough must be true");
  }
  const llm = { passThrough: true as const };

  return { harnessId, verified, substrate, trajectory, deploy, llm };
}

/**
 * 从 YAML 文件加载 + schema 校验 GenericAdapterConfig。
 * schema 非法（缺 harnessId/substrate、format 非 4 选一等）→ throw InvalidGenericConfigError。
 */
export function loadGenericConfig(yamlPath: string): GenericAdapterConfig {
  const src = readFileSync(yamlPath, "utf8");
  const raw = parseYaml(src);
  return validateConfig(raw);
}
