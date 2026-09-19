/**
 * L0S-T01 — Hands 信任域 facade
 *
 * 永不持有真实凭据；经 SentinelResolver 取 sentinel 占位符（T04b 落地）。
 * MVP 阶段 hands 经注入的 CmdRunner 执行 cmd_run action；brain 仅向 hands 传递
 * 已 strip 真实 secret 的 sandbox env（裁决 L0S-T01-A2 vault 解释）。
 */

import type { Action, Observation } from "../actions/protocol.js";
import type { CmdRunner } from "./brain.js";

export interface HandsDomain {
  /** 永不持有真实凭据；经 SentinelResolver 取 sentinel 占位符 */
  execute(action: Action, ctx: {
    env: Record<string, string>;
    cwd: string;
  }): Promise<Observation>;
}

/** hands 崩溃 / 不可用时返回的 error 字面量。 */
export const HANDS_UNAVAILABLE = "hands_unavailable" as const;
/** 不支持的 action 类型。 */
export const UNSUPPORTED_ACTION = "unsupported_action" as const;

/**
 * 创建 hands 域 facade。hands 仅持有 CmdRunner（命令执行器），不持有真实凭据。
 */
export function createHands(runner: CmdRunner): HandsDomain {
  return {
    async execute(action: Action, ctx: {
      env: Record<string, string>;
      cwd: string;
    }): Promise<Observation> {
      if (action.type !== "cmd_run") {
        return {
          tool_use_id: action.tool_use_id,
          content: "",
          exit_code: 1,
          stdout: "",
          stderr: "",
          error: UNSUPPORTED_ACTION,
        };
      }

      try {
        const res = await runner.run(action.command, {
          env: ctx.env,
          cwd: ctx.cwd,
          timeout_ms: action.timeout_ms,
        });
        // 裁决 L0S-T01-A8：cmd_run 的 content === stdout（MVP 直接透传）
        return {
          tool_use_id: action.tool_use_id,
          content: res.stdout,
          exit_code: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
        };
      } catch {
        return {
          tool_use_id: action.tool_use_id,
          content: "",
          exit_code: 1,
          stdout: "",
          stderr: "",
          error: HANDS_UNAVAILABLE,
        };
      }
    },
  };
}
