// TL-T01: JSONL transcript 树（parentUuid 对话树）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T01）的 Given/When/Then 全部场景：
//   1. 新 session → startSession 返回 sessionId、创建 JSONL 文件、root 节点 parentUuid=null
//   2. append 父节点 P → 新节点 parentUuid=P 落末行、uuid 全局唯一
//   3. crash recovery → loadSession 返回 10 个节点、树结构完整
//   4. orphaned tool_use_id → verifyTree 返回 {ok:false, orphans:[thatUuid]}（模拟 400）
//   5. append-only 不变量 → 已写节点 U 行在后续写后内容不可变
//   6. subagent boundary → appendSubagentBoundary 创建 agentId 隔离节点
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptWriter } from "@harness/telemetry";
import type {
  TranscriptWriter,
  TranscriptNode,
  NormalizedContent,
} from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造器
//
// 说明：spec 给出 TranscriptNode 公共类型（uuid/parentUuid/type/sessionId/cwd/
// gitBranch/version/timestamp/agentId?/content/toolUseId?/usage?），但未给出
// `NormalizedContent`（content 字段）的精确形状（spec 仅述"text/image 归一化"）。
// 此处按最小可工作假设构造 text 变体：`{ type:'text', text:string }`。
// 见文末 ambiguities。
// ---------------------------------------------------------------------------
function textContent(text: string): NormalizedContent {
  return { type: "text", text } as unknown as NormalizedContent;
}

// 构造一个合法的 assistant 节点载荷（Omit<TranscriptNode,'uuid'|'parentUuid'|'timestamp'>）
// 注意：spec 把 toolUseId 放在节点顶层（TranscriptNode.toolUseId?），
// assistant 节点用它声明本 turn 发出的 tool_use id。
function assistantPayload(sessionId: string, ctx: {
  cwd: string;
  gitBranch: string;
  version: string;
}, opts: { toolUseId?: string; agentId?: string } = {}) {
  return {
    type: "assistant" as const,
    sessionId,
    cwd: ctx.cwd,
    gitBranch: ctx.gitBranch,
    version: ctx.version,
    content: textContent("assistant turn"),
    toolUseId: opts.toolUseId,
    agentId: opts.agentId,
  };
}

function userPayload(sessionId: string, ctx: {
  cwd: string;
  gitBranch: string;
  version: string;
}) {
  return {
    type: "user" as const,
    sessionId,
    cwd: ctx.cwd,
    gitBranch: ctx.gitBranch,
    version: ctx.version,
    content: textContent("user turn"),
  };
}

function toolResultPayload(sessionId: string, ctx: {
  cwd: string;
  gitBranch: string;
  version: string;
}, toolUseId: string) {
  return {
    type: "tool_result" as const,
    sessionId,
    cwd: ctx.cwd,
    gitBranch: ctx.gitBranch,
    version: ctx.version,
    content: textContent("tool result"),
    toolUseId,
  };
}

