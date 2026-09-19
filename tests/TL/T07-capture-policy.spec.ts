// TL-T07: otel_capture_policy + PII redaction filter（PII>0 立即 reject 硬门）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T07）的 Given/When/Then 全部场景：
//   1. capture_message_events=true → emit 落 structured event
//   2. capture_message_events=false → 不落 event（省存储）
//   3. redact: SSN → [REDACTED_SSN]
//   4. redact: API key sk-xxx → [REDACTED_API_KEY]
//   5. assertNoPII: 未脱敏 PII → PIILeakError（硬门）
//   6. project scope 覆写 → ProjectScopeOverrideRejectedError
//   7. message_sampling_rate=0.5 → 100 次 emit 落 event 数 ≈ 50（确定性 seed 可测）
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCapturePolicy } from "@harness/telemetry";
import type {
  CapturePolicy,
  CaptureConfig,
  RedactionRule,
  Span,
} from "@harness/telemetry";
import {
  PIILeakError,
  ProjectScopeOverrideRejectedError,
} from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造
//
// 说明：spec 给出 CapturePolicy/CaptureConfig 公共接口与 RedactionRule 类型占位，
// 但 RedactionRule 字段形状、工厂签名、Span 如何接收 event、采样 seed 注入、
// project scope 覆写如何传入均未在 spec 显式定义。此处按最小可工作假设（见文末
// ambiguities）：
//   - 工厂 createCapturePolicy(opts?: { configPath?, projectScopePath?, seed? })；
//   - Span 假设暴露 addEvent(name, attributes)（与 OTel span.addEvent 一致）；
//   - redact(messages: unknown[]) 接受字符串/对象消息数组，返回脱敏后数组；
//   - 采样用注入 seed 的确定性 PRNG，使 0.5 采样率可测。
// ---------------------------------------------------------------------------

