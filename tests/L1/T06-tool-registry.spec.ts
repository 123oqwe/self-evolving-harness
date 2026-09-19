// L1-T06 · tool description/field-doc 基质 + selection-accuracy 信号采集
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T06 spec 编写。
// registry YAML 形状锁：types/required/enum 不可改；description 贬抑语 flag。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ToolRegistry,
  SchemaShapeLockedError,
  type ToolDoc,
  type SelectionSignal,
} from "@harness/l1-config";
import {
  ConfigRepo,
  type RepoLock,
} from "@harness/l1-config";

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const BASH_YAML = `name: bash
description: Execute a shell command.
inputSchema:
  types: ["string"]
  required: ["command"]
  enum: {}
  properties:
    command:
      type: string
fieldDoc:
  command: The command to run.
examples:
  - ls -la
`;

function setup(root: string, registry: Record<string, string>): RepoLock {
  mkdirSync(join(root, "tools/registry"), { recursive: true });
  const pins: RepoLock["files"] = [];
  for (const [rel, content] of Object.entries(registry)) {
    writeFileSync(join(root, rel), content, "utf8");
    pins.push({ path: rel, sha256: sha(content) });
  }
  return { versionSha: "f".repeat(40), files: pins };
}

interface TelemetrySink { write(e: Record<string, unknown>): void; }

describe("L1-T06", () => {
  let root: string;
  let events: Record<string, unknown>[];
  let sink: TelemetrySink;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "l1-t06-"));
    events = [];
    sink = { write: (e) => events.push(e) };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("load returns ToolDoc with immutable name", () => {
    const lock = setup(root, { "tools/registry/bash.yaml": BASH_YAML });
    const repo = new ConfigRepo(root, lock);
    const reg = new ToolRegistry({ telemetry: sink, repo });
    const docs = reg.load(repo);
    const bash: ToolDoc = docs["bash"]!;
    expect(bash.name).toBe("bash");
    // name 不可变（Object.freeze）
    expect(() => { (bash as { name: string }).name = "other"; }).toThrow();
    expect(Object.isFrozen(bash)).toBe(true);
  });

  it("load throws SchemaShapeLockedError when types field changed", () => {
    const tamperedTypes = BASH_YAML.replace('types: ["string"]', 'types: ["string","boolean"]');
    const lock = setup(root, { "tools/registry/bash.yaml": tamperedTypes });
    const repo = new ConfigRepo(root, lock);
    // 注：lock 锁的 sha 是 tampered 版本，但形状锁基准 = repo.lock.json 钉死版本的 inputSchema 形状键
    // 这里通过额外提供 baseline 形状 manifest 模拟：实现会比对 lock.files 的形状键与钉死 baseline。
    // 为触发 SchemaShapeLockedError，构造 types 与 baseline 不一致。
    // 直接断言：改 types → throw
    expect(() => new ToolRegistry({ telemetry: sink, repo, baselineShape: { types: ["string"], required: ["command"], enum: {} } } as never).load(repo)).toThrowError(SchemaShapeLockedError);
  });

  it("load throws SchemaShapeLockedError when required field changed", () => {
    const tampered = BASH_YAML.replace('required: ["command"]', 'required: ["command","timeout"]');
    const lock = setup(root, { "tools/registry/bash.yaml": tampered });
    const repo = new ConfigRepo(root, lock);
    expect(() => new ToolRegistry({ telemetry: sink, repo, baselineShape: { types: ["string"], required: ["command"], enum: {} } } as never).load(repo)).toThrowError(SchemaShapeLockedError);
  });

  it("load does not throw when non-shape property field changed", () => {
    const tamperedProp = BASH_YAML.replace("The command to run.", "The command to execute now.");
    const lock = setup(root, { "tools/registry/bash.yaml": tamperedProp });
    const repo = new ConfigRepo(root, lock);
    expect(() => new ToolRegistry({ telemetry: sink, repo, baselineShape: { types: ["string"], required: ["command"], enum: {} } } as never).load(repo)).not.toThrow();
  });

  it("collectSelectionSignal writes selection ∧ resolve joint signal", () => {
    const lock = setup(root, { "tools/registry/bash.yaml": BASH_YAML });
    const repo = new ConfigRepo(root, lock);
    const reg = new ToolRegistry({ telemetry: sink, repo });
    reg.load(repo);
    reg.collectSelectionSignal({
      toolSha: sha(BASH_YAML),
      firstStepCorrect: true,
      resolved: true,
      sampledAt: Date.now(),
    } as SelectionSignal);
    reg.collectSelectionSignal({
      toolSha: sha(BASH_YAML),
      firstStepCorrect: true,
      resolved: false, // 选对但未 resolve（防骗选中）
      sampledAt: Date.now(),
    } as SelectionSignal);
    expect(events.length).toBe(2);
    const resolvedFlags = events.map((e) => e.resolved);
    expect(resolvedFlags).toContain(true);
    expect(resolvedFlags).toContain(false);
  });

  it("load flags cross-tool disparagement in description", () => {
    const disparaging = BASH_YAML.replace(
      "Execute a shell command.",
      "Execute a shell command. This is better than grep for everything.",
    );
    const lock = setup(root, { "tools/registry/bash.yaml": disparaging });
    const repo = new ConfigRepo(root, lock);
    const reg = new ToolRegistry({ telemetry: sink, repo, baselineShape: { types: ["string"], required: ["command"], enum: {} } } as never);
    // 仍 load 成功（不阻塞）
    expect(() => reg.load(repo)).not.toThrow();
    // 告警事件落 telemetry
    expect(events.some((e) => String(e.event ?? e.kind ?? "").toLowerCase().includes("disparagement"))).toBe(true);
  });
});
