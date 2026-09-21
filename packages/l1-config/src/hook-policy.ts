// L1-T12a · hook policy（PreToolUse 规则）基质 + breaker clause
//
// PreToolUse hook 规则集是高风险 config 基质（02-loop-context §1.5(b)；PRD §5.1）。
// 本模块加载 `hooks/policy.yaml`（matcher/if/decision/reason/fallback）并守两条
// 安全不变量：
//   1. breaker clause —— 任何把 bash/write/edit 类工具从 deny/ask 放宽到 allow 的
//      diff 自动 reject（02-loop-context §1.5(f)）。收紧方向（allow→deny/ask）放行。
//   2. silence≠approve —— exit 0 + 无 stdout 是 fall-through（继续下一条规则），
//      绝非 approve。自改写「silence=approve」= 模型给自己开权限门。
//
// hook 契约本体（JSON decision schema、matcher+if 两段过滤、exit-0-no-stdout
// fall-through 语义、hook 顺序）属 L0 static-core，本模块只消费。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigRepo } from "./repo-layout.js";
// 复用 L1-T02 已定义的 TelemetrySink 结构接口（ERRATA-w2plus L1 裁决：
// `TelemetrySink = { write(event): void }`）。用于非 forbidden 工具 deny→allow
// 的 audit 事件落盘（breaker 静默放行面补全）。
import type { TelemetrySink } from "./compaction-substrate.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/** 单条 PreToolUse hook 规则。 */
export interface HookRule {
  /** tool group 如 'Bash' / 'Write'。 */
  readonly matcher: string;
  /** 可选预过滤谓词（matcher 命中后再判）。 */
  readonly ifPredicate?: string;
  /** 决策：放行 / 拒绝 / 人审。 */
  readonly decision: "allow" | "deny" | "ask";
  /** 决策理由（落 audit log）。 */
  readonly reason: string;
  /** deny 后给模型的 fallback 文本。 */
  readonly fallback?: string;
}

/**
 * 禁止从 deny/ask 放宽到 allow 的工具类（小写规范化比较）。
 *
 * 这是 breaker 的 **不可变 baseline 种子**（bash/write/edit），与 L0C-T10
 * `DangerousDiffKind.deny_to_allow` 语义同源。breaker 只拦放宽方向，收紧
 * 方向放行。
 *
 * 运行时 forbidden 全集 = 本种子 ∪ 由 tool-registry `dangerous: true` 动态
 * 派生的工具集（经 `HookPolicyOptions.extraForbiddenTools` 注入）。这样新
 * 注册的执行类工具（registry 标 `dangerous`）自动进入 breaker 保护，无需
 * 改 frozen 字面量——闭合「forbidden 列表 frozen、新执行工具永不进入
 * breaker 保护」的结构性静默放行面。
 */
export const DENY_TO_ALLOW_FORBIDDEN = ["bash", "write", "edit"] as const;

/** breaker 拦截的 diff 形状。 */
export interface BreakerDiff {
  readonly tool: string;
  readonly from: string;
  readonly to: string;
}

/** hook policy 基质加载构造选项。 */
export interface HookPolicyOptions {
  /** 默认 ConfigRepo（load 未显式传 repo 时回退）。 */
  readonly repo?: ConfigRepo;
  /**
   * 额外 forbidden 工具集（小写归一），通常由 `dangerousToolNames(toolDocs)`
   * 从 tool-registry `dangerous: true` 动态派生。与 `DENY_TO_ALLOW_FORBIDDEN`
   * 种子取并集构成运行时 forbidden 全集，使新注册执行类工具自动进入
   * breaker 保护。
   */
  readonly extraForbiddenTools?: readonly string[];
  /**
   * 可选 telemetry sink：非 forbidden 工具的 deny/ask→allow 放宽虽不拦
   * （breaker 仅硬拦 forbidden），但须落 `breaker_nonforbidden_widen_audit`
   * 事件，闭合 breaker 静默放行面（与 L0C-T10 runtime breaker 的
   * security_event 留痕同源）。
   */
  readonly telemetry?: TelemetrySink;
}

// ── 错误类型（message 未钉死，测试用宽松 regex；ERRATA L1-11） ────────────

/** breaker 拦截：bash/write/edit 从 deny/ask 放宽到 allow。 */
export class BreakerDenyToAllowError extends Error {
  readonly diff: BreakerDiff;
  constructor(diff: BreakerDiff, message?: string) {
    super(
      message ??
        `breaker reject: tool '${diff.tool}' widened from '${diff.from}' to '${diff.to}' (deny/ask→allow forbidden)`,
    );
    this.name = "BreakerDenyToAllowError";
    this.diff = diff;
  }
}

/** silence≠approve 不变量违反：caller 把 fall-through 当 approve。 */
export class SilenceApproveViolation extends Error {
  constructor(message?: string) {
    super(message ?? "silence!=approve: exit 0 + no stdout is fall-through, not approve");
    this.name = "SilenceApproveViolation";
  }
}

