// L1-T03 · system phase prompt 基质加载 + warm-up 后稳态 cache-hit 度量
//
// phase prompt 是 MVP 第二个基质（PRD §8.1 交付物 #6；02-loop-context §2.1）。
// static 段（identity/safety）置首保 cache 稳定前缀（PRD §6.8）。
// 签名校验在 load 内部、ConfigSet swap 之前——签名失败绝不返回半加载快照
// （与 T01 原子性一致）。
// cache-hit 度量须 warm-up 后稳态度量：变异后首个 session 为 warm-up 不计入
// 稳态 Pareto（PRD §6.8），由本任务的 `collectCacheHit` 标 `phase` 字段区分。

import type { ConfigRepo } from "./repo-layout.js";
import type { Substrate } from "./substrate-types.js";
import type { SignatureVerifier } from "./signature.js";
import type { CacheHitSignal } from "./phase-types.js";
import type { TelemetrySink, SessionLogger } from "./compaction-substrate.js";

/** 默认 session logger：降级到 stderr，绝不抛错（与 compaction 降级语义一致）。 */
const defaultSessionLogger: SessionLogger = {
  warn(event) {
    try {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(event));
    } catch {
      /* swallow — session log 降级失败也不能阻塞 agent */
    }
  },
};

// ── phase 路径（相对 repo root，posix） ────────────────────────────────────

const PHASE_PATHS: Readonly<Record<"init" | "coding" | "review", string>> = {
  init: "prompts/phase-init.md",
  coding: "prompts/phase-coding.md",
  review: "prompts/phase-review.md",
};

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * 签名清单（L0 static-core）不存在时抛出。
 * load 入口签名校验前置：无清单 → 拒绝 load。
 */
export class MissingSignatureManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingSignatureManifestError";
  }
}

// ── PhaseSubstrate ─────────────────────────────────────────────────────────

/** telemetry 事件 type 标识。 */
const CACHE_HIT_EVENT_TYPE = "phase_cache_hit_signal";
/** telemetry 写失败时的降级事件标识。 */
const CACHE_HIT_WRITE_FAILED_EVENT = "cache_hit_signal_write_failed";

/**
 * system phase prompt 基质加载器 + warm-up 后稳态 cache-hit 度量器。
 *
 * - `load(repo, verifier)`：先校验三 phase 文件 safety 段签名 → 再经
 *   `ConfigRepo.loadActive()` 取 active 快照 → 返回三 phase substrate。
 *   签名失败（含 manifest 缺失/段缺失/sha 失配）→ throw，绝不返回半加载快照。
 * - `collectCacheHit(signal)`：写 telemetry JSONL 事件，warmUp 信号标
 *   `phase:'warm_up'`、稳态信号标 `phase:'steady'`；写失败降级 session log，
 *   不阻塞 agent。
 */
export class PhaseSubstrate {
  private readonly telemetry: TelemetrySink;
  private readonly sessionLog: SessionLogger;

  constructor(opts: { telemetry: TelemetrySink; sessionLog?: SessionLogger }) {
    this.telemetry = opts.telemetry;
    this.sessionLog = opts.sessionLog ?? defaultSessionLogger;
  }

  /**
   * 加载三 phase substrate（init/coding/review）。
   *
   * 硬保证（T03 执行提示(1) + §0.4 契约不变量）：签名校验必须在
   * `ConfigSet` swap 之前，签名失败绝不 swap。本方法把 `verifier` 接线进
   * `repo`（`setSegmentVerifier`），随后调 `repo.loadActive()`——
   * `loadActive` 内部先校验文件 sha256，再校验 safety 段签名，**全部通过才
   * swap active**；任一失配 → throw，active 保持旧快照不被毒化。
   *
   * 这同时保护直接消费 `repo.loadActive()` 的调用方（compaction/agent 运行时）：
   * 只要 repo 被接线（本方法或构造期接线），签名第二层即对全部 load 路径生效。
   *
   * 威胁场景（fail-closed）：攻击者绕过 pre-commit、篡改 phase-coding 的
   * `<safety>` 段、同步更新可写的 `repo.lock.json` 文件 sha256 匹配——
   * sha 钉死（T01）放过，但只读的 L0 static-core 签名清单不放过的 safety 段 sha，
   * `loadActive` 在 swap 前抛 `SignatureTamperError`，active 不被毒化。
   */
  load(
    repo: ConfigRepo,
    verifier: SignatureVerifier,
  ): Record<"init" | "coding" | "review", Substrate> {
    // 签名清单（L0 static-core）不存在 → 拒绝 load
    if (!verifier) {
      throw new MissingSignatureManifestError(
        "signature manifest (L0 static-core) is absent; refuse to load phase substrate",
      );
    }

    // 接线第二层守卫到 repo：使 loadActive 在 swap 前校验 safety 段签名。
    // 失配 → loadActive 抛 `SignatureTamperError`/`ShaMismatchError`，不 swap。
    repo.setSegmentVerifier(verifier);

    // loadActive 内部：verifyFiles (sha) → verifySignatures (safety sha) → swap。
    // 任一失配即 throw，active 保持上一个成功快照（原子，绝不半加载）。
    const cs = repo.loadActive();

    // 构造三 substrate（内容已由 loadActive 在 swap 前校验通过）
    const build = (key: "init" | "coding" | "review"): Substrate => {
      const content = cs.phasePrompts[key];
      if (content === undefined) {
        // phase 文件缺 → 视作篡改（与 T01 一致：缺文件不静默返回空）
        throw new MissingSignatureManifestError(
          `phase file missing: ${PHASE_PATHS[key]}`,
        );
      }
      const substrate: Substrate = {
        kind: "phase",
        activePath: PHASE_PATHS[key],
        content,
      };
      return Object.freeze({ ...substrate }) as Substrate;
    };
    return {
      init: build("init"),
      coding: build("coding"),
      review: build("review"),
    };
  }

  /**
   * 采集 cache-hit 信号并落 telemetry JSONL 事件。
   * warmUp=true → `phase:'warm_up'`（不计稳态统计窗口，T05b 消费时过滤）。
   * warmUp=false → `phase:'steady'`（进稳态 Pareto 软多目标）。
   * telemetry 写失败 → 降级 session log，不阻塞 agent。
   */
  collectCacheHit(signal: CacheHitSignal): void {
    const event: Record<string, unknown> = {
      type: CACHE_HIT_EVENT_TYPE,
      substrateSha: signal.substrateSha,
      isWarmUp: signal.isWarmUp,
      cacheReadTokens: signal.cacheReadTokens,
      inputTokens: signal.inputTokens,
      phase: signal.isWarmUp ? "warm_up" : "steady",
    };
    try {
      this.telemetry.write(event);
    } catch (cause) {
      // 降级：落 session log，绝不阻塞 agent
      this.sessionLog.warn({
        type: CACHE_HIT_WRITE_FAILED_EVENT,
        substrateSha: signal.substrateSha,
        isWarmUp: signal.isWarmUp,
        cacheReadTokens: signal.cacheReadTokens,
        inputTokens: signal.inputTokens,
        phase: signal.isWarmUp ? "warm_up" : "steady",
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}
