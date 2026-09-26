// @harness/adapters · 错误类（native CJS 定义）。
//
// 这三个错误类定义于 native CJS 文件（非 TS），经 port.ts 的
// `createRequire(import.meta.url)("./errors.cjs")` 取运行时实例——
// 使 vitest/vite-node 环境中 `require("@harness/adapters")`（fake port 走
// vite-node 注入的 createRequire shim）与 ESM `import { SubstrateNotFoundError }
// from "@harness/adapters"`（经 Vite 加载 port.ts）引用**同一** class 对象：
// 两条路径都落到 native `Module._cache[adapters/src/errors.cjs]` 同一条目，
// `instanceof` 跨 require/import 成立。
//
// 类型由 errors.d.ts 提供（TS 经 `import("./errors")` 解析）。

"use strict";

class SubstrateNotFoundError extends Error {
  constructor(id) {
    super(`substrate not found: ${id}`);
    this.name = "SubstrateNotFoundError";
    this.id = id;
  }
}

class UnknownStagingError extends Error {
  constructor(stagingSha) {
    super(`unknown staging sha: ${stagingSha}`);
    this.name = "UnknownStagingError";
    this.stagingSha = stagingSha;
  }
}

class StaticCoreWriteForbiddenError extends Error {
  constructor(path) {
    super(`write forbidden: path is static-core (L3-T01 breaker): ${path}`);
    this.name = "StaticCoreWriteForbiddenError";
    this.path = path;
  }
}

module.exports = {
  SubstrateNotFoundError,
  UnknownStagingError,
  StaticCoreWriteForbiddenError,
};
