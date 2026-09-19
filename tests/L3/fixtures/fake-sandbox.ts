// L3 test fixture — FakeSandbox.
//
// Spec: execution/L3-engine/TASKS.md §L3-T01 (Sandbox port), §1 integration
// scenario two (breaker on static-core write). Mirrors L0S-T02
// `OssandboxBackend.runVerify` shape (`{exitCode, stdout, stderr, epermHits}`)
// and L0C-T11 `STATIC_CORE_DIRS` for assertReadonly.
//
// Configurable behaviours:
//   - `attemptWrite`: a static-core path the sandbox should treat as a
//     writable violation → assertReadonly throws + runVerify returns nonzero
//     exit + epermHits (breaker path). The breaker (runEvolutionLoop) is
//     responsible for pushing the securityEvent; FakeSandbox only signals.
//   - `cmdResults`: cmd-substring → VerifyResult overrides.
//   - default runVerify: exitCode 0, empty epermHits.

import type { Sandbox } from "@harness/l3-engine";
import { STATIC_CORE_DIRS } from "@harness/l0-core";

export interface SecurityEvent {
  kind: string;
  path: string;
  reason: string;
  ts: number;
}

export interface VerifyResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  epermHits: string[];
}

export interface FakeSandboxOptions {
  /** A static-core path the sandbox treats as a writable violation. */
  attemptWrite?: string;
  /** cmd-substring → explicit VerifyResult override. */
  cmdResults?: Record<string, VerifyResult>;
  /** Default stdout for non-matching runVerify calls. */
  defaultStdout?: string;
}

function inStaticCore(target: string): string | null {
  for (const dir of STATIC_CORE_DIRS) {
    if (target === dir || target.startsWith(dir + "/") || target.startsWith(dir)) {
      return dir;
    }
  }
  return null;
}

export class FakeSandbox implements Sandbox {
  public readonly runVerifyCalls: Array<{
    cmd: string;
    opts?: { cwd?: string; timeoutMs?: number };
  }> = [];
  public readonly assertReadonlyCalls: string[][] = [];
  public readonly log: { securityEvents: SecurityEvent[] };
  private readonly attemptWrite?: string;
  private readonly cmdResults: Record<string, VerifyResult>;
  private readonly defaultStdout: string;

  constructor(opts: FakeSandboxOptions = {}) {
    this.attemptWrite = opts.attemptWrite;
    this.cmdResults = opts.cmdResults ?? {};
    this.defaultStdout = opts.defaultStdout ?? "";
    this.log = { securityEvents: [] };
  }

  async runVerify(
    cmd: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<VerifyResult> {
    this.runVerifyCalls.push({ cmd, opts });
    for (const [needle, res] of Object.entries(this.cmdResults)) {
      if (cmd.includes(needle)) return { ...res };
    }
    // If the command writes into a static-core path, flag EPERM + nonzero exit.
    if (this.attemptWrite && cmd.includes(this.attemptWrite)) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `EPERM: write to static-core ${this.attemptWrite}`,
        epermHits: [this.attemptWrite],
      };
    }
    return {
      exitCode: 0,
      stdout: this.defaultStdout,
      stderr: "",
      epermHits: [],
    };
  }

  async assertReadonly(paths: string[]): Promise<void> {
    this.assertReadonlyCalls.push([...paths]);
    if (this.attemptWrite) {
      const hit = inStaticCore(this.attemptWrite);
      if (hit) {
        throw new Error(
          `breaker: static-core path ${hit} is writable (attempt ${this.attemptWrite})`,
        );
      }
    }
  }
}
