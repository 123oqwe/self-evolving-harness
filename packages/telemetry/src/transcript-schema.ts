// TL-T01: transcript 树类型定义 + type 鉴别状态机 + orphaned tool_use_id 校验
//
// 本文件是 static-core 结构契约（execution/telemetry/TASKS.md 模块级数据契约）。
// agent 绝对无写权；字段名/可选性一字不差于 spec 契约节。

// ---------------------------------------------------------------------------
// 归一化内容（static-core，与 L0C ContentBlock 对齐 + thinking 变体）
// content 为 block 数组（非单对象），支持 thinking/text/image/tool_use/tool_result
// 多块并存。
// ---------------------------------------------------------------------------
export type NormalizedContent = NormalizedBlock[];

export type NormalizedBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: ImageSource }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: NormalizedBlock[] | string;
      is_error?: boolean;
    };

export interface ImageSource {
  type: "base64";
  media_type: string;
  data: string;
}

// ---------------------------------------------------------------------------
// transcript 树节点（static-core 结构）
// ---------------------------------------------------------------------------
export interface TranscriptNode {
  uuid: string; // 节点唯一 id
  parentUuid: string | null; // 父节点（root 为 null）
  type: "user" | "assistant" | "system" | "tool_result" | "subagent_boundary";
  sessionId: string;
  cwd: string;
  gitBranch: string;
  version: string; // harness 版本 pin（PRD §9.3 pin scaffold sha）
  timestamp: string; // ISO 8601
  agentId?: string; // 子 agent 归属（多 agent trace 传播）
  content: NormalizedContent; // text/image 归一化
  toolUseId?: string; // tool_use_id 配对（orphaned → 400）
  usage?: Usage; // 仅 assistant 节点
}

// TL-T02 per-turn usage 五子类型（static-core，禁 total_tokens）
// 此处提前导出以供 transcript 节点引用；完整核算逻辑由 TL-T02 实现。
export interface Usage {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  reasoning: number;
}

// ---------------------------------------------------------------------------
// type 鉴别状态机：合法转移表
//   user → assistant
//   assistant → tool_result
//   assistant → subagent_boundary
//   tool_result → assistant
// root（无前驱）可为 user | assistant | system | subagent_boundary。
// 非法转移 → orphan/断裂，verifyTransitions 报告。
// ---------------------------------------------------------------------------
const LEGAL_TRANSITIONS: Record<TranscriptNode["type"], TranscriptNode["type"][]> = {
  user: ["assistant"],
  assistant: ["tool_result", "subagent_boundary", "user"],
  system: ["user", "assistant"],
  tool_result: ["assistant", "user", "tool_result", "subagent_boundary"],
  subagent_boundary: ["assistant", "user", "subagent_boundary"],
};

/**
 * 校验节点序列的 type 转移合法性（状态机）。
 * 返回非法转移处的后继节点 uuid 列表（即"状态机孤儿"）。
 * 不解析 content；只看节点级 type。
 */
export function verifyTransitions(
  nodes: TranscriptNode[],
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  // 按 timestamp 排序保证顺序稳定（同 session 内落盘顺序 = append 顺序）
  const ordered = [...nodes].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
  let prev: TranscriptNode["type"] | null = null;
  for (const n of ordered) {
    if (prev !== null) {
      const allowed: TranscriptNode["type"][] = LEGAL_TRANSITIONS[prev];
      if (!allowed.includes(n.type)) {
        violations.push(n.uuid);
      }
    }
    prev = n.type;
  }
  return { ok: violations.length === 0, violations };
}

/**
 * orphaned tool_use_id 校验（spec 配对契约）：
 *   - assistant 节点的 toolUseId 声明本 turn 发出的 tool_use id
 *   - tool_result 节点的 toolUseId 引用该 id
 *   - 任何 tool_result 的 toolUseId 未在 assistant 节点中声明 → orphan
 * 同时校验 parentUuid 存在性（非 root 节点父须在集合内）。
 */
export function findOrphans(
  nodes: TranscriptNode[],
): { ok: boolean; orphans: string[] } {
  const byUuid = new Map<string, TranscriptNode>();
  for (const n of nodes) byUuid.set(n.uuid, n);

  const orphans: string[] = [];

  // parentUuid 存在性
  for (const n of nodes) {
    if (n.parentUuid !== null && !byUuid.has(n.parentUuid)) {
      if (!orphans.includes(n.uuid)) orphans.push(n.uuid);
    }
  }

  // tool_use_id 配对
  const declared = new Set<string>();
  for (const n of nodes) {
    if (n.type === "assistant" && n.toolUseId !== undefined) {
      declared.add(n.toolUseId);
    }
  }
  for (const n of nodes) {
    if (n.type === "tool_result" && n.toolUseId !== undefined) {
      if (!declared.has(n.toolUseId)) {
        if (!orphans.includes(n.uuid)) orphans.push(n.uuid);
      }
    }
  }

  return { ok: orphans.length === 0, orphans };
}
