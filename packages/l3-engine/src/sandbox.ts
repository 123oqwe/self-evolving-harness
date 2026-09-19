// L3-engine · Sandbox port + STATIC_CORE_PATHS shared constant.
//
// Spec: execution/L3-engine/TASKS.md §L3-T01 (Sandbox port), §2 (Sandbox port
// 契约). The Sandbox port mirrors L0S-T02 `OssandboxBackend.runVerify`
// (VerifyResult shape) and delegates `assertReadonly` to L0C-T11
// `STATIC_CORE_DIRS` / `isStaticCorePath` (application-layer read-only, not
// the L0S kernel layer).
//
// STATIC_CORE_PATHS references the L0C shared constant — it is NOT redefined
// here (ERRATA: missing the `/src/` prefix on the verifier path would open a
// security-contract hole, so L3 must reuse L0C's canonical list verbatim).

import { STATIC_CORE_DIRS } from "@harness/l0-core";

// ---------------------------------------------------------------------------
// Security event (recorded by the breaker into sandbox.log)
// ---------------------------------------------------------------------------

export interface SecurityEvent {
  kind: string;
  path: string;
  reason: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// VerifyResult — mirrors L0S-T02 OssandboxBackend.runVerify return shape
// ---------------------------------------------------------------------------

export interface VerifyResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  epermHits: string[];
}

// ---------------------------------------------------------------------------
// Sandbox port (L3 side; MVP satisfied by FakeSandbox, real OS sandbox = L0S-T02)
// ---------------------------------------------------------------------------

export interface Sandbox {
  runVerify(
    cmd: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<VerifyResult>;
  /** Throws when any of `paths` is writable. `paths` = L0C-T11 STATIC_CORE_DIRS. */
  assertReadonly(paths: string[]): Promise<void>;
  log: { securityEvents: SecurityEvent[] };
}

// ---------------------------------------------------------------------------
// STATIC_CORE_PATHS — same source as L0C-T11 STATIC_CORE_DIRS (not redefined).
// Frozen at module load so no optimizer can mutate the route table's protected
// set at runtime (breaker clause: off→on flip attempts are rejected).
// ---------------------------------------------------------------------------

const _STATIC_CORE_PATHS: string[] = [...STATIC_CORE_DIRS];
Object.freeze(_STATIC_CORE_PATHS);
export const STATIC_CORE_PATHS: string[] = _STATIC_CORE_PATHS;
