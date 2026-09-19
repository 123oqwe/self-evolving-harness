// TL-T07: otel_capture_policy + PII redaction filter（PII>0 立即 reject 硬门）
//
// OTel 采集策略可 config：capture_message_events / message_sampling_rate /
// pii_redaction_rules。PII>0 立即 reject 硬门（PRD §11.4）。采集策略文件项目
// scope 不可覆写（research §1.3 (f)）。
//
// 流程：redact（regex 替换）→ assertNoPII（扫脱敏后 payload 仍有 PII pattern
// 才抛错，说明 redaction 规则漏了）。emit 按 config + 采样率决定是否落
// structured event。
//
// 自研极简 YAML 解析（不引入 js-yaml 依赖）：仅支持本 config 的结构
// （flat key: value + pii_redaction_rules 嵌套 list）。Span/Context 来自 TL-T03
// （import type 仅类型擦除）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// ProjectScopeOverrideRejectedError 为 TL 模块跨任务共享错误（T05/T06/T07 均
// 需抛出）。从 T06 budget-policy 导入单一定义，避免 index barrel 重复导出
// （TS2308 / 运行时 instanceof 失效）。
import { ProjectScopeOverrideRejectedError } from "./budget-policy";

// ---------------------------------------------------------------------------
// 默认 config 路径（bundled config 层，git-versioned，agent 运行时只读）
// ---------------------------------------------------------------------------
const DEFAULT_CAPTURE_POLICY_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "otel_capture_policy.yaml",
);

// ---------------------------------------------------------------------------
// 类型（static-core 接口契约，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

/** 单条 PII 脱敏规则（regex pattern + replacement token）。 */
export interface RedactionRule {
  name: string;
  pattern: string; // 正则源串
  replacement: string; // 如 [REDACTED_SSN]
}

export interface CaptureConfig {
  capture_message_events: boolean;
  message_sampling_rate: number; // 0-1
  pii_redaction_rules: RedactionRule[];
}

/**
 * emit 所需的最小 span 结构：调用 span.addEvent(name, attributes) 落
 * structured event。Span 的权威定义在 TL-T03 otel-emitter.ts（已由其导出
 * `Span`，本文件不重复导出以免 index barrel 名称冲突）。此处用结构兼容的
 * 本地最小接口，仅声明可选 addEvent；otel-emitter 的 Span 无 addEvent 字段
 * 亦可赋值（可选属性缺席即满足），FakeSpan 等带 addEvent 的实现 likewise。
 */
interface CaptureSpan {
  addEvent?(name: string, attributes?: unknown): void;
}

export interface CapturePolicy {
  load(): CaptureConfig;
  emit(span: CaptureSpan, messages: unknown[]): void; // 按 config 决定落 event 与否
  redact(messages: unknown[]): unknown[]; // PII 脱敏
  assertNoPII(payload: unknown): void; // PII>0 → throw（硬门）
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** payload 含未脱敏 PII（assertNoPII 仍命中 PII pattern）→ 抛此错（硬门）。 */
export class PIILeakError extends Error {
  constructor(message = "PIILeakError: unredacted PII detected in payload (PII>0 hard reject)") {
    super(message);
    this.name = "PIILeakError";
  }
}

// ProjectScopeOverrideRejectedError 见文件顶部 import（来自 ./budget-policy，
// 跨任务共享，不在本文件重复定义亦不 re-export，避免 index barrel 重复导出）。

// ---------------------------------------------------------------------------
// 极简 YAML 解析（otel_capture_policy.yaml 结构）
//
// 支持：
//   - 顶层 flat `key: value`（bool/number/quoted-string）
//   - `pii_redaction_rules:` 下嵌套 list：
//       - name: ssn
//         pattern: '\d{3}-\d{2}-\d{4}'
//         replacement: '[REDACTED_SSN]'
//   - `#` 注释行、空行
// 不支持通用 YAML（锚点/多行字符串/flow 等）——本 config 不需要。
// ---------------------------------------------------------------------------

function parseScalarValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return "";
  // 单引号字符串（YAML 单引号：反斜杠字面，'' → '）
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  // 双引号字符串（按 JSON 解析转义）
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  // bool
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  // number
  const n = Number(v);
  if (v !== "" && Number.isFinite(n)) return n;
  // raw
  return v;
}

