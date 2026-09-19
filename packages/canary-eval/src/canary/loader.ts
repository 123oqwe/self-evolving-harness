// CE-T01a: canary 集加载（frozen release，agent 只读）+ SWE-rebench 风格去污染。
//
// 接口签名严格对齐 execution/canary-eval/TASKS.md §CE-T01a + ERRATA-w2plus 裁决：
//   export function loadCanary(manifestPath: string): CanaryManifest;
//   export function isDecontaminated(task: CanaryTask, trainSet: Trajectory[]): boolean;
//
// 去污染判据（ERRATA-w2plus CE-02）：“repo 结构定位命中”= 仓库名相等
// （`task.repo === traj.repo`）；不做 repo-snapshot 文件树指纹比对（V1 才引入）。
//
// YAML 解析：canary manifest schema 扁平（顶层 version/sha256/frozenAt/agentVisible +
// tasks[] 列表，每任务 id/repo/verify/expectedExit/decontaminated/frozenInRelease）。
// 本仓未引入 yaml 依赖（禁新增依赖），故实现针对该 schema 的最小确定性解析器：
// 不做通用 YAML，只精确反序列化本 schema，字段名/嵌套与 TS 接口一一对应（禁止 alias）。

import { readFileSync } from "node:fs";
import type { CanaryManifest, CanaryTask, Trajectory } from "./types.js";

/**
 * 判定单条 canary 任务是否去污染（repo 结构定位不命中 trainSet）。
 *
 * “repo 结构定位命中”= 仓库名相等：trainSet 中任一轨迹的 `repo === task.repo`
 * 即视为污染（模型可能靠记忆而非调试能力通过 → strict-improvement / McNemar
 * 判定建立在 contamination overhang 上）。
 *
 * @returns true 表示干净（不命中），可进 manifest；false 表示污染，须拒绝。
 */
export function isDecontaminated(
  task: CanaryTask,
  trainSet: Trajectory[],
): boolean {
  return !trainSet.some((traj) => traj.repo === task.repo);
}

/**
 * 加载 canary manifest（frozen release）。
 *
 * 反序列化 yaml schema → CanaryManifest；强制不变量 `agentVisible === false`
 * （违反 → throw，错误路径：agent 尝试置可见即拒绝）。filesystem ACL EPERM 由
 * L0S-T03 保证，CE 侧只校验该不变量。
 *
 * @throws 当 manifest 声明 `agentVisible: true`（不变量违反）或 schema 反序列化失败。
 */
export function loadCanary(manifestPath: string): CanaryManifest {
  const text = readFileSync(manifestPath, "utf8");
  return parseCanaryManifest(text);
}

// ---------------------------------------------------------------------------
// 最小确定性 YAML 解析器（仅 canary manifest schema）
// ---------------------------------------------------------------------------

type Scalar = string | number | boolean;

