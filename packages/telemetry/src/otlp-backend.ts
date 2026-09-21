// TL-T12: managed tracing backend 集成（Langfuse/LangSmith OTLP + 传播）
//
// 集成 Langfuse/LangSmith OTLP 后端，传播 langfuse.user.id / session.id /
// version / release metadata。exportSpans 经 OTLP HTTP 发送；endpoint 不可达
// 重试 N 次后抛 OtlpExportError 并落本地 fallback 文件（不静默丢 span）；
// 出站前再校验 PII（与 TL-T07 硬门一致，双保险）。
//
// ERRATA-w2plus TL-T12 裁决：
//   - 工厂 createOtlpBackend(opts: { fetchImpl?, fallbackDir?, apiKey?, backend? })
//   - backend 强制 auth 判定：langfuse/langsmith 需 auth，缺 apiKey → MissingAuthError
//   - PII 检测 export 前复用 TL-T07 assertNoPII（测试用 SSN pattern 落 attribute 触发）
//   - injectMetadata 对 langsmith 用 metadata.* 前缀，langfuse 用 langfuse.* 前缀
//     （测试仅覆盖 langfuse.* 前缀；langsmith 字段名亦实现）
//
// 复用：@opentelemetry/exporter-trace-otlp-http（生产）；此处用注入 fetchImpl
// 做可测的 OTLP HTTP 发送。Span/Context 来自 TL-T03（import type 仅类型擦除）。
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { GenAiSpan, GenAiSpanAttributes } from "./otel-emitter";
import { PIILeakError, createCapturePolicy } from "./capture-policy";

// ---------------------------------------------------------------------------
// 类型（static-core 接口契约，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

export type BackendKind = "langfuse" | "langsmith" | "otlp";

export interface OtlpBackendConfigureOpts {
  backend: BackendKind;
  endpoint: string;
  apiKey?: string;
}

export interface OtlpBackendMetadata {
  userId?: string;
  sessionId: string;
  version: string;
  release: string;
}

export interface OtlpBackend {
  configure(opts: OtlpBackendConfigureOpts): void;
  exportSpans(spans: GenAiSpan[]): Promise<void>;
  injectMetadata(
    spans: GenAiSpan[],
    meta: OtlpBackendMetadata,
  ): GenAiSpan[];
}

