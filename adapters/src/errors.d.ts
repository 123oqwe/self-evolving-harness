// @harness/adapters · 错误类类型声明（对应 errors.cjs 运行时实现）。
//
// 运行时 class 定义在 errors.cjs（native CJS），port.ts 经
// `createRequire(import.meta.url)("./errors.cjs") as typeof import("./errors")`
// 取实例；本文件提供 TS 类型，使 ESM 消费者保留 `readonly id`/`readonly
// stagingSha`/`readonly path` 字段类型与 `new`/`instanceof` 语义。

export declare class SubstrateNotFoundError extends Error {
  readonly id: string;
  constructor(id: string);
}

export declare class UnknownStagingError extends Error {
  readonly stagingSha: string;
  constructor(stagingSha: string);
}

export declare class StaticCoreWriteForbiddenError extends Error {
  readonly path: string;
  constructor(path: string);
}
