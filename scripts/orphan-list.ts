#!/usr/bin/env node
/**
 * L0S-T06 — orphan list CLI 入口（MVP 占位）
 *
 * 用法：`node scripts/orphan-list.ts`
 * 报告 tracked 但未 teardown 的 sandbox（worktree + 进程）。
 *
 * MVP 阶段：运行态 manager 注册表未持久化，CLI 仅打印空报告，供
 * verify.sh 行为门「输出空」断言。V2 由 session log 重水化后接入真实数据。
 */

console.log("no orphans");
