// TL-T02: 版本化价目表 loader（price_table@<version>.json）
//
// static-core 边界：价目表 token→price 映射仅 version 可升级（离线元循环改写），
// 运行时只读。禁止静默用默认价 —— model/version 查不到必须抛 PriceNotFoundError
// （spec §TL-T02 错误路径）。
//
// 价目表文件命名约定：`price_table@<version>.json`，version 从文件名抽取
// （如 `price_table@v1.json` → 'v1'）。每个文件结构：
//   { version: string, unit: 'USD_per_million_tokens', prices: { [model]: SubtypePrices } }
// SubtypePrices = { input, output, cache_read, cache_creation, reasoning }（$/M token）。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 默认 config 目录：packages/telemetry/config（git-versioned config 层）
// ---------------------------------------------------------------------------
const DEFAULT_PRICE_TABLE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
);

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** model/version 在价目表查不到 → 抛此错（禁止静默用默认价）。
 *  error message 含类名 + model + version，同时支持 instanceof 与正则匹配。 */
export class PriceNotFoundError extends Error {
  constructor(model: string, version: string) {
    super(
      `PriceNotFoundError: model '${model}' not found in price_table@${version}`,
    );
    this.name = "PriceNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 五子类型单价（$/M token）。 */
export interface SubtypePrices {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  reasoning: number;
}

interface PriceTableFile {
  version: string;
  unit: string;
  prices: Record<string, SubtypePrices>;
}

// ---------------------------------------------------------------------------
// 版本化价目表注册表：支持多版本并存查询
// ---------------------------------------------------------------------------

export interface PriceTableRegistry {
  /** 取某版本某 model 的五子类型单价；查不到抛 PriceNotFoundError。 */
  getPrice(version: string, model: string): SubtypePrices;
  /** 当前已注册的全部版本列表。 */
  versions(): string[];
  /** 默认版本（factory 加载的版本；用于 recordTurn 隐式上下文）。 */
  defaultVersion(): string;
}

function parsePriceTableFile(content: string, fileName: string): PriceTableFile {
  let parsed: PriceTableFile;
  try {
    parsed = JSON.parse(content) as PriceTableFile;
  } catch (e) {
    throw new Error(
      `PriceTable file '${fileName}' is not valid JSON: ${(e as Error).message}`,
    );
  }
  if (
    typeof parsed.version !== "string" ||
    typeof parsed.prices !== "object" ||
    parsed.prices === null
  ) {
    throw new Error(
      `PriceTable file '${fileName}' missing 'version' or 'prices' fields`,
    );
  }
  return parsed;
}

/** 从文件名 `price_table@<version>.json` 抽取 version。 */
function versionFromFileName(fileName: string): string | null {
  const m = fileName.match(/^price_table@(.+)\.json$/i);
  return m && m[1] ? m[1] : null;
}

/** 加载目录下所有 `price_table@<version>.json`，返回 registry。
 *  - dir 不存在或无匹配文件 → 抛错（价目表是 static-core 必需件，不可缺）。
 *  - defaultVersion = 文件名 version 字典序最大者（v1/v2 → v2）；
 *    单文件时即该 version。 */
export function loadPriceTableRegistry(
  dir: string = DEFAULT_PRICE_TABLE_DIR,
): PriceTableRegistry {
  if (!existsSync(dir)) {
    throw new Error(`PriceTable dir not found: ${dir}`);
  }
  const files = readdirSync(dir).filter((f) =>
    /^price_table@.+\.json$/i.test(f),
  );
  if (files.length === 0) {
    throw new Error(`No price_table@<version>.json found in ${dir}`);
  }

  const byVersion = new Map<string, Record<string, SubtypePrices>>();

  for (const f of files) {
    const ver = versionFromFileName(f);
    if (ver === null) continue;
    const content = readFileSync(join(dir, f), "utf8");
    const parsed = parsePriceTableFile(content, f);
    // 以文件名 version 为权威 key（防文件内 version 字段与文件名不一致）
    byVersion.set(ver, parsed.prices);
  }

  if (byVersion.size === 0) {
    throw new Error(`No valid price_table versions parsed in ${dir}`);
  }

  // 默认版本：字典序最大（'v2' > 'v1'）；单文件即唯一 version
  const sortedVersions = [...byVersion.keys()].sort();
  const defVer = sortedVersions[sortedVersions.length - 1]!;

  return {
    getPrice(version: string, model: string): SubtypePrices {
      const table = byVersion.get(version);
      if (table === undefined) {
        throw new PriceNotFoundError(model, version);
      }
      const prices = table[model];
      if (prices === undefined) {
        throw new PriceNotFoundError(model, version);
      }
      return prices;
    },
    versions(): string[] {
      return [...byVersion.keys()];
    },
    defaultVersion(): string {
      return defVer;
    },
  };
}
