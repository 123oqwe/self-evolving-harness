// TL-T04: replay 复现率采集（fresh sandbox 重放 + 非确定 action 持久 setup）
//
// replay harness 从 JSONL transcript 在 fresh sandbox 中重放，度量"故障复现率"
// （能否复现原失败的 exit code）。非确定性 action（依赖外部网络/时间）须持久化
// setup 脚本注入确定性。这是 schema_config 进化的选择信号（research §1.1 (e)）。
//
// static-core：replay 是 source-of-truth 重放契约；transcript 损坏（orphaned
// tool_use_id）不尝试部分重放，直接抛 TranscriptCorruptError。
//
// ERRATA 裁决（ERRATA-w2plus TL-05/06/07）：
//   - SandboxHandle（TL 侧）= { execute(cmd): Promise<{exitCode,stdout,stderr}> }
//   - createReplayHarness(opts:{transcript, sandboxFactory, deterministicTools,
//     getOriginalExitCode})；replay 从 tool_use.name/input 生成 execute 入参。
//   - setupScript 由 sandbox 首条命令前消费；FakeSandbox 用 setupExitCode 模拟
//     setup 注入切确定性映射。

import type { TranscriptWriter } from "./transcript";
import type { TranscriptNode, NormalizedBlock } from "./transcript-schema";

// ---------------------------------------------------------------------------
// 公共接口签名（spec TL-T04 + ERRATA TL-05/06/07）
// ---------------------------------------------------------------------------

/** fresh sandbox 句柄（ERRATA TL-05）。execute 接收命令字符串返回 exit code。 */
export interface SandboxHandle {
  execute(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface ReplayResult {
  sessionId: string;
  reproduced: boolean;
  originalExitCode: number | null;
  replayExitCode: number | null;
  nondeterministicActions: string[]; // 需 setup 注入的 action 列表
}

export interface ReplayHarness {
  replay(
    sessionId: string,
    opts: { freshSandbox: SandboxHandle; setupScript?: string },
  ): Promise<ReplayResult>;
  measureReproRate(
    sessionIds: string[],
  ): Promise<{ reproduced: number; total: number; rate: number }>;
}

/** transcript 损坏（orphaned tool_use_id / 父链断裂）→ 抛此错，不部分重放。
 *  error message 含类名，同时支持 instanceof 与正则匹配。 */
export class TranscriptCorruptError extends Error {
  constructor(message = "TranscriptCorruptError: transcript tree corrupt (orphaned tool_use_id or broken parent chain)") {
    super(message);
    this.name = "TranscriptCorruptError";
  }
}

/** replay harness 工厂注入项。 */
export interface ReplayHarnessOpts {
  /** transcript 源：loadSession + verifyTree。 */
  transcript: TranscriptWriter;
  /** 按 sessionId 生产 fresh sandbox 的工厂（measureReproRate 用；replay 用入参 freshSandbox）。 */
  sandboxFactory?: () => SandboxHandle;
  /** 确定性工具白名单：白名单内 tool 视为确定，可重放。
   *  白名单外的 tool 默认标非确定；提供 setupScript 后该 tool 恢复确定性。 */
  deterministicTools: string[];
  /** 可选：查询 session 原 exit code（repro 比对基准）。 */
  getOriginalExitCode?: (sessionId: string) => number | null;
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

/** tool_use block 形状（NormalizedBlock 变体之一）。 */
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

function isToolUseBlock(b: NormalizedBlock): b is ToolUseBlock {
  return (
    b !== null &&
    typeof b === "object" &&
    (b as { type?: unknown }).type === "tool_use"
  );
}

/** 从 tool_use.input 提取 sandbox.execute 入参命令字符串。
 *  input.command 优先（bash 类），次选 input.url（http 类），兜底 JSON 序列化。 */
function extractCommand(input: unknown): string {
  if (input !== null && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (typeof obj.command === "string") return obj.command;
    if (typeof obj.url === "string") return obj.url;
  }
  try {
    return JSON.stringify(input ?? "");
  } catch {
    return String(input ?? "");
  }
}

export function createReplayHarness(opts: ReplayHarnessOpts): ReplayHarness {
  const { transcript, sandboxFactory, deterministicTools, getOriginalExitCode } = opts;
  const deterministicSet = new Set(deterministicTools);

  async function replay(
    sessionId: string,
    replayOpts: { freshSandbox: SandboxHandle; setupScript?: string },
  ): Promise<ReplayResult> {
    // 1. 读取 transcript 节点
    const nodes: TranscriptNode[] = await transcript.loadSession(sessionId);

    // 2. 树校验：orphaned tool_use_id / 父链断裂 → 不部分重放，直接抛错
    const verify = transcript.verifyTree(nodes);
    if (!verify.ok) {
      throw new TranscriptCorruptError(
        `TranscriptCorruptError: session ${sessionId} has ${verify.orphans.length} orphaned node(s): ${verify.orphans.join(", ")}`,
      );
    }

    // 3. 从 assistant 节点的 content 中按顺序提取 tool_use blocks
    const toolUses: ToolUseBlock[] = [];
    for (const node of nodes) {
      if (node.type !== "assistant") continue;
      const blocks = (node.content ?? []) as unknown as NormalizedBlock[];
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (isToolUseBlock(block)) {
          toolUses.push(block);
        }
      }
    }

    const nondeterministicActions: string[] = [];
    let lastExitCode: number | null = null;
    let executedAny = false;

    // setupScript 提供后，所有 tool（含白名单外）恢复确定性，统一执行
    const setupInjected = replayOpts.setupScript !== undefined;

    for (const tu of toolUses) {
      const isDeterministic = deterministicSet.has(tu.name) || setupInjected;
      const command = extractCommand(tu.input);

      if (!isDeterministic) {
        // 非确定 action 无 setup → 列入名单，不执行，不静默假复现
        nondeterministicActions.push(`${tu.name}:${command}`);
        continue;
      }

      // 确定 tool → sandbox 执行，收集 exit code
      const result = await replayOpts.freshSandbox.execute(command);
      lastExitCode = result.exitCode;
      executedAny = true;
    }

    const replayExitCode = executedAny ? lastExitCode : null;
    const originalExitCode = getOriginalExitCode
      ? getOriginalExitCode(sessionId)
      : null;

    // reproduced 判定：
    //   - 有非确定 action 未注入 → false（不静默假复现）
    //   - 否则 = (replayExitCode === originalExitCode)
    let reproduced: boolean;
    if (nondeterministicActions.length > 0) {
      reproduced = false;
    } else if (replayExitCode === null || originalExitCode === null) {
      reproduced = false;
    } else {
      reproduced = replayExitCode === originalExitCode;
    }

    return {
      sessionId,
      reproduced,
      originalExitCode,
      replayExitCode,
      nondeterministicActions,
    };
  }

  async function measureReproRate(
    sessionIds: string[],
  ): Promise<{ reproduced: number; total: number; rate: number }> {
    const total = sessionIds.length;
    let reproduced = 0;
    for (const sid of sessionIds) {
      if (!sandboxFactory) {
        throw new Error(
          "ReplayHarness.measureReproRate requires sandboxFactory to be configured",
        );
      }
      const sandbox = sandboxFactory();
      const result = await replay(sid, { freshSandbox: sandbox });
      if (result.reproduced) reproduced += 1;
    }
    const rate = total > 0 ? reproduced / total : 0;
    return { reproduced, total, rate };
  }

  return { replay, measureReproRate };
}