interface YamlLine {
  indent: number;
  text: string; // 去缩进后
  raw: string;
}

function lexLines(content: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    // 跳过纯注释行（行首 # 或空白+#）。pattern 值内不含行首 #。
    const trimmedForComment = rawLine.trimStart();
    if (trimmedForComment.startsWith("#")) continue;
    if (trimmedForComment === "") continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    out.push({ indent, text: rawLine.trim(), raw: rawLine });
  }
  return out;
}

function parseCaptureYaml(content: string): CaptureConfig {
  const cfg: CaptureConfig = {
    capture_message_events: true,
    message_sampling_rate: 1.0,
    pii_redaction_rules: [],
  };

  const lines = lexLines(content);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent === 0) {
      const idx = line.text.indexOf(":");
      if (idx === -1) {
        i++;
        continue;
      }
      const key = line.text.slice(0, idx).trim();
      const valRaw = line.text.slice(idx + 1).trim();
      if (valRaw === "") {
        // 块开始：仅处理 pii_redaction_rules
        if (key === "pii_redaction_rules") {
          i++;
          // 收集后续缩进 > 0 的行直到回到 indent 0
          const rules: RedactionRule[] = [];
          let current: Partial<RedactionRule> | null = null;
          while (i < lines.length && lines[i]!.indent > 0) {
            const sub = lines[i]!;
            const subText = sub.text;
            if (subText.startsWith("- ")) {
              // 新 list item
              if (current && current.name && current.pattern && current.replacement) {
                rules.push(current as RedactionRule);
              }
              current = {};
              const rest = subText.slice(2).trim();
              if (rest !== "") {
                applyRuleField(current, rest);
              }
            } else if (subText.startsWith("-") && subText.length > 1) {
              // "-name:..." 兼容
              if (current && current.name && current.pattern && current.replacement) {
                rules.push(current as RedactionRule);
              }
              current = {};
              const rest = subText.slice(1).trim();
              if (rest !== "") {
                applyRuleField(current, rest);
              }
            } else {
              // 当前 item 的字段
              if (current !== null) {
                applyRuleField(current, subText);
              }
            }
            i++;
          }
          // 收尾最后一个 item
          if (current && current.name && current.pattern && current.replacement) {
            rules.push(current as RedactionRule);
          }
          cfg.pii_redaction_rules = rules;
          continue; // i 已在循环内推进
        } else {
          // 其它块开始（未知），跳过子块
          i++;
          while (i < lines.length && lines[i]!.indent > 0) i++;
          continue;
        }
      } else {
        // flat scalar
        const val = parseScalarValue(valRaw);
        applyTopField(cfg, key, val);
        i++;
        continue;
      }
    } else {
      // 顶层缩进非 0 的孤立行：忽略
      i++;
      continue;
    }
  }

  return cfg;
}

function applyTopField(cfg: CaptureConfig, key: string, val: unknown): void {
  switch (key) {
    case "capture_message_events":
      cfg.capture_message_events = val === true;
      break;
    case "message_sampling_rate":
      cfg.message_sampling_rate =
        typeof val === "number" && Number.isFinite(val) ? val : 1.0;
      break;
    default:
      // 未知字段忽略（向前兼容）
      break;
  }
}