// ── 极简 YAML 解析（仅 policy.yaml schema：top mapping + rules 序列 of mapping）
// 与 tool-registry.ts 同构，扩展支持「序列项为 mapping」（`- key: value` 后跟
// 同缩进续键）。无外部依赖。

interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

function tokenize(content: string): YamlLine[] {
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

function parseInline(value: string): unknown {
  const v = value.trim();
  if (v === "") return null;
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  if (v.startsWith("[") || v.startsWith("{")) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

/**
 * 递归解析一个块（mapping 或 sequence），返回 [value, nextIndex]。
 * 支持序列项为 mapping（`- key: value` + 同缩进续键）。
 */
function parseBlock(
  lines: YamlLine[],
  start: number,
  indent: number,
): [unknown, number] {
  const startLine = lines[start];
  if (!startLine || startLine.indent !== indent) {
    return [null, start];
  }
  // sequence
  if (startLine.text.startsWith("- ")) {
    const arr: unknown[] = [];
    let i = start;
    while (i < lines.length) {
      const cur = lines[i];
      if (!cur || cur.indent !== indent || !cur.text.startsWith("- ")) break;
      // 构造该项子块：首行把 "- " 替换为等宽空格，使内容虚拟缩进 = indent + 2
      const subLines: YamlLine[] = [];
      subLines.push({ indent: indent + 2, text: cur.text.slice(2) });
      i++;
      // 后续缩进 > indent 的行属于该项
      while (i < lines.length) {
        const nxt = lines[i]!;
        if (nxt.indent <= indent) break;
        subLines.push(nxt);
        i++;
      }
      const [item] = parseBlock(subLines, 0, indent + 2);
      arr.push(item);
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

function parsePolicyYaml(content: string): {
  rules?: unknown;
} {
  const lines = tokenize(content);
  if (lines.length === 0) return {};
  const first = lines[0]!;
  const [val] = parseBlock(lines, 0, first.indent);
  return (val as Record<string, unknown> | null) ?? {};
}

/**
 * 解析 policy.yaml 文本为有序 `HookRule[]`（parsePolicyYaml + buildRule）。
 *
 * 供 hook-evolution breaker precheck 对候选 patch 做 YAML 解析后逐规则 diff
 * 判方向（而非正则嗅探箭头文本）。
 *
 * @throws HookPolicyLoadError 缺失 `rules` 序列或任一规则校验失败时 throw
 */
export function parseHookRulesYaml(content: string): HookRule[] {
  const parsed = parsePolicyYaml(content);
  const rawRules = parsed.rules;
  if (!Array.isArray(rawRules)) {
    throw new HookPolicyLoadError(
      "parseHookRulesYaml: missing 'rules' sequence",
    );
  }
  return rawRules.map((r, idx) => buildRule(r, idx));
}

// ── HookRule 构建校验 ──────────────────────────────────────────────────────

const DECISIONS = new Set(["allow", "deny", "ask"]);

function toString(v: unknown): string {
  return v == null ? "" : String(v);
}

function buildRule(raw: unknown, idx: number): HookRule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HookPolicyLoadError(`rule #${idx}: expected mapping, got ${typeof raw}`);
  }
  const rec = raw as Record<string, unknown>;
  const matcher = toString(rec.matcher);
  if (matcher === "") {
    throw new HookPolicyLoadError(`rule #${idx}: missing 'matcher'`);
  }
  const decision = toString(rec.decision);
  if (!DECISIONS.has(decision)) {
    throw new HookPolicyLoadError(
      `rule #${idx}: invalid decision '${decision}' (expected allow|deny|ask)`,
    );
  }
  const reason = toString(rec.reason);
  const rule: {
    matcher: string;
    ifPredicate?: string;
    decision: HookRule["decision"];
    reason: string;
    fallback?: string;
  } = {
    matcher,
    decision: decision as HookRule["decision"],
    reason,
  };
  const ifPredicate = rec.ifPredicate;
  if (ifPredicate != null && toString(ifPredicate) !== "") {
    rule.ifPredicate = toString(ifPredicate);
  }
  const fallback = rec.fallback;
  if (fallback != null && toString(fallback) !== "") {
    rule.fallback = toString(fallback);
  }
  return Object.freeze(rule) as HookRule;
}

/** policy.yaml 解析/校验失败。 */
export class HookPolicyLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookPolicyLoadError";
  }
}

// ── HookPolicy ─────────────────────────────────────────────────────────────

/**
 * hook policy 基质加载器 + breaker clause + silence≠approve 守卫。
 *
 * - `load(repo)`：经 `ConfigRepo.loadActive()` 校验 sha 钉死，读 `hooks/policy.yaml`
 *   → 解析为有序冻结 `HookRule[]`。
 * - `assertBreaker(diff)`：bash/write/edit 从 deny/ask 放宽到 allow → throw
 *   `BreakerDenyToAllowError`；收紧方向放行。
 * - `assertSilenceNotApprove(exitCode, stdout, treatedAsApprove?)`：当 caller 把
 *   exit0+无 stdout 的 fall-through 当 approve（treatedAsApprove===true）→ throw
 *   `SilenceApproveViolation`。
 */
export class HookPolicy {
  private readonly repo: ConfigRepo | undefined;
  private readonly extraForbidden: ReadonlySet<string>;
  private readonly telemetry: TelemetrySink | undefined;

  constructor(opts: HookPolicyOptions = {}) {
    this.repo = opts.repo;
    this.extraForbidden = new Set(
      (opts.extraForbiddenTools ?? []).map((t) => t.toLowerCase()),
    );
    this.telemetry = opts.telemetry;
  }

  /**
   * 运行时 forbidden 全集（baseline 种子 ∪ 注入的 extraForbidden），小写归一。
   * 供 assertBreaker / hookBreakerPrecheck 共用判定。
   */
  forbiddenTools(): readonly string[] {
    const all = new Set<string>(DENY_TO_ALLOW_FORBIDDEN as readonly string[]);
    for (const t of this.extraForbidden) all.add(t);
    return [...all];
  }

  /** 工具名是否属运行时 forbidden 全集（小写归一比较）。 */
  isForbidden(tool: string): boolean {
    const t = tool.toLowerCase();
    return (
      (DENY_TO_ALLOW_FORBIDDEN as readonly string[]).includes(t) ||
      this.extraForbidden.has(t)
    );
  }

  /**
   * 加载 active hook policy 规则集。
   *
   * 经 `repo.loadActive()` 校验 sha 钉死（active 不被毒化），再读
   * `hooks/policy.yaml` 解析为有序 `HookRule[]`。规则顺序即匹配顺序
   * （hook 顺序 = static-core，本模块保留磁盘声明顺序）。
   */
  load(repo: ConfigRepo): readonly HookRule[] {
    const target = repo ?? this.repo;
    if (!target) {
      throw new HookPolicyLoadError("load: no ConfigRepo provided");
    }
    // sha 钉死校验（active 不被毒化）；ConfigSet 本身不暴露 hooks 内容，
    // 故校验通过后从 repo root 直读 hooks/policy.yaml。
    target.loadActive();
    const root = target.getRoot();
    const abs = join(root, "hooks/policy.yaml");
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch (e) {
      throw new HookPolicyLoadError(
        `load: cannot read hooks/policy.yaml at ${abs}: ${(e as Error).message}`,
      );
    }
    const parsed = parsePolicyYaml(content);
    const rawRules = parsed.rules;
    if (!Array.isArray(rawRules)) {
      throw new HookPolicyLoadError(
        "load: hooks/policy.yaml missing 'rules' sequence",
      );
    }
    const rules = rawRules.map((r, idx) => buildRule(r, idx));
    return Object.freeze(rules) as readonly HookRule[];
  }

  /**
   * silence≠approve 不变量（ERRATA L1-07 三参裁决）。
   *
   * exit 0 + 无 stdout = fall-through（继续下一条规则），绝非 approve。
   * 当 caller 把该 fall-through 当 approve（`treatedAsApprove === true`）→
   * throw `SilenceApproveViolation`。其它情况 no-op。
   */
  assertSilenceNotApprove(
    exitCode: number,
    stdout: string,
    treatedAsApprove?: boolean,
  ): void {
    if (treatedAsApprove === true && exitCode === 0 && stdout === "") {
      throw new SilenceApproveViolation();
    }
  }

  /**
   * breaker clause：forbidden 工具从 deny/ask 放宽到 allow → throw。
   *
   * 收紧方向（allow→deny/ask、ask→deny）放行。**非 forbidden 工具的
   * deny/ask→allow 放宽虽不硬拦**（breaker 仅硬拦 forbidden 执行类工具），
   * 但须落 `breaker_nonforbidden_widen_audit` 事件——闭合 breaker 静默放行面
   * （与 L0C-T10 runtime breaker 的 security_event 留痕同源）。telemetry 未
   * 接线时静默跳过（向后兼容）。
   *
   * 工具名比较大小写不敏感（与 forbidden 全集小写归一）。
   */
  assertBreaker(diff: BreakerDiff): void {
    const tool = String(diff.tool ?? "").toLowerCase();
    const from = String(diff.from ?? "").toLowerCase();
    const to = String(diff.to ?? "").toLowerCase();
    const forbidden = this.isForbidden(tool);
    if (!forbidden) {
      // 非 forbidden 工具：deny/ask→allow 放宽不硬拦，但须落 audit 事件
      // （闭合静默放行面）。非放宽方向（如 allow→deny 收紧）无需 audit。
      if (to === "allow" && (from === "deny" || from === "ask")) {
        this.telemetry?.write({
          event: "breaker_nonforbidden_widen_audit",
          tool: diff.tool,
          from: diff.from,
          to: diff.to,
          reason:
            "non-forbidden tool widened deny/ask→allow; breaker only hard-blocks forbidden tools (audit-only)",
        });
      }
      return;
    }
    if (to !== "allow") return; // 只拦放宽到 allow
    if (from === "deny" || from === "ask") {
      throw new BreakerDenyToAllowError({ tool: diff.tool, from: diff.from, to: diff.to });
    }
    // from === 'allow' → to 'allow' 非放宽，放行
  }
}
