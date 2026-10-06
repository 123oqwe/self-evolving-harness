// ISS-08: 失败轨迹源真实性 —— source 契约 + deploy 前置门 + 真实 TL-T01 JSONL reader。
//
// 验收（spec §ISS-08）：
//   1. 纯 synthetic 输入时 deploy 被拒（deploySourceGate → allowDeploy=false, dry-run）。
//   2. 真实 JSONL fixture 能走通 mine 步（readTlTrajectories → source:"real"，deploySourceGate 放行）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deploySourceGate,
  readTlTrajectories,
} from "@harness/canary-eval";
import type { Trajectory } from "@harness/contracts";

function synthetic(n = 1, id = "t"): Trajectory[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${id}-${i}`,
    sessionId: `${id}-${i}`,
    substrateSha: "sha-xxx",
    source: "synthetic",
    failed: true,
    diagnosis: "handmade diagnosis",
    luckyPass: false,
  }));
}

function real(id: string): Trajectory {
  return {
    id,
    sessionId: id,
    substrateSha: "sha-xxx",
    source: "real",
    failed: true,
    diagnosis: "real failure",
  };
}

describe("ISS-08 · deploySourceGate（纯 synthetic 输入 deploy 被拒）", () => {
  it("全部 synthetic → allowDeploy=false, mode=dry-run", () => {
    const g = deploySourceGate(synthetic(3));
    expect(g.allowDeploy).toBe(false);
    expect(g.mode).toBe("dry-run");
    expect(g.syntheticCount).toBe(3);
    expect(g.realCount).toBe(0);
    expect(g.total).toBe(3);
  });

  it("显式 allowSyntheticDeploy → allowDeploy=true + reason 标注", () => {
    const g = deploySourceGate(synthetic(3), { allowSyntheticDeploy: true });
    expect(g.allowDeploy).toBe(true);
    expect(g.mode).toBe("deploy");
    expect(g.reason).toMatch(/allowSyntheticDeploy|synthetic/i);
  });

  it("含真实轨迹 → allowDeploy=true, mode=deploy", () => {
    const g = deploySourceGate([...synthetic(2), real("r1")]);
    expect(g.allowDeploy).toBe(true);
    expect(g.mode).toBe("deploy");
    expect(g.realCount).toBe(1);
    expect(g.syntheticCount).toBe(2);
  });

  it("空集 → allowDeploy=true（无合成-only 信号，由上游 mine 保证）", () => {
    const g = deploySourceGate([]);
    expect(g.allowDeploy).toBe(true);
    expect(g.mode).toBe("deploy");
  });
});

describe("ISS-08 · readTlTrajectories（真实 JSONL fixture 走通 mine 步）", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iss08-tl-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeTlSession(sessionId: string, nodes: unknown[]): void {
    writeFileSync(
      join(dir, `${sessionId}.jsonl`),
      nodes.map((n) => JSON.stringify(n)).join("\n") + "\n",
      "utf8",
    );
  }

  it("真实 TL-T01 JSONL → source:real Trajectory，且 deploySourceGate 放行", () => {
    const sessionId = "sess-real-1";
    writeTlSession(sessionId, [
      { type: "user", content: [{ type: "text", text: "run compaction" }] },
      {
        type: "assistant",
        content: [
          { type: "tool_result", is_error: true, content: "Error: compaction truncated" },
        ],
      },
    ]);
    const trajs = readTlTrajectories(dir, "sha-real");
    expect(trajs.length).toBe(1);
    expect(trajs[0]!.source).toBe("real");
    expect(trajs[0]!.sessionId).toBe(sessionId);
    expect(trajs[0]!.diagnosis).toContain("Error");
    // 走通 mine：真实轨迹不触发 synthetic-only 拒绝。
    const g = deploySourceGate(trajs);
    expect(g.allowDeploy).toBe(true);
    expect(g.mode).toBe("deploy");
  });

  it("无失败信号的 JSONL → 跳过（不入结果）", () => {
    writeTlSession("ok-session", [
      { type: "user", content: [{ type: "text", text: "hi" }] },
    ]);
    expect(readTlTrajectories(dir, "sha-x")).toEqual([]);
  });

  it("非法 JSONL 行 → 跳过不崩（合法行仍参与）", () => {
    writeFileSync(
      join(dir, "mixed.jsonl"),
      "{not-json}\n" +
        JSON.stringify({ type: "assistant", content: [{ type: "tool_result", is_error: true, content: "boom" }] }) +
        "\n",
      "utf8",
    );
    const trajs = readTlTrajectories(dir, "sha-mixed");
    expect(trajs.length).toBe(1);
    expect(trajs[0]!.source).toBe("real");
    expect(trajs[0]!.diagnosis).toBe("boom");
  });

  it("不存在的目录 → 空数组", () => {
    expect(readTlTrajectories(join(dir, "nope"), "sha-x")).toEqual([]);
  });
});