function applyRuleField(
  rule: Partial<RedactionRule>,
  fieldText: string,
): void {
  const idx = fieldText.indexOf(":");
  if (idx === -1) return;
  const key = fieldText.slice(0, idx).trim();
  const valRaw = fieldText.slice(idx + 1).trim();
  const val = parseScalarValue(valRaw);
  switch (key) {
    case "name":
      rule.name = typeof val === "string" ? val : String(val);
      break;
    case "pattern":
      rule.pattern = typeof val === "string" ? val : String(val);
      break;
    case "replacement":
      rule.replacement = typeof val === "string" ? val : String(val);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// PII 脱敏 / 检测
// ---------------------------------------------------------------------------

/** 编译规则为 RegExp（全局、非贪婪匹配整个 pattern）。 */
function compileRules(rules: RedactionRule[]): Array<{ rule: RedactionRule; re: RegExp }> {
  return rules.map((r) => ({
    rule: r,
    re: new RegExp(r.pattern, "g"),
  }));
}

/** 深度遍历 payload，对所有 string 应用 fn，返回结构等价的新值。 */
function walkStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") {
    return fn(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => walkStrings(v, fn)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walkStrings(v, fn);
    }
    return out as unknown as T;
  }
  return value;
}

/** 收集 payload 中所有字符串（深度遍历）。 */
function collectStrings(value: unknown): string[] {
  const out: string[] = [];
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) out.push(...collectStrings(v));
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      out.push(...collectStrings(v));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 确定性 PRNG（mulberry32）——同 seed → 同序列，可测采样
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

export interface CreateCapturePolicyOpts {
  configPath?: string;
  projectScopePath?: string;
  seed?: number; // 确定性 PRNG seed（可测采样）
}

export function createCapturePolicy(
  opts: CreateCapturePolicyOpts = {},
): CapturePolicy {
  const configPath = opts.configPath ?? DEFAULT_CAPTURE_POLICY_PATH;
  const projectScopePath = opts.projectScopePath;
  // seed 默认 1（确定性，避免 Math.random）。每实例独立 PRNG 状态。
  const rng = mulberry32(opts.seed ?? 1);

  let cachedCfg: CaptureConfig | null = null;

  function loadConfig(): CaptureConfig {
    if (cachedCfg) return cachedCfg;
    const content = readFileSync(configPath, "utf8");
    cachedCfg = parseCaptureYaml(content);
    return cachedCfg;
  }

  return {
    load(): CaptureConfig {
      // 项目 scope 覆写 → 硬拒（不 merge with warning）
      if (projectScopePath !== undefined) {
        throw new ProjectScopeOverrideRejectedError();
      }
      return loadConfig();
    },

    emit(span: CaptureSpan, messages: unknown[]): void {
      const cfg = loadConfig();
      if (!cfg.capture_message_events) return; // 不落 event（省存储）
      // 采样：rate=1.0 全采；rate<1.0 按 PRNG 决定
      const rate = cfg.message_sampling_rate;
      if (rate < 1) {
        const r = rng();
        if (r >= rate) return; // 本次不采
      }
      // 落 structured event：messages 作 event attributes
      const addEvent = span.addEvent;
      if (typeof addEvent === "function") {
        addEvent.call(span, "gen_ai.message", messages);
      }
    },

    redact(messages: unknown[]): unknown[] {
      const cfg = loadConfig();
      const compiled = compileRules(cfg.pii_redaction_rules);
      return messages.map((msg) =>
        walkStrings(msg, (s) => {
          let out = s;
          for (const { rule } of compiled) {
            // 每条规则独立 regex 实例（global），逐条替换
            const re = new RegExp(rule.pattern, "g");
            out = out.replace(re, rule.replacement);
          }
          return out;
        }),
      );
    },

    assertNoPII(payload: unknown): void {
      const cfg = loadConfig();
      const compiled = compileRules(cfg.pii_redaction_rules);
      const strings = collectStrings(payload);
      for (const s of strings) {
        for (const { rule } of compiled) {
          const re = new RegExp(rule.pattern);
          if (re.test(s)) {
            throw new PIILeakError();
          }
        }
      }
    },
  };
}
