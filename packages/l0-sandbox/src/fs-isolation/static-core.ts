// ISS-18 — static-core read-only at the OS-sandbox layer (true boundary).
//
// These three repo-root-relative subtrees are the same static-core subtrees
// that L0C-T11 protects at the application layer (packages/l0-core/src/guard/
// read-only.ts `STATIC_CORE_DIRS`). l0-sandbox cannot import @harness/l0-core
// (keep L0 packages acyclic + 禁新依赖), so the literals are duplicated
// verbatim here. Any change to L0C's `STATIC_CORE_DIRS` MUST be mirrored here
// — both are pinned by locked tests (L0C-T11 + ISS-18).
//
// Enforcement per backend (consistent across bwrap/seatbelt; none cannot
// enforce → sandboxBypassed=true, closed loop avoids NoneBackend via ISS-05):
//   - seatbelt: `(deny file-write* (subpath <abs>))` → write = EPERM
//   - bwrap:    `--ro-bind <abs> <abs>` re-mounted AFTER the writable
//               `--bind cwd cwd` → write = EROFS/EPERM
//
// Paths are repo-root-relative and resolved against the sandbox `cwd`
// (the repo root when verify dispatches from there, matching L0C-T11's
// process.cwd() baseline). If cwd is NOT the repo root the subtrees do not
// exist and enforcement is a no-op (nothing to protect there).
export const STATIC_CORE_PATHS: readonly string[] = Object.freeze([
  "packages/l0-core",
  "packages/canary-eval/src/verifier",
  "packages/canary-eval/canary",
]);
