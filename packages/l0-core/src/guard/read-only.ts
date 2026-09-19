// L0C-T11 · static-core runtime read-only enforcement.
//
// Spec: execution/L0-core/TASKS.md §L0C-T11 (ERRATA-amended).
//
// Application-layer interception: an agent process has no write permission to
// the static-core subtrees. Attempts to write → EPERM. This is layered on top
// of (not a replacement for) the L0S-T02/T03 OS-level sandbox — both layers
// must hold.
//
// Path resolution baseline = process.cwd() (the repo root when verify.sh A.3
// dispatches `pnpm vitest run tests/L0C/...` from the repo root).
// STATIC_CORE_DIRS are repo-root-relative; isStaticCorePath resolves the
// candidate path against process.cwd() and checks subtree containment using
// path.sep boundaries (defeats prefix-collision attacks like `l0-core-evil`).

import * as path from "node:path";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * The three protected static-core subtrees, expressed as repo-root-relative
 * paths. CE-T01a's on-disk canary paths are coupled to this list — if CE
 * changes its layout it must sync here (ERRATA §5).
 */
export const STATIC_CORE_DIRS = [
  "packages/l0-core",
  "packages/canary-eval/src/verifier",
  "packages/canary-eval/canary",
] as const;

// ---------------------------------------------------------------------------
// Subtree containment
// ---------------------------------------------------------------------------

/**
 * True iff `absPath` resolves into one of the STATIC_CORE_DIRS subtrees.
 *
 * Both the candidate and each registered dir are resolved against
 * process.cwd() (the repo root). Subtree match requires the candidate to
 * equal the dir root OR be a descendant — enforced with path.sep boundaries
 * so that `packages/l0-core-evil/x` is NOT treated as a child of
 * `packages/l0-core`.
 */
export function isStaticCorePath(absPath: string): boolean {
  const cwd = process.cwd();
  const resolvedTarget = path.resolve(cwd, absPath);
  for (const dir of STATIC_CORE_DIRS) {
    const dirRoot = path.resolve(cwd, dir);
    if (isSubtree(resolvedTarget, dirRoot)) {
      return true;
    }
  }
  return false;
}

/**
 * True iff `target` equals `dirRoot` or lives beneath it. Uses path.relative
 * + a leading-segment check rather than string startsWith, so prefix-collision
 * siblings (`l0-core-evil`) are correctly rejected.
 */
function isSubtree(target: string, dirRoot: string): boolean {
  if (target === dirRoot) {
    return true;
  }
  const rel = path.relative(dirRoot, target);
  if (rel === "") {
    return true;
  }
  // path.relative returns a path starting with ".." (or, on Windows, a drive
  // spec / "..") when target is outside dirRoot. A contained descendant
  // yields a rel like "src/transcript/turn.ts" with no leading ".." segment.
  // Reject anything that escapes upward, including ".."-prefixed segments.
  return rel !== ".." && !rel.startsWith(".." + path.sep);
}

// ---------------------------------------------------------------------------
// Write interception
// ---------------------------------------------------------------------------

/**
 * Throws an EPERM error (code === "EPERM") if `absPath` resolves into a
 * static-core subtree. No-op otherwise (the write is permitted by this layer;
 * OS-level sandbox may still block independently).
 */
export function assertWritable(absPath: string): void {
  if (isStaticCorePath(absPath)) {
    throw Object.assign(
      new Error(`EPERM: static-core path is read-only: ${absPath}`),
      { code: "EPERM" }
    );
  }
}

// ---------------------------------------------------------------------------
// Agent-process wrapper
// ---------------------------------------------------------------------------

/**
 * Shape of an agent process that exposes a writePath hook. enforceReadOnly
 * wraps it in place: subsequent calls go through assertWritable.
 */
export interface ReadOnlyAgentProcess {
  writePath: (p: string) => Promise<void>;
}

/**
 * Wraps `agentProcess.writePath` in place so that writes targeting a
 * static-core path reject with EPERM (the original writePath is never
 * invoked for blocked paths) and all other paths pass through unchanged.
 *
 * Returns a Promise that resolves once the wrap is installed. The wrap is
 * synchronous in effect; the Promise form matches the spec signature.
 */
export async function enforceReadOnly(
  agentProcess: ReadOnlyAgentProcess
): Promise<void> {
  const originalWritePath = agentProcess.writePath.bind(agentProcess);
  agentProcess.writePath = async (p: string): Promise<void> => {
    assertWritable(p);
    await originalWritePath(p);
  };
}
