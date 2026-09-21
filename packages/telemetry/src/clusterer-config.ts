// TL-T08: clusterer_config loader（Clio 式失败聚类 v0）
//
// clusterer_config.yaml 含 embedding_model / k / min_cluster_size / label_schema
// （research §1.4 (b)）。项目 scope 不可覆写（防 prompt-injected 仓库改聚类参数
// 喂脏 insight，PRD §11.2）。
//
// 自研极简 YAML 解析（不引入 js-yaml 依赖）：仅支持本 config 的结构
// （flat `key: value` + label_schema 嵌套 list）。与 T06/T07 解析风格一致。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ProjectScopeOverrideRejectedError } from "./budget-policy";

// ---------------------------------------------------------------------------
// 默认 config 路径（bundled config 层，git-versioned，agent 运行时只读）
// ---------------------------------------------------------------------------
const DEFAULT_CLUSTERER_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "clusterer_config.yaml",
);

// ---------------------------------------------------------------------------
// 类型（static-core 接口契约，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

/** clusterer_config.yaml 接口契约（ERRATA-w2plus TL-12 裁决）。 */
export interface ClustererConfig {
  embedding_model: string;
  /** 聚类数；'auto' 表示自动选 k（silhouette 最大化）。 */
  k: number | "auto";
  min_cluster_size: number;
  label_schema: string[];
}

// ---------------------------------------------------------------------------
// 极简 YAML 解析（clusterer_config.yaml 结构）
// 支持：flat `key: value` + `label_schema:` 下 `- item` 列表 + 注释 + 空行。
// ---------------------------------------------------------------------------

function parseClustererYaml(content: string): ClustererConfig {
  const out: ClustererConfig = {
    embedding_model: "",
    k: 2,
    min_cluster_size: 1,
    label_schema: [],
  };

  const lines = content.split(/\r?\n/);
  let inLabelSchema = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    // label_schema list 项：`  - xxx`
    if (inLabelSchema && line.startsWith("-")) {
      const item = line.slice(1).trim().replace(/^["']|["']$/g, "");
      if (item.length > 0) out.label_schema.push(item);
      continue;
    }

    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    switch (key) {
      case "embedding_model": {
        out.embedding_model = value.replace(/^["']|["']$/g, "");
        inLabelSchema = false;
        break;
      }
      case "k": {
        if (value === "auto" || value === "'auto'" || value === '"auto"') {
          out.k = "auto";
        } else {
          const n = Number(value);
          out.k = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 2;
        }
        inLabelSchema = false;
        break;
      }
      case "min_cluster_size": {
        const n = Number(value);
        out.min_cluster_size = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
        inLabelSchema = false;
        break;
      }
      case "label_schema": {
        // value 可为空（下一行起 `- item`）或内联
        out.label_schema = [];
        inLabelSchema = true;
        if (value.length > 0) {
          // 内联 list：`label_schema: [a, b]` 或 `label_schema: a, b`
          const inline = value
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter((s) => s.length > 0);
          out.label_schema = inline;
          if (inline.length > 0) inLabelSchema = false;
        }
        break;
      }
      default:
        // 未知字段忽略（向前兼容）
        inLabelSchema = false;
        break;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 工厂 / 加载器
// ---------------------------------------------------------------------------

export interface LoadClustererConfigOpts {
  configPath?: string;
  /** 项目 scope 覆写路径 —— 永远拒绝（项目 scope 不可覆写）。 */
  projectScopePath?: string;
}

/** 读取并解析 clusterer_config.yaml 为 ClustererConfig。 */
export function loadClustererConfig(
  opts: LoadClustererConfigOpts = {},
): ClustererConfig {
  if (opts.projectScopePath !== undefined) {
    throw new ProjectScopeOverrideRejectedError(
      "project scope cannot override clusterer_config.yaml",
    );
  }
  const configPath = opts.configPath ?? DEFAULT_CLUSTERER_CONFIG_PATH;
  const content = readFileSync(configPath, "utf8");
  return parseClustererYaml(content);
}

/** 仅暴露解析函数供测试/复用（不读盘）。 */
export function parseClustererConfig(content: string): ClustererConfig {
  return parseClustererYaml(content);
}