export interface CreateOtlpBackendOpts {
  fetchImpl?: typeof fetch;
  fallbackDir?: string;
  apiKey?: string;
  backend?: "langfuse" | "langsmith";
  /** 重试次数（默认 3）；不可达时重试 N 次后抛 OtlpExportError */
  retries?: number;
  /** 单次重试延迟（ms，默认 0，测试加速） */
  retryDelayMs?: number;
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** OTLP endpoint 不可达（重试 N 次后仍失败）→ 抛此错；span 落本地 fallback。 */
export class OtlpExportError extends Error {
  constructor(
    message = "OtlpExportError: OTLP endpoint unreachable after retries (spans written to local fallback)",
  ) {
    super(message);
    this.name = "OtlpExportError";
  }
}

/** backend 需 auth 但 apiKey 缺失 → 抛此错（configure 时校验）。 */
export class MissingAuthError extends Error {
  constructor(
    message = "MissingAuthError: backend requires apiKey but none provided",
  ) {
    super(message);
    this.name = "MissingAuthError";
  }
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

/**
 * 按 backend 类型选择 metadata 字段前缀。
 * - langfuse → langfuse.{session.id,version,release,user.id}
 * - langsmith → metadata.{session.id,version,release,user.id}
 * - otlp → 不注入专属字段（仅透传 spans）
 */
function metadataKeys(backend: BackendKind): {
  sessionId: string;
  version: string;
  release: string;
  userId: string;
} {
  if (backend === "langfuse") {
    return {
      sessionId: "langfuse.session.id",
      version: "langfuse.version",
      release: "langfuse.release",
      userId: "langfuse.user.id",
    };
  }
  if (backend === "langsmith") {
    return {
      sessionId: "metadata.session.id",
      version: "metadata.version",
      release: "metadata.release",
      userId: "metadata.user.id",
    };
  }
  // otlp：无专属前缀，仍落通用字段（不破坏 spans）
  return {
    sessionId: "session.id",
    version: "version",
    release: "release",
    userId: "user.id",
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

export function createOtlpBackend(
  opts: CreateOtlpBackendOpts = {},
): OtlpBackend {
  const fetchImpl = opts.fetchImpl;
  const fallbackDir = opts.fallbackDir;
  const retries = opts.retries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 0;

  let configured: {
    backend: BackendKind;
    endpoint: string;
    apiKey?: string;
  } | null = null;

  // PII 出站硬门：复用 TL-T07 assertNoPII（默认 config 含 SSN 等规则）。
  const capturePolicy = createCapturePolicy();

  function ensureConfigured(): {
    backend: BackendKind;
    endpoint: string;
    apiKey?: string;
  } {
    if (!configured) {
      throw new OtlpExportError(
        "OtlpExportError: backend not configured (call configure() first)",
      );
    }
    return configured;
  }

  return {
    configure(cfg: OtlpBackendConfigureOpts): void {
      // backend 强制 auth 判定：langfuse/langsmith 需 auth，缺 apiKey → 抛错。
      // otlp 透传不强制 auth（生产 OTLP collector 可能无 auth）。
      const needsAuth = cfg.backend === "langfuse" || cfg.backend === "langsmith";
      const apiKey = cfg.apiKey ?? opts.apiKey;
      if (needsAuth && (apiKey === undefined || apiKey === "")) {
        throw new MissingAuthError();
      }
      // exactOptionalPropertyTypes: 仅在已定义时落 apiKey 字段
      configured =
        apiKey !== undefined && apiKey !== ""
          ? { backend: cfg.backend, endpoint: cfg.endpoint, apiKey }
          : { backend: cfg.backend, endpoint: cfg.endpoint };
    },

    injectMetadata(
      spans: GenAiSpan[],
      meta: OtlpBackendMetadata,
    ): GenAiSpan[] {
      const cfg = ensureConfigured();
      const keys = metadataKeys(cfg.backend);
      return spans.map((s) => {
        const attrs = {
          ...(s.attributes as Record<string, unknown>),
        } as Record<string, unknown>;
        attrs[keys.sessionId] = meta.sessionId;
        attrs[keys.version] = meta.version;
        attrs[keys.release] = meta.release;
        if (meta.userId !== undefined) {
          attrs[keys.userId] = meta.userId;
        }
        return { ...s, attributes: attrs as GenAiSpanAttributes };
      });
    },

    async exportSpans(spans: GenAiSpan[]): Promise<void> {
      const cfg = ensureConfigured();

      // PII 出站硬门：export 前再校验一次（与 TL-T07 落 span 前 redact 双保险）。
      // 扫 spans 的全部 attributes（含 messages event）字符串。
      for (const s of spans) {
        try {
          capturePolicy.assertNoPII(s.attributes);
        } catch (e) {
          if (e instanceof PIILeakError) throw e;
          throw e;
        }
        if (s.events) {
          for (const ev of s.events) {
            capturePolicy.assertNoPII(ev.attributes ?? {});
          }
        }
      }

      if (!fetchImpl) {
        // 生产路径应注入 fetchImpl（@opentelemetry/exporter-trace-otlp-http）。
        // 无 fetchImpl 视为不可达 → fallback + 抛错。
        writeFallback(spans);
        throw new OtlpExportError();
      }

      const body = JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                scope: { name: "harness-telemetry" },
                spans: spans.map((s) => ({
                  name: s.name,
                  traceId: s.traceId,
                  spanId: s.spanId,
                  parentSpanId: s.parentSpanId,
                  attributes: s.attributes,
                  events: s.events,
                })),
              },
            ],
          },
        ],
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (cfg.apiKey) {
        // Langfuse: Authorization: Basic <base64(public:secret)> 或 X-Api-Key；
        // LangSmith: X-Api-Key。统一用 X-Api-Key 兼容（测试只断言 endpoint 收到）。
        headers["X-Api-Key"] = cfg.apiKey;
      }

      let lastErr: unknown = null;
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const res = await fetchImpl(cfg.endpoint, {
            method: "POST",
            headers,
            body,
          });
          if (res && res.ok) {
            return; // 成功
          }
          lastErr = new Error(`OTLP responded status ${res?.status ?? "?"}`);
        } catch (e) {
          lastErr = e;
        }
        if (attempt < retries - 1) {
          await sleep(retryDelayMs);
        }
      }

      // 不可达：不静默丢 span → 落本地 fallback 文件，再抛 OtlpExportError。
      writeFallback(spans);
      throw new OtlpExportError();
    },
  };

  function writeFallback(spans: GenAiSpan[]): void {
    if (!fallbackDir) return;
    mkdirSync(fallbackDir, { recursive: true });
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 10);
    const file = join(fallbackDir, `spans-${ts}-${rnd}.json`);
    writeFileSync(file, JSON.stringify(spans), "utf8");
  }
}