function defaultYaml(over: Record<string, unknown> = {}): string {
  return [
    "capture_message_events: true",
    "message_sampling_rate: 1.0",
    "pii_redaction_rules:",
    "  - name: ssn",
    '    pattern: \'\\d{3}-\\d{2}-\\d{4}\'',
    "    replacement: '[REDACTED_SSN]'",
    "  - name: api_key",
    '    pattern: \'sk-[A-Za-z0-9]+\'',
    "    replacement: '[REDACTED_API_KEY]'",
  ].join("\n") + "\n" + Object.entries(over).map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`).join("\n");
}

/** FakeSpan：记录 addEvent 调用，用于断言 emit 是否落 event。 */
class FakeSpan {
  events: Array<{ name: string; attributes?: unknown }> = [];
  spanId = "fake-span-id";
  addEvent(name: string, attributes?: unknown): void {
    this.events.push({ name, attributes });
  }
}

// ---------------------------------------------------------------------------
// TL-T07
// ---------------------------------------------------------------------------
describe("TL-T07", () => {
  let tmpDir: string;
  let configPath: string;
  let projectScopePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-t07-"));
    configPath = join(tmpDir, "otel_capture_policy.yaml");
    projectScopePath = join(tmpDir, "project-otel_capture_policy.yaml");
    writeFileSync(configPath, defaultYaml(), "utf8");
    writeFileSync(
      projectScopePath,
      defaultYaml({ capture_message_events: false }),
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "capture_message_events=true 落 event"
  //   Given capture_message_events=true
  //   When  emit(span, messages)
  //   Then  messages 作 structured event 落 span
  // -------------------------------------------------------------------------
  it("capture_message_events=true 落 event", () => {
    const policy = createCapturePolicy({ configPath });
    const cfg = policy.load();
    expect(cfg.capture_message_events).toBe(true);

    const span = new FakeSpan();
    const messages = [{ role: "user", content: "hello" }];
    policy.emit(span as unknown as Span, messages);

    expect(span.events.length).toBe(1);
    expect(span.events[0]!.attributes).toBe(messages);
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "capture_message_events=false 不落 event"
  //   Given capture_message_events=false
  //   When  emit
  //   Then  不落 event（省存储）
  // -------------------------------------------------------------------------
  it("capture_message_events=false 不落 event", () => {
    const offYaml = join(tmpDir, "off.yaml");
    writeFileSync(offYaml, defaultYaml({ capture_message_events: false }), "utf8");
    const policy = createCapturePolicy({ configPath: offYaml });
    const cfg = policy.load();
    expect(cfg.capture_message_events).toBe(false);

    const span = new FakeSpan();
    policy.emit(span as unknown as Span, [{ role: "user", content: "hi" }]);
    expect(span.events.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "redact: SSN → [REDACTED_SSN]"
  //   Given message 含 'my SSN is 123-45-6789'
  //   When  redact
  //   Then  返回 'my SSN is [REDACTED_SSN]'
  // -------------------------------------------------------------------------
  it("redact: SSN → [REDACTED_SSN]", () => {
    const policy = createCapturePolicy({ configPath });
    const out = policy.redact(["my SSN is 123-45-6789"]);
    expect(out.length).toBe(1);
    expect(out[0]).toBe("my SSN is [REDACTED_SSN]");
    // 原始 SSN 不得残留
    expect(JSON.stringify(out)).not.toContain("123-45-6789");
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "redact: API key sk-xxx → [REDACTED_API_KEY]"
  //   Given message 含 'sk-abc123secret' 开头 API key
  //   When  redact
  //   Then  返回 '[REDACTED_API_KEY]'
  // -------------------------------------------------------------------------
  it("redact: API key sk-xxx → [REDACTED_API_KEY]", () => {
    const policy = createCapturePolicy({ configPath });
    const out = policy.redact(["token=sk-abcdEFG1234567890"]);
    expect(out[0]).toBe("token=[REDACTED_API_KEY]");
    expect(JSON.stringify(out)).not.toContain("sk-abcdEFG1234567890");
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "assertNoPII: 未脱敏 PII → PIILeakError"
  //   Given payload 含未脱敏 PII（assertNoPII 前未 redact）
  //   When  assertNoPII
  //   Then  抛 PIILeakError（硬门，PII>0 立即 reject）
  // -------------------------------------------------------------------------
  it("assertNoPII: 未脱敏 PII → PIILeakError", () => {
    const policy = createCapturePolicy({ configPath });
    const leaky = [{ content: "my SSN is 123-45-6789" }];
    expect(() => policy.assertNoPII(leaky)).toThrowError(PIILeakError);

    // redact 后再 assertNoPII 须通过（脱敏规则未漏）
    const redacted = policy.redact(leaky);
    expect(() => policy.assertNoPII(redacted)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // 场景 6 + RED 名: "project scope 覆写 → reject"
  //   Given project scope 覆写 otel_capture_policy.yaml 关闭 PII 脱敏
  //   When  load
  //   Then  抛 ProjectScopeOverrideRejectedError（项目 scope 不可覆写）
  // -------------------------------------------------------------------------
  it("project scope 覆写 → reject", () => {
    const policy = createCapturePolicy({
      configPath,
      projectScopePath,
    });
    expect(() => policy.load()).toThrowError(
      ProjectScopeOverrideRejectedError,
    );
  });

  // -------------------------------------------------------------------------
  // 场景 7 + RED 名: "message_sampling_rate=0.5 采样落 event 数 ≈ 50"
  //   Given message_sampling_rate=0.5
  //   When  100 次 emit
  //   Then  落 event 数 ≈ 50（±容差，确定性 seed 可测）
  // -------------------------------------------------------------------------
  it("message_sampling_rate=0.5 采样落 event 数 ≈ 50", () => {
    const halfYaml = join(tmpDir, "half.yaml");
    writeFileSync(
      halfYaml,
      defaultYaml({ message_sampling_rate: 0.5 }),
      "utf8",
    );
    // 同 seed 须产生同一采样序列（确定性 seed 可测）：两个独立 policy 实例
    // 同 seed → 落 event 数须严格相等，防止 impl 用 Math.random() 忽略 seed
    // 而靠宽松容差蒙混过关。
    const policyA = createCapturePolicy({ configPath: halfYaml, seed: 42 });
    const policyB = createCapturePolicy({ configPath: halfYaml, seed: 42 });
    const cfg = policyA.load();
    expect(cfg.message_sampling_rate).toBe(0.5);

    const spanA = new FakeSpan();
    const spanB = new FakeSpan();
    for (let i = 0; i < 100; i++) {
      policyA.emit(spanA as unknown as Span, [{ i }]);
      policyB.emit(spanB as unknown as Span, [{ i }]);
    }
    // 采样随机但确定性 seed 可测：落 event 数应在 50 附近（±容差，非 0/100）
    expect(spanA.events.length).toBeGreaterThan(20);
    expect(spanA.events.length).toBeLessThan(80);
    // 不是全采（rate=0.5 不应 100 全落）也不是全不采
    expect(spanA.events.length).not.toBe(100);
    expect(spanA.events.length).not.toBe(0);
    // 确定性：同 seed 两个实例落 event 数须严格相等
    expect(spanB.events.length).toBe(spanA.events.length);
  });
});
