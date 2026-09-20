// L3-T08 (REFACTOR step): git command builder for rollback paths.
//
// Spec: execution/L3-engine/TASKS.md §L3-T08 (REFACTOR — "git 命令封装抽
// packages/l3-engine/src/retain/git-client.ts（L1/L2 回滚复用）").
//
// This is a pure command-string builder. It does NOT execute git — the actual
// `git checkout` execution body is owned exclusively by CE-T06 `src/revert.ts`
// (static-core, single ownership). L1/L2 rollback paths may reuse this helper
// to build the canonical rollback command before handing it to their own
// sandbox/revert executor.

/**
 * Build the canonical one-command rollback (`git checkout <sha>`) per PRD §5.1
 * ("最坏情况 1 命令 git checkout 回滚").
 */
export function buildRollbackCommand(toSha: string): string {
  if (!toSha || typeof toSha !== "string") {
    throw new TypeError("buildRollbackCommand: toSha must be a non-empty string");
  }
  return `git checkout ${toSha}`;
}
