// CE-T01a: 本包未引入 @types/node 依赖（禁新增依赖；@types/node 仅在 sibling 包
// @harness/telemetry 中声明，未 hoist 到本包可见范围）。此处为本包用到的两个
// Node 内置模块提供最小自包含类型桩，仅供 `tsc --noEmit` 通过；运行时由 Node 20+
// 原生提供（vitest 已验证）。非转发桥/非 symlink，仅本地类型声明。

declare module "node:fs" {
  export function readFileSync(
    path: string,
    options: string,
  ): string;
}

declare module "node:crypto" {
  export interface Hash {
    update(data: string): Hash;
    digest(encoding: string): string;
  }
  export function createHash(algorithm: string): Hash;
}
