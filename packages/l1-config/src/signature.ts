// L1-T03 · static 段签名校验（篡改即 reject）
//
// `<safety>...</safety>` 段是 phase prompt 的不可变安全基底（PRD §11.3 breaker
// clause：删 safety rule 的 diff 自动 reject）。本模块提供 runtime 第二层守卫：
// 即使绕过 pre-commit（L0C-T08），load 时重算 safety 段 sha256 比对 L0
// static-core 签名清单，失配即 throw + refuse load。
//
// canonical 抽取（正则 + trim 归一化 + sha256）抽成纯函数 `computeSegmentHash`，
// 供 pre-commit（L0C-T08）与 runtime（本任务）共用同一实现，避免双份逻辑漂移。

import { createHash } from "node:crypto";

// ── 类型 ────────────────────────────────────────────────────────────────────

/**
 * 签名清单（来自 L0 static-core 的 `static-segment-signatures.json`）。
 * agent 只读（L0C-T11 守）；本模块只消费，不写。
 */
export interface SignatureManifest {
  readonly entries: ReadonlyArray<{
    readonly filePath: string;
    readonly segmentId: "safety";
    readonly sha256: string;
  }>;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/** safety 段缺失或 sha256 失配（视作篡改）。 */
export class SignatureTamperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureTamperError";
  }
}

// ── 纯函数：canonical 段抽取 + sha256 ─────────────────────────────────────

const SAFETY_SEGMENT_RE = /<safety>([\s\S]*?)<\/safety>/;

/**
 * 计算 content 中指定 segment 的 canonical sha256。
 * canonical 抽取：正则取 `<safety>` 段内容 → `trim()` 归一化 → sha256 hex。
 * 段缺失 → 返回 `null`（调用方决定如何报错）。
 *
 * 此函数为 pre-commit（L0C-T08）与 runtime（本任务）的单一实现源，
 * 严禁双份逻辑漂移（否则会产生假 reject / 假 accept）。
 */
export function computeSegmentHash(
  content: string,
  segmentId: "safety",
): string | null {
  const m = content.match(SAFETY_SEGMENT_RE);
  if (!m) return null;
  const inner = m[1]!;
  return createHash("sha256").update(inner.trim()).digest("hex");
}

// ── SignatureVerifier ──────────────────────────────────────────────────────

/**
 * 签名校验器：持有 L0 static-core 签名清单，对单文件 content 做 safety 段
 * sha256 比对。失配（含段缺失）→ throw `SignatureTamperError`。
 */
export class SignatureVerifier {
  constructor(private readonly manifest: SignatureManifest) {}

  /**
   * 校验 `filePath` 的 `content` 中 safety 段 sha256 与 manifest 一致。
   * - 无 manifest 条目 → throw `SignatureTamperError`（视作篡改/未授权）。
   * - content 无 `<safety>` 段 → throw `SignatureTamperError`（段缺失视作篡改）。
   * - sha256 失配 → throw `SignatureTamperError`。
   * - 一致 → 正常返回（void）。
   */
  verify(filePath: string, content: string): void {
    const entry = this.manifest.entries.find(
      (e) => e.filePath === filePath && e.segmentId === "safety",
    );
    if (!entry) {
      throw new SignatureTamperError(
        `no signature manifest entry for ${filePath}`,
      );
    }
    const hash = computeSegmentHash(content, "safety");
    if (hash === null) {
      throw new SignatureTamperError(
        `safety segment missing in ${filePath} (deletion = tamper)`,
      );
    }
    if (hash !== entry.sha256) {
      throw new SignatureTamperError(
        `safety segment sha256 mismatch for ${filePath}: expected ${entry.sha256}, got ${hash}`,
      );
    }
  }
}