// ---------------------------------------------------------------------------
// TL-T01
// ---------------------------------------------------------------------------
describe("TL-T01", () => {
  let baseDir: string;
  let ctx: { cwd: string; gitBranch: string; version: string };

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "tl-t01-"));
    // encoded-cwd：spec 把 `/` 替换 `-`；测试 cwd 用真实路径，writer 内部负责编码
    ctx = { cwd: "/tmp/tl-t01-proj", gitBranch: "main", version: "0.1.0" };
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "parentUuid tree: root parentUuid=null; child 指向 parent"
  //   Given 一个新 session
  //   When  startSession 后 append 一个 parentUuid=null 的根节点，再 append 一个
  //         parentUuid=root 的子节点
  //   Then  sessionId 非空、JSONL 文件存在；根节点 parentUuid=null；子节点
  //         parentUuid===root.uuid；两个 uuid 全局唯一
  // -------------------------------------------------------------------------
  it("parentUuid tree: root parentUuid=null; child 指向 parent", async () => {
    const writer = createTranscriptWriter({ baseDir });
    const sessionId = await writer.startSession(ctx);

    // sessionId 须是非空字符串
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);

    // 根节点：parentUuid=null
    const rootUuid = await writer.append({
      ...userPayload(sessionId, ctx),
      parentUuid: null,
    });
    // 子节点：parentUuid 指向根
    const childUuid = await writer.append({
      ...assistantPayload(sessionId, ctx),
      parentUuid: rootUuid,
    });

    const nodes = await writer.loadSession(sessionId);
    // 根 + 子 = 2 节点（startSession 是否落 root 节点未定，见 ambiguities；
    // 至少须含我们 append 的两节点）
    expect(nodes.length).toBeGreaterThanOrEqual(2);

    const root = nodes.find((n) => n.uuid === rootUuid);
    const child = nodes.find((n) => n.uuid === childUuid);
    expect(root).toBeDefined();
    expect(child).toBeDefined();
    // root.parentUuid === null（对话树根）
    expect(root!.parentUuid).toBeNull();
    // child.parentUuid 指向 root（树链接正确）
    expect(child!.parentUuid).toBe(rootUuid);
    // uuid 全局唯一：root.uuid !== child.uuid
    expect(rootUuid).not.toBe(childUuid);
    expect(root!.uuid).not.toBe(child!.uuid);
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "append-only: 文件已写节点 U 后续写不修改 U 行"
  //   Given 文件已写入节点 U
  //   When  任何后续写（append 多个节点）
  //   Then  U 行内容不可变（文件仅追加，既有行字节不变）
  // -------------------------------------------------------------------------
  it("append-only: 文件已写节点 U 后续写不修改 U 行", async () => {
    const writer = createTranscriptWriter({ baseDir });
    const sessionId = await writer.startSession(ctx);

    const uUuid = await writer.append({
      ...assistantPayload(sessionId, ctx, { toolUseId: "tu_U" }),
      parentUuid: null,
    });

    // 捕获写入 U 后的文件全文快照（append-only → 后续写只追加，旧内容须为前缀）
    const sessionPath = writer.sessionPath(sessionId);
    const snapshotAfterU = readFileSync(sessionPath, "utf8");

    // 后续写若干节点
    await writer.append({
      ...assistantPayload(sessionId, ctx, { toolUseId: "tu_V1" }),
      parentUuid: uUuid,
    });
    await writer.append({
      ...toolResultPayload(sessionId, ctx, "tu_V1"),
      parentUuid: uUuid,
    });
    await writer.append({
      ...userPayload(sessionId, ctx),
      parentUuid: uUuid,
    });

    const snapshotAfterMore = readFileSync(sessionPath, "utf8");

    // 旧快照必须是新快照的严格前缀（既有行字节不变，仅追加新行）
    expect(snapshotAfterMore.startsWith(snapshotAfterU)).toBe(true);
    expect(snapshotAfterMore.length).toBeGreaterThan(snapshotAfterU.length);

    // U 节点 reload 后内容不变（uuid 不变、parentUuid 不变、type 不变、toolUseId 不变）
    const nodes = await writer.loadSession(sessionId);
    const u = nodes.find((n) => n.uuid === uUuid);
    expect(u).toBeDefined();
    expect(u!.uuid).toBe(uUuid);
    expect(u!.parentUuid).toBeNull();
    expect(u!.type).toBe("assistant");
    expect(u!.toolUseId).toBe("tu_U");
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "crash recovery: loadSession 返回完整树"
  //   Given JSONL 已有 10 行（10 节点）
  //   When  进程 crash 后用新 writer 实例 loadSession（模拟重水化）
  //   Then  返回 10 个节点，树结构完整（每个非 root 节点 parentUuid 指向已存在节点）
  // -------------------------------------------------------------------------
  it("crash recovery: loadSession 返回完整树", async () => {
    const writer = createTranscriptWriter({ baseDir });
    const sessionId = await writer.startSession(ctx);

    // 写 10 个节点：1 root + 9 链式子节点
    let prev = await writer.append({
      ...userPayload(sessionId, ctx),
      parentUuid: null,
    });
    for (let i = 1; i < 10; i++) {
      prev = await writer.append({
        ...(i % 2 === 0
          ? assistantPayload(sessionId, ctx, { toolUseId: `tu_${i}` })
          : userPayload(sessionId, ctx)),
        parentUuid: prev,
      });
    }

    // 模拟 crash：丢弃旧 writer，用新实例重水化
    const revived = createTranscriptWriter({ baseDir });
    const nodes = await revived.loadSession(sessionId);

    // 返回 10 个节点
    expect(nodes.length).toBe(10);

    // 树结构完整：每个非 root 节点的 parentUuid 指向已存在节点
    const uuidSet = new Set(nodes.map((n) => n.uuid));
    // 唯一性：10 个 uuid 互不相同
    expect(uuidSet.size).toBe(10);
    // 恰有一个 root（parentUuid===null）
    const roots = nodes.filter((n) => n.parentUuid === null);
    expect(roots.length).toBe(1);
    // 每个非 root 节点的 parentUuid 必须在 uuidSet 中
    for (const n of nodes) {
      if (n.parentUuid !== null) {
        expect(uuidSet.has(n.parentUuid)).toBe(true);
      }
    }
    // 所有节点 sessionId/cwd/gitBranch/version 一致（上下文钉死）
    for (const n of nodes) {
      expect(n.sessionId).toBe(sessionId);
      expect(n.cwd).toBe(ctx.cwd);
      expect(n.gitBranch).toBe(ctx.gitBranch);
      expect(n.version).toBe(ctx.version);
      // timestamp 非空（ISO 8601）
      expect(typeof n.timestamp).toBe("string");
      expect(n.timestamp.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "orphaned tool_use_id: tool_result 无配对 tool_use → verifyTree 报 orphans"
  //   Given 一个 tool_result 节点的 toolUseId 在祖先 assistant 节点中无配对 tool_use
  //   When  verifyTree
  //   Then  返回 {ok:false, orphans:[thatUuid]}（模拟 API 400 拒绝）
  // -------------------------------------------------------------------------
  it("orphaned tool_use_id: tool_result 无配对 tool_use → verifyTree 报 orphans", async () => {
    const writer = createTranscriptWriter({ baseDir });
    const sessionId = await writer.startSession(ctx);

    // root assistant 声明 tool_use id='tu_paired'
    const root = await writer.append({
      ...assistantPayload(sessionId, ctx, { toolUseId: "tu_paired" }),
      parentUuid: null,
    });
    // 配对的 tool_result
    const paired = await writer.append({
      ...toolResultPayload(sessionId, ctx, "tu_paired"),
      parentUuid: root,
    });
    // 孤儿 tool_result：toolUseId='tu_orphan' 无任何 assistant 声明该 id
    const orphan = await writer.append({
      ...toolResultPayload(sessionId, ctx, "tu_orphan"),
      parentUuid: root,
    });

    const nodes = await writer.loadSession(sessionId);

    // 正常树（含配对 tool_result）应 ok
    const okResult = writer.verifyTree(nodes.filter((n) => n.uuid !== orphan));
    expect(okResult.ok).toBe(true);
    expect(okResult.orphans).toEqual([]);

    // 含孤儿 → ok=false，orphans 含该孤儿 uuid
    const badResult = writer.verifyTree(nodes);
    expect(badResult.ok).toBe(false);
    expect(badResult.orphans).toContain(orphan);
    // 孤儿集合不含已配对的 tool_result
    expect(badResult.orphans).not.toContain(paired);
    // 不误报 root assistant（它声明了 tool_use，不是孤儿）
    expect(badResult.orphans).not.toContain(root);
  });

  // -------------------------------------------------------------------------
  // 场景 6 + RED 名: "subagent boundary: appendSubagentBoundary 创建 agentId 隔离节点"
  //   Given 一个父节点 parentUuid=P
  //   When  appendSubagentBoundary(P, 'sub-B')
  //   Then  返回 uuid；loadSession 含一个 type='subagent_boundary' 节点，
  //         parentUuid=P、agentId='sub-B'（子 agent 边界隔离）
  // -------------------------------------------------------------------------
  it("subagent boundary: appendSubagentBoundary 创建 agentId 隔离节点", async () => {
    const writer = createTranscriptWriter({ baseDir });
    const sessionId = await writer.startSession(ctx);

    const parent = await writer.append({
      ...assistantPayload(sessionId, ctx, { agentId: "parent-A" }),
      parentUuid: null,
    });

    const boundaryUuid = await writer.appendSubagentBoundary(parent, "sub-B");

    // 返回非空 uuid，且与 parent 不同
    expect(typeof boundaryUuid).toBe("string");
    expect(boundaryUuid.length).toBeGreaterThan(0);
    expect(boundaryUuid).not.toBe(parent);

    const nodes = await writer.loadSession(sessionId);
    const boundary = nodes.find((n) => n.uuid === boundaryUuid);
    expect(boundary).toBeDefined();
    // type 必须是 subagent_boundary（鉴别类）
    expect(boundary!.type).toBe("subagent_boundary");
    // parentUuid 指向 parent（树链接）
    expect(boundary!.parentUuid).toBe(parent);
    // agentId 隔离：boundary 节点的 agentId === 'sub-B'
    expect(boundary!.agentId).toBe("sub-B");
    // 父节点 agentId 保持 'parent-A'，未被污染
    const parentReloaded = nodes.find((n) => n.uuid === parent);
    expect(parentReloaded!.agentId).toBe("parent-A");
  });
});
