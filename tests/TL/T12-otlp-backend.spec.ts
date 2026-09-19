// TL-T12: managed tracing backend 集成（Langfuse/LangSmith OTLP + 传播）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T12）的 Given/When/Then 全部场景：
//   1. injectMetadata → 每个 span attributes 含 langfuse.session.id/version/release
//   2. exportSpans → mock OTLP endpoint 接收成功
//   3. endpoint 不可达 → OtlpExportError + 本地 fallback 文件
//   4. 含 PII spans → PIILeakError（与 TL-T07 硬门一致，export 前再校验）
//   5. 缺 apiKey → MissingAuthError（backend 需 auth）
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOtlpBackend } from "@harness/telemetry";
import type { OtlpBackend, GenAiSpan } from "@harness/telemetry";
import {
  OtlpExportError,
  MissingAuthError,
  PIILeakError,
} from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造
//
// 说明：spec 给出 OtlpBackend 公共接口与 GenAiSpan 类型（来自 TL-T03），
// 但 fetch/transport 注入、fallback 落盘目录、PII 检测复用 TL-T07 的机制、
// backend 需 auth 判定均未在 spec 显式定义。此处按最小可工作假设（见文末
// ambiguities）：
//   - 工厂 createOtlpBackend(opts?: { fetchImpl?, fallbackDir? })；
//   - fetchImpl: (url, init) => Promise<{ ok: boolean; status: number }> 注入
//     OTLP HTTP 发送（生产用 @opentelemetry/exporter-trace-otlp-http）；
//   - fallback 落盘到 fallbackDir，文件存在即视为 fallback 生效。
// ---------------------------------------------------------------------------

function makeSpan(over: Record<string, unknown> = {}): GenAiSpan {
  return {
    name: "chat claude-sonnet-4.5",
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.system": "claude",
      "gen_ai.request.model": "claude-sonnet-4.5",
      "gen_ai.conversation.id": "conv-1",
      "gen_ai.agent.id": "A",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 50,
      "gen_ai.usage.cache_read_input_tokens": 0,
      "gen_ai.usage.cache_creation_input_tokens": 0,
      ...over,
    },
    traceId: "trace-1",
    spanId: "span-1",
  };
}

function makePiiSpan(): GenAiSpan {
  // 含未脱敏 PII 的 span（SSN 落 attribute）
  return makeSpan({
    "user.message": "my SSN is 123-45-6789",
  });
}

function countFiles(dir: string): number {
  try {
    return readdirSync(dir).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// TL-T12
// ---------------------------------------------------------------------------
describe("TL-T12", () => {
  let tmpDir: string;
  let fallbackDir: string;
  let endpoint: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-t12-"));
    fallbackDir = join(tmpDir, "fallback");
    endpoint = "https://otel.example.local/v1/traces";
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "injectMetadata: langfuse.session.id/version/release 落每个 span"
  //   Given OTel spans（TL-T03 产出）
  //   When  injectMetadata(spans, {sessionId, version, release})
  //   Then  每个 span attributes 含 langfuse.session.id/version/release
  // -------------------------------------------------------------------------
  it("injectMetadata: langfuse.session.id/version/release 落每个 span", () => {
    const backend = createOtlpBackend({ fallbackDir });
    backend.configure({
      backend: "langfuse",
      endpoint,
      apiKey: "lf-key",
    });
    const spans = [makeSpan(), makeSpan(), makeSpan()];
    const meta = {
      sessionId: "sess-1",
      version: "0.1.0",
      release: "rel-1",
    };
    const injected = backend.injectMetadata(spans, meta);

    expect(injected.length).toBe(spans.length);
    for (const s of injected) {
      const attrs = s.attributes as Record<string, unknown>;
      expect(attrs["langfuse.session.id"]).toBe("sess-1");
      expect(attrs["langfuse.version"]).toBe("0.1.0");
      expect(attrs["langfuse.release"]).toBe("rel-1");
    }
    // 原 spans 的 gen_ai.* attr 保留
    expect(
      (injected[0]!.attributes as Record<string, unknown>)[
        "gen_ai.operation.name"
      ],
    ).toBe("chat");
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "exportSpans: mock OTLP endpoint 接收成功"
  //   Given 配置 backend='langfuse' + endpoint
  //   When  exportSpans
  //   Then  spans 经 OTLP HTTP 发送到 Langfuse，返回成功
  // -------------------------------------------------------------------------
  it("exportSpans: mock OTLP endpoint 接收成功", async () => {
    let received = false;
    let receivedUrl = "";
    const backend = createOtlpBackend({
      fallbackDir,
      fetchImpl: async (url: string) => {
        received = true;
        receivedUrl = String(url);
        return { ok: true, status: 200 };
      },
    });
    backend.configure({
      backend: "langfuse",
      endpoint,
      apiKey: "lf-key",
    });

    const spans = [makeSpan()];
    await backend.exportSpans(spans);

    expect(received).toBe(true);
    expect(receivedUrl).toContain(endpoint);
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "endpoint 不可达 → OtlpExportError + 本地 fallback"
  //   Given endpoint 不可达
  //   When  exportSpans
  //   Then  重试 N 次后抛 OtlpExportError，不静默丢 span（落本地 fallback 文件）
  // -------------------------------------------------------------------------
  it("endpoint 不可达 → OtlpExportError + 本地 fallback", async () => {
    const before = countFiles(fallbackDir);
    const backend = createOtlpBackend({
      fallbackDir,
      fetchImpl: async () => {
        // 模拟不可达：始终 reject
        throw new Error("ECONNREFUSED");
      },
    });
    backend.configure({
      backend: "langfuse",
      endpoint,
      apiKey: "lf-key",
    });

    const spans = [makeSpan(), makeSpan()];
    await expect(backend.exportSpans(spans)).rejects.toThrowError(
      OtlpExportError,
    );

    // 不静默丢 span：落本地 fallback 文件
    const after = countFiles(fallbackDir);
    expect(after).toBeGreaterThan(before);
    // fallback 文件须存在
    expect(existsSync(fallbackDir)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "含 PII spans → PIILeakError"
  //   Given spans 含 PII（未脱敏）
  //   When  exportSpans
  //   Then  抛 PIILeakError（与 TL-T07 硬门一致，export 前再校验）
  // -------------------------------------------------------------------------
  it("含 PII spans → PIILeakError", async () => {
    const backend = createOtlpBackend({
      fallbackDir,
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });
    backend.configure({
      backend: "langfuse",
      endpoint,
      apiKey: "lf-key",
    });

    await expect(backend.exportSpans([makePiiSpan()])).rejects.toThrowError(
      PIILeakError,
    );
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "缺 apiKey → MissingAuthError"
  //   Given apiKey 缺失（backend 需 auth）
  //   When  configure
  //   Then  抛 MissingAuthError
  // -------------------------------------------------------------------------
  it("缺 apiKey → MissingAuthError", () => {
    const backend = createOtlpBackend({ fallbackDir });
    // langfuse 需 auth：缺 apiKey → 抛错
    expect(() =>
      backend.configure({
        backend: "langfuse",
        endpoint,
        // apiKey 故意缺失
      } as { backend: "langfuse"; endpoint: string }),
    ).toThrowError(MissingAuthError);

    // langsmith 同样需 auth
    expect(() =>
      backend.configure({
        backend: "langsmith",
        endpoint,
      } as { backend: "langsmith"; endpoint: string }),
    ).toThrowError(MissingAuthError);
  });
});
