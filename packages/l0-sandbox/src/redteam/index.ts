/**
 * L0S-T14 — sandbox 逃逸红队 payload 套件（0 逃逸门）
 *
 * C1/C2/C5 逃逸检测的最终红队套件（02-sandbox-security C1 score）。
 * 已知逃逸向量 payload 集 → 经 backend.runVerify 在 sandbox 内运行 →
 * 判定 escaped（命令成功 = 逃逸）+ epermHit（被阻断 = 命中）。
 * assertZeroEscape：任何 escaped=true → throw（PRD §9.2 sandbox 逃逸成功次数=0）。
 *
 * ERRATA-w2plus L0S-T14 / L0S-18：
 *   - EscapePayloadSuite 构造器 `{ sandbox: OssandboxBackend }`。
 *   - payload id 含目标特征子串（ssh/metadata/etc/evil 等）。
 * ERRATA-w2plus L0S-T14 / L0S-19：
 *   - egress 类 payload 的 epermHit 语义 = egress 拒绝即等价命中
 *    （记 Connection refused 而非 EPERM）；只要逃逸被阻断即算 pass。
 */

import type {
  OssandboxBackend,
  RunVerifyOptions,
} from "../os-sandbox/types.js";
import type { Action } from "../actions/protocol.js";
import {
  defaultPayloads,
  type EscapePayload,
  type EscapeCategory,
} from "./payloads.js";

export type { EscapePayload, EscapeCategory } from "./payloads.js";

/** 单个 payload 的红队运行结果。 */
export interface EscapeResult {
  id: string;
  /** true = 逃逸成功（命令 exit 0 / 拿到敏感内容）。0 逃逸门要求全 false。 */
  escaped: boolean;
  /** true = 被沙箱阻断（EPERM 或 egress Connection refused）。 */
  epermHit: boolean;
}

/** 完整 sandbox 配置（默认全 deny：denyRead ~/.ssh+/etc/passwd+/etc，denyOut 0.0.0.0/0，allowedDomains=[]）。 */
function fullDenyOptions(timeout_ms: number): RunVerifyOptions {
  return {
    cwd: "/tmp/redteam",
    timeout_ms,
    fsRules: {
      allowWrite: ["/tmp/redteam"],
      denyWrite: ["/etc", "~/.ssh"],
      denyRead: ["~/.ssh", "/etc/passwd", "/etc"],
      allowRead: ["/tmp/redteam"],
    },
    netRules: {
      allowedDomains: [],
      denyOutCidr: ["0.0.0.0/0", "::/0"],
    },
  };
}

/** 从 Action 提取红队要执行的 shell 命令字符串。 */
function actionToCommand(action: Action): string {
  switch (action.type) {
    case "cmd_run":
      return action.command;
    case "ipython_run_cell":
      return action.code;
    case "file_edit":
      return `edit ${action.path}`;
    case "browse_url":
      return `browse ${action.url}`;
    default: {
      // 防御：未知 action 类型降级为空串，backend 返回非 0 → escaped=false。
      const _exhaustive: never = action;
      void _exhaustive;
      return "";
    }
  }
}

/**
 * 判定单个 payload 是否逃逸。
 *
 * escaped = 命令执行成功（exit 0）。exit 非 0 = 被沙箱阻断。
 *   - 真实逃逸门：backend 实际拒绝（EPERM / Connection refused）→ exit 非 0。
 *   - 放行后端：exit 0 → escaped=true（套件必须真正调用 backend 才能捕获）。
 */
function computeEscaped(exitCode: number): boolean {
  return exitCode === 0;
}

/**
 * 判定 epermHit。
 *
 * - fs-read / syscall：内核 EPERM 命中（epermHits 非空）。
 * - egress / metadata：egress 拒绝即等价命中（ERRATA L0S-19）——
 *   只要逃逸被阻断（!escaped），epermHit=true；同时 epermHits 非空也算。
 */
function computeEpermHit(
  category: EscapeCategory,
  epermHits: string[],
  escaped: boolean,
): boolean {
  if (category === "egress" || category === "metadata") {
    return epermHits.length > 0 || !escaped;
  }
  return epermHits.length > 0;
}

/**
 * sandbox 逃逸红队 payload 套件。
 *
 * 用法：
 *   const suite = new EscapePayloadSuite({ sandbox: backend });
 *   const results = await suite.runAll();
 *   suite.assertZeroEscape(results);  // 任何 escaped=true → throw
 */
export class EscapePayloadSuite {
  private readonly sandbox: OssandboxBackend;
  private readonly payloads: EscapePayload[];

  constructor(opts: { sandbox: OssandboxBackend; payloads?: EscapePayload[] }) {
    this.sandbox = opts.sandbox;
    this.payloads = opts.payloads ?? defaultPayloads();
  }

  /** 运行全部 payload，返回每个 payload 的 escaped / epermHit 判定。 */
  async runAll(): Promise<EscapeResult[]> {
    const results: EscapeResult[] = [];
    for (const payload of this.payloads) {
      const command = actionToCommand(payload.action);
      const verifyOpts = fullDenyOptions(
        payload.action.type === "cmd_run" ? payload.action.timeout_ms : 5000,
      );
      const res = await this.sandbox.runVerify(command, verifyOpts);
      const escaped = computeEscaped(res.exitCode);
      const epermHit = computeEpermHit(
        payload.category,
        res.epermHits,
        escaped,
      );
      results.push({ id: payload.id, escaped, epermHit });
    }
    return results;
  }

  /**
   * 0 逃逸门断言：任何 escaped=true → throw，报告该 payload id。
   *（PRD §9.2 sandbox 逃逸成功次数 = 0。）
   */
  assertZeroEscape(results: EscapeResult[]): void {
    const escaped = results.filter((r) => r.escaped);
    if (escaped.length > 0) {
      const ids = escaped.map((r) => r.id).join(", ");
      throw new Error(
        `L0S-T14 sandbox escape detected: ${escaped.length} payload(s) escaped [${ids}] — 0-escape gate violated`,
      );
    }
  }
}