function parseScalar(raw: string): Scalar {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return "";
  // 整数（含负数）
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

interface RawTask {
  id: string;
  repo: string;
  verify: string;
  expectedExit: number;
  decontaminated: boolean;
  frozenInRelease: string;
}

const TASK_FIELDS = new Set([
  "id",
  "repo",
  "verify",
  "expectedExit",
  "decontaminated",
  "frozenInRelease",
]);

/**
 * 解析 canary manifest 文本。schema：
 *   version: <str>
 *   sha256: <str>
 *   frozenAt: <str>
 *   agentVisible: <bool>            # 必须为 false
 *   tasks:
 *     - id: <str>
 *       repo: <str>
 *       verify: "<str>"
 *       expectedExit: 0
 *       decontaminated: <bool>
 *       frozenInRelease: <str>
 */
function parseCanaryManifest(text: string): CanaryManifest {
  const lines = text.split(/\r?\n/);

  let version: string | undefined;
  let sha256: string | undefined;
  let frozenAt: string | undefined;
  let agentVisibleRaw: Scalar | undefined;
  let agentVisibleSeen = false;
  const tasks: RawTask[] = [];

  let i = 0;
  let inTasks = false;
  let current: RawTask | null = null;

  while (i < lines.length) {
    const line = lines[i]!;
    // 跳过空行与注释
    if (/^\s*(#.*)?$/.test(line)) {
      i++;
      continue;
    }

    const topMatch = /^(?!\s)([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(line);
    if (topMatch && !inTasks) {
      const key = topMatch[1]!;
      const val = topMatch[2] ?? "";
      if (key === "tasks") {
        inTasks = true;
        current = null;
      } else if (key === "version") {
        version = String(parseScalar(val));
      } else if (key === "sha256") {
        sha256 = String(parseScalar(val));
      } else if (key === "frozenAt") {
        frozenAt = String(parseScalar(val));
      } else if (key === "agentVisible") {
        agentVisibleRaw = parseScalar(val);
        agentVisibleSeen = true;
      }
      i++;
      continue;
    }

    if (inTasks) {
      // 列表项起始：`  - id: ...`（任意缩进 + `- `）
      const itemMatch = /^(\s*)-\s+(.*)$/.exec(line);
      if (itemMatch) {
        const rest = itemMatch[2] ?? "";
        current = {
          id: "",
          repo: "",
          verify: "",
          expectedExit: 0,
          decontaminated: false,
          frozenInRelease: "",
        };
        // 行内 `- key: value`
        const inline = /^([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(rest);
        if (inline) {
          assignTaskField(current, inline[1]!, inline[2] ?? "");
        }
        tasks.push(current);
        i++;
        continue;
      }

      // 当前任务的续行（缩进更深，`    key: value`）
      const contMatch = /^(\s+)([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(line);
      if (contMatch && current) {
        assignTaskField(current, contMatch[2]!, contMatch[3] ?? "");
        i++;
        continue;
      }

      // 退出 tasks 块：回到顶层非缩进行
      if (/^\S/.test(line)) {
        inTasks = false;
        current = null;
        // 不 consume，重新作为顶层处理
        continue;
      }

      // 其它缩进行（多行值等）忽略
      i++;
      continue;
    }

    i++;
  }

  if (!agentVisibleSeen) {
    throw new Error("canary manifest missing required field: agentVisible");
  }
  if (agentVisibleRaw !== false) {
    // 不变量违反：agentVisible 非 false → 拒绝（错误路径）
    throw new Error(
      `canary manifest invariant violated: agentVisible must be false (got ${String(agentVisibleRaw)})`,
    );
  }
  if (version === undefined) throw new Error("canary manifest missing field: version");
  if (sha256 === undefined) throw new Error("canary manifest missing field: sha256");
  if (frozenAt === undefined) throw new Error("canary manifest missing field: frozenAt");

  const canaryTasks: CanaryTask[] = tasks.map((t) => {
    if (t.expectedExit !== 0) {
      throw new Error(
        `canary task ${t.id}: expectedExit must be 0 (got ${t.expectedExit})`,
      );
    }
    return {
      id: t.id,
      repo: t.repo,
      verify: t.verify,
      expectedExit: 0,
      decontaminated: t.decontaminated,
      frozenInRelease: t.frozenInRelease,
    };
  });

  return {
    version,
    sha256,
    frozenAt,
    tasks: canaryTasks,
    agentVisible: false,
  };
}

function assignTaskField(task: RawTask, key: string, rawVal: string): void {
  if (!TASK_FIELDS.has(key)) return;
  const val = parseScalar(rawVal);
  switch (key) {
    case "id":
      task.id = String(val);
      break;
    case "repo":
      task.repo = String(val);
      break;
    case "verify":
      task.verify = String(val);
      break;
    case "expectedExit":
      task.expectedExit = typeof val === "number" ? val : Number(val);
      break;
    case "decontaminated":
      task.decontaminated = val === true;
      break;
    case "frozenInRelease":
      task.frozenInRelease = String(val);
      break;
    default:
      break;
  }
}

// 类型重导出（CE-T03/CE-T05 等后续任务经 @harness/canary-eval 导入 Trajectory）
export type { CanaryManifest, CanaryTask, Trajectory } from "./types.js";
