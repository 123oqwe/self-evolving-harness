// L1-T02 · compaction summary prompt 基质加载 + recall 信号采集
//
// baseline = pi compaction 结构化模板（## Goal / ## Constraints / ## Progress /
// ## Decisions / ## Next Steps / ## Critical Context + <read-files> <modified-files>）。
// recall 信号 = 被丢信息后来被检索/重读的频次↓（PRD §9.1 compaction recall）。
//
// 铁律：recall 信号采集失败绝不阻塞 compaction 主路径（compaction 是
// static-core 恢复路径，PRD §1.4b overflow 单次锁）。

import type { ConfigRepo, ConfigSet } from "./repo-layout.js";
import type { Substrate, RecallSignal } from "./substrate-types.js";

/**
 * Telemetry sink 接口（由 TL-T01 实现，此处依赖注入便于 mock）。
 * `write` 同步落一条 JSONL 事件；写失败抛错由调用方降级。
 */
export interface TelemetrySink {
  write(event: Record<string, unknown>): void;
  writeAsync?(event: Record<string, unknown>): void | Promise<void>;
}

/**
 * Session log 接口：recall 信号写入 telemetry 失败时的降级落点。
 * 默认实现写 `console.error`，避免硬依赖具体 session log 模块。
 */
export interface SessionLogger {
  warn(event: Record<string, unknown>): void;
}

/** compaction 基质 active 路径（相对 repo root，posix）。 */
const COMPACTION_ACTIVE_PATH = "prompts/compaction-summary.md";

/** telemetry 事件 type 标识。 */
const RECALL_EVENT_TYPE = "compaction_recall_signal";
/** session log 降级事件标识。 */
const RECALL_WRITE_FAILED_EVENT = "recall_signal_write_failed";

/**
 * baseline 文件缺失/不可加载时抛出。
 * compaction 是 static-core 路径，基质缺失必须显式失败而非返回空内容。
 */
export class MissingSubstrateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingSubstrateError";
  }
}

/** 默认 session logger：降级到 stderr，绝不抛错。 */
const defaultSessionLogger: SessionLogger = {
  warn(event) {
    try {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(event));
    } catch {
      /* swallow — session log 降级失败也不能阻塞 compaction */
    }
  },
};

/**
 * compaction summary prompt 基质加载器 + recall 信号采集器。
 *
 * - `load(repo)`：经 `ConfigRepo.loadActive()` 取 active 快照，返回
 *   `Substrate{kind:'compaction', activePath, content}`。
 * - `collectRecallSignal(signal)`：写 telemetry JSONL 事件；写失败降级到
 *   session log（`recall_signal_write_failed`），绝不阻塞 compaction 主路径。
 */
export class CompactionSubstrate {
  private readonly telemetry: TelemetrySink;
  private readonly sessionLog: SessionLogger;

  constructor(opts: { telemetry: TelemetrySink; sessionLog?: SessionLogger }) {
    this.telemetry = opts.telemetry;
    this.sessionLog = opts.sessionLog ?? defaultSessionLogger;
  }

  /**
   * 加载 compaction 基质 active 快照。
   * baseline 文件缺失/校验失败 → throw `MissingSubstrateError`。
   */
  load(repo: ConfigRepo): Substrate {
    let cs: ConfigSet;
    try {
      cs = repo.loadActive();
    } catch (cause) {
      // 文件缺失（ENOENT）或 sha 失配等均视为基质不可加载
      const msg =
        cause instanceof Error
          ? `compaction substrate load failed: ${cause.message}`
          : "compaction substrate load failed";
      throw new MissingSubstrateError(msg);
    }
    if (!cs.compactionPrompt) {
      throw new MissingSubstrateError(
        `compaction substrate missing at ${COMPACTION_ACTIVE_PATH}`,
      );
    }
    const substrate: Substrate = {
      kind: "compaction",
      activePath: COMPACTION_ACTIVE_PATH,
      content: cs.compactionPrompt,
    };
    return Object.freeze({ ...substrate }) as Substrate;
  }

  /**
   * 采集 recall 信号并落 telemetry JSONL 事件。
   * recall 计数为 0 也照常落事件（边界：count:0 不报错）。
   * telemetry 写失败 → 降级 session log（`recall_signal_write_failed`），
   * 不抛错、不阻塞 compaction 主路径。
   */
  collectRecallSignal(signal: RecallSignal): void {
    const event: Record<string, unknown> = {
      type: RECALL_EVENT_TYPE,
      substrateSha: signal.substrateSha,
      fullOutputPathRereadCount: signal.fullOutputPathRereadCount,
      sampledAt: signal.sampledAt,
    };
    try {
      this.telemetry.write(event);
    } catch (cause) {
      // 降级：落 session log，绝不阻塞 compaction 主路径
      this.sessionLog.warn({
        type: RECALL_WRITE_FAILED_EVENT,
        substrateSha: signal.substrateSha,
        fullOutputPathRereadCount: signal.fullOutputPathRereadCount,
        sampledAt: signal.sampledAt,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}
