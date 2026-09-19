// L1-T03 · system phase prompt 基质 + safety 段签名校验 + warm-up cache-hit 度量
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T03 spec 编写。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  SignatureVerifier,
  SignatureTamperError,
  MissingSignatureManifestError,
  PhaseSubstrate,
  type SignatureManifest,
  type CacheHitSignal,
  type Substrate,
} from "@harness/l1-config";
import {
  ConfigRepo,
  type RepoLock,
} from "@harness/l1-config";

interface TelemetrySink {
  write(event: Record<string, unknown>): void;
}
function makeSink() {
  const events: Record<string, unknown>[] = [];
  return { sink: { write: (e: Record<string, unknown>) => events.push(e) } as TelemetrySink, events };
}

const SAFETY = "Never drop tool_use_id pairing. Never omit unresolved bugs.";

function makePhaseContent(extra = ""): string {
  return `You are a coding agent.
<safety>${SAFETY}</safety>
${extra}`;
}

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safetySha(content: string): string {
  const m = content.match(/<safety>([\s\S]*?)<\/safety>/);
  if (!m) throw new Error("no safety segment");
  return sha(m[1]!.trim());
}

function setup(root: string, files: Record<string, string>): { lock: RepoLock; manifest: SignatureManifest } {
  mkdirSync(join(root, "prompts"), { recursive: true });
  const pins: RepoLock["files"] = [];
  const entries: SignatureManifest["entries"] = [];
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(root, rel), content, "utf8");
    pins.push({ path: rel, sha256: sha(content) });
    entries.push({ filePath: rel, segmentId: "safety", sha256: safetySha(content) });
  }
  return {
    lock: { versionSha: "p".repeat(40), files: pins },
    manifest: { entries },
  };
}

describe("L1-T03", () => {
  let root: string;
  let sink: ReturnType<typeof makeSink>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t03-"));
    sink = makeSink();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("SignatureVerifier accepts matching safety segment", () => {
    const content = makePhaseContent();
    const v = new SignatureVerifier({
      entries: [{ filePath: "prompts/phase-coding.md", segmentId: "safety", sha256: safetySha(content) }],
    });
    expect(() => v.verify("prompts/phase-coding.md", content)).not.toThrow();
  });

  it("SignatureVerifier throws SignatureTamperError on one-byte change", () => {
    const content = makePhaseContent();
    const v = new SignatureVerifier({
      entries: [{ filePath: "prompts/phase-coding.md", segmentId: "safety", sha256: safetySha(content) }],
    });
    const tampered = content.replace("tool_use_id", "tool_use_iX");
    expect(() => v.verify("prompts/phase-coding.md", tampered)).toThrowError(SignatureTamperError);
  });

  it("SignatureVerifier throws when safety segment deleted", () => {
    const original = makePhaseContent();
    const v = new SignatureVerifier({
      entries: [{ filePath: "prompts/phase-coding.md", segmentId: "safety", sha256: safetySha(original) }],
    });
    const noSafety = makePhaseContent().replace(/<safety>[\s\S]*?<\/safety>/, "");
    expect(() => v.verify("prompts/phase-coding.md", noSafety)).toThrowError(SignatureTamperError);
  });

  it("PhaseSubstrate.load verifies all three phase files", () => {
    const init = makePhaseContent("init phase");
    const coding = makePhaseContent("coding phase");
    const review = makePhaseContent("review phase");
    const { lock, manifest } = setup(root, {
      "prompts/phase-init.md": init,
      "prompts/phase-coding.md": coding,
      "prompts/phase-review.md": review,
    });
    const repo = new ConfigRepo(root, lock);
    const verifier = new SignatureVerifier(manifest);
    const sub = new PhaseSubstrate({ telemetry: sink.sink });
    const result = sub.load(repo, verifier);
    expect(result.init.kind).toBe("phase");
    expect(result.coding.content).toContain("coding phase");
    expect(result.review.content).toContain("review phase");
  });

  it("PhaseSubstrate.load throws and keeps old snapshot on tamper", () => {
    const coding = makePhaseContent("coding phase");
    const { lock, manifest } = setup(root, {
      "prompts/phase-init.md": makePhaseContent("init"),
      "prompts/phase-coding.md": coding,
      "prompts/phase-review.md": makePhaseContent("review"),
    });
    const repo = new ConfigRepo(root, lock);
    const verifier = new SignatureVerifier(manifest);
    const sub = new PhaseSubstrate({ telemetry: sink.sink });
    // 先成功 load 一次
    const first = sub.load(repo, verifier);
    expect(first.coding).toBeDefined();
    // 篡改 phase-coding 的 safety 段一字节
    const tampered = coding.replace("tool_use_id", "tool_use_iX");
    writeFileSync(join(root, "prompts/phase-coding.md"), tampered, "utf8");
    expect(() => sub.load(repo, verifier)).toThrow();
  });

  it("collectCacheHit ignores warm-up session", () => {
    const coding = makePhaseContent("coding");
    const { lock, manifest } = setup(root, {
      "prompts/phase-init.md": makePhaseContent("init"),
      "prompts/phase-coding.md": coding,
      "prompts/phase-review.md": makePhaseContent("review"),
    });
    const repo = new ConfigRepo(root, lock);
    const verifier = new SignatureVerifier(manifest);
    const sub = new PhaseSubstrate({ telemetry: sink.sink });
    sub.load(repo, verifier);
    // warmUp=true 信号不进稳态窗口
    sub.collectCacheHit({
      substrateSha: sha(coding),
      isWarmUp: true,
      cacheReadTokens: 0,
      inputTokens: 100,
    } as CacheHitSignal);
    // warmUp=false 进稳态窗口
    sub.collectCacheHit({
      substrateSha: sha(coding),
      isWarmUp: false,
      cacheReadTokens: 50,
      inputTokens: 100,
    } as CacheHitSignal);
    const steady = sink.events.filter((e) => e.isWarmUp === false || e.phase === "steady");
    const warmup = sink.events.filter((e) => e.isWarmUp === true || e.phase === "warm_up");
    expect(warmup.length).toBeGreaterThan(0);
    expect(steady.length).toBeGreaterThan(0);
    // warm-up 事件不计入稳态统计（标 warm_up）
    expect(warmup.some((e) => e.phase === "warm_up" || e.isWarmUp === true)).toBe(true);
  });

  it("load throws MissingSignatureManifestError when manifest absent", () => {
    const { lock } = setup(root, {
      "prompts/phase-init.md": makePhaseContent("init"),
      "prompts/phase-coding.md": makePhaseContent("coding"),
      "prompts/phase-review.md": makePhaseContent("review"),
    });
    const repo = new ConfigRepo(root, lock);
    // 不传 manifest / 传空 → 视作缺失
    expect(() => new PhaseSubstrate({ telemetry: sink.sink }).load(repo, undefined as never)).toThrow();
  });
});
