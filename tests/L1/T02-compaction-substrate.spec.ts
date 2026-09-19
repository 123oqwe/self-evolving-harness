// L1-T02 · compaction summary prompt 基质 + baseline + recall 信号采集
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T02 spec 编写。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  CompactionSubstrate,
  MissingSubstrateError,
  type Substrate,
  type RecallSignal,
} from "@harness/l1-config";
import {
  ConfigRepo,
  type RepoLock,
} from "@harness/l1-config";

// ── 辅助：最小 TelemetrySink mock（接口由 TL-T01 实现，此处注入） ────────────
interface TelemetrySink {
  write(event: Record<string, unknown>): void;
  writeAsync?(event: Record<string, unknown>): void | Promise<void>;
}
function makeSink(): { sink: TelemetrySink; events: Record<string, unknown>[]; fail: boolean } {
  const events: Record<string, unknown>[] = [];
  let fail = false;
  const sink: TelemetrySink = {
    write(event) {
      if (fail) throw new Error("telemetry write failed");
      events.push(event);
    },
  };
  return { sink, events, set fail(v: boolean) { fail = v; } } as never;
}

const BASELINE = `## Goal
Summarize progress.
## Constraints
<safety>Never omit unresolved bugs from the Progress section. Never drop tool_use_id pairing.</safety>
`;

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function setupRepo(root: string): RepoLock {
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, "prompts/compaction-summary.md"), BASELINE, "utf8");
  return {
    versionSha: "a".repeat(40),
    files: [{ path: "prompts/compaction-summary.md", sha256: sha(BASELINE) }],
  };
}

describe("L1-T02", () => {
  let root: string;
  let sinkHolder: ReturnType<typeof makeSink>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t02-"));
    sinkHolder = makeSink();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("load returns baseline compaction substrate", () => {
    const repo = new ConfigRepo(root, setupRepo(root));
    const sub = new CompactionSubstrate({ telemetry: sinkHolder.sink });
    const s: Substrate = sub.load(repo);
    expect(s.kind).toBe("compaction");
    expect(s.activePath).toBe("prompts/compaction-summary.md");
    expect(s.content).toContain("## Goal");
    expect(s.content).toContain("<safety>");
  });

  it("load throws MissingSubstrateError when file absent", () => {
    const lock = setupRepo(root);
    // 删 baseline 文件
    rmSync(join(root, "prompts/compaction-summary.md"));
    const repo = new ConfigRepo(root, lock);
    const sub = new CompactionSubstrate({ telemetry: sinkHolder.sink });
    expect(() => sub.load(repo)).toThrowError(MissingSubstrateError);
  });

  it("collectRecallSignal increments reread count", () => {
    const repo = new ConfigRepo(root, setupRepo(root));
    const sub = new CompactionSubstrate({ telemetry: sinkHolder.sink });
    const substrateSha = sha(BASELINE);
    sub.collectRecallSignal({
      substrateSha,
      fullOutputPathRereadCount: 1,
      sampledAt: Date.now(),
    } as RecallSignal);
    sub.collectRecallSignal({
      substrateSha,
      fullOutputPathRereadCount: 2,
      sampledAt: Date.now(),
    } as RecallSignal);
    // telemetry JSONL 含两条 count 递增事件
    const counts = sinkHolder.events
      .map((e) => e.fullOutputPathRereadCount)
      .filter((c): c is number => typeof c === "number");
    expect(counts).toEqual([1, 2]);
  });

  it("collectRecallSignal does not block on telemetry write failure", () => {
    sinkHolder.fail = true;
    const repo = new ConfigRepo(root, setupRepo(root));
    const sub = new CompactionSubstrate({ telemetry: sinkHolder.sink });
    expect(() =>
      sub.collectRecallSignal({
        substrateSha: sha(BASELINE),
        fullOutputPathRereadCount: 1,
        sampledAt: Date.now(),
      } as RecallSignal),
    ).not.toThrow();
    // session log 落失败事件（不阻塞 compaction 主路径）
    // 我们不强制 session log 落盘位置，只断言不 throw + 不写入 telemetry
    expect(sinkHolder.events).toHaveLength(0);
  });

  it("recall count 0 still emits signal", () => {
    const repo = new ConfigRepo(root, setupRepo(root));
    const sub = new CompactionSubstrate({ telemetry: sinkHolder.sink });
    sub.collectRecallSignal({
      substrateSha: sha(BASELINE),
      fullOutputPathRereadCount: 0,
      sampledAt: Date.now(),
    } as RecallSignal);
    expect(sinkHolder.events).toHaveLength(1);
    expect(sinkHolder.events[0]!.fullOutputPathRereadCount).toBe(0);
    void repo;
  });
});
