/**
 * L0S-T03 — filesystem 隔离（barrel）
 *
 * 路径前缀规则 + narrower-allow-reopens-wider-deny + worktree baseline。
 * FsRules 类型由 os-sandbox（T02）定义；本模块导出 ResolvedFsRules +
 * resolveFsRules + isDenied + createWorktree。
 */

export type { ResolvedFsRules } from "./rules.js";
export { resolveFsRules, isDenied } from "./rules.js";
export { createWorktree } from "./worktree.js";
export type { CreateWorktreeOpts, WorktreeHandle } from "./worktree.js";
