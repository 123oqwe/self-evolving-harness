// TL-T09: distillation 选择器（token 效率 + 成功率 + 多样性优先）
//
// 按 token 效率 / 成功率 / 多样性打分，选哪些成功轨迹进训练集/eval dataset
// （teamA：token usage 解释 80% 性能方差，优先 token-efficient，research §1.4 (b)）。
// `distill_selector.yaml` 配置权重与 top_k。
//
// 自研极简 YAML 解析（不引入 js-yaml 依赖）：仅支持本 config 的结构
// （flat `key: value` + `weights:` 嵌套 map）。与 T06/T07/T08 解析风格一致。
//
// ERRATA-w2plus TL-T09 裁决：
//   - 工厂 createDistillSelector(opts: { weights?: {...}; topK?: number; configPath?: string })
//   - topK 默认 5
//   - 单 trajectory score(t) 多样性度量 = embedding 距原点距离（远离基线 = 高多样性）

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// 默认 config 路径（bundled config 层，git-versioned，agent 运行时只读）
// ---------------------------------------------------------------------------
const DEFAULT_DISTILL_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "distill_selector.yaml",
);

// ---------------------------------------------------------------------------
// 类型（static-core 接口契约，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

/** 单条待评估轨迹（spec §TL-T09 接口签名）。 */
export interface Trajectory {
  sessionId: string;
  success: boolean;
  /** 五子类型之和（核算用，非 total_tokens 字段）。 */
  totalTokens: number;
  taskType: string;
  /** 多样性度量用 embedding 向量。 */
  embedding: number[];
}

/** distill 选择器公共接口（spec §TL-T09 接口签名）。 */
export interface DistillSelector {
  /** 选 top-K 成功轨迹（倾向低 token + 高多样性）。 */
  select(trajectories: Trajectory[]): Promise<Trajectory[]>;
  /** 单条轨迹综合分（0-1，按权重加权）。 */
  score(t: Trajectory): number;
}

/** 权重配置（YAML `weights` 节点）。 */
export interface DistillWeights {
  tokenEff: number;
  success: number;
  diversity: number;
}

/** distill_selector.yaml 接口契约。 */
export interface DistillSelectorConfig {
  weights: DistillWeights;
  topK: number;
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** trajectory 缺 embedding，多样性无法度量（spec §TL-T09 错误路径）。 */
export class MissingEmbeddingError extends Error {
  constructor(message = "MissingEmbeddingError: trajectory.embedding is missing (cannot measure diversity)") {
    super(message);
    this.name = "MissingEmbeddingError";
  }
}

// ---------------------------------------------------------------------------
// 极简 YAML 解析（distill_selector.yaml 结构）
// 支持：flat `key: value` + `weights:` 下缩进 `key: value` + 注释 + 空行。
// ---------------------------------------------------------------------------

function parseDistillYaml(content: string): DistillSelectorConfig {
  const out: DistillSelectorConfig = {
    weights: { tokenEff: 0.5, success: 0.3, diversity: 0.2 },
    topK: 5,
  };

  const lines = content.split(/\r?\n/);
  let inWeights = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    // weights 子节点（缩进的 `  token_eff: 0.5`）
    if (inWeights && (key === "token_eff" || key === "success" || key === "diversity")) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        if (key === "token_eff") out.weights.tokenEff = n;
        else if (key === "success") out.weights.success = n;
        else out.weights.diversity = n;
      }
      continue;
    }

    switch (key) {
      case "weights": {
        inWeights = true;
        // 内联 weights 不支持（结构化），仅占位
        break;
      }
      case "top_k": {
        const n = Number(value);
        out.topK = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 5;
        inWeights = false;
        break;
      }
      default:
        // 未知字段忽略（向前兼容）；退出 weights 节点
        inWeights = false;
        break;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 打分（ScoringFunction）
// ---------------------------------------------------------------------------

/** token 效率参考刻度（soft 归一化：tokenEff = 1/(1 + tokens/REF)）。 */
const TOKEN_REF = 50_000;

function embeddingDistanceFromOrigin(embedding: number[]): number {
  let sum = 0;
  for (const v of embedding) sum += v * v;
  return Math.sqrt(sum);
}

function requireEmbedding(t: Trajectory): number[] {
  if (
    !Array.isArray(t.embedding) ||
    t.embedding.length === 0 ||
    t.embedding.some((v) => typeof v !== "number" || Number.isNaN(v))
  ) {
    throw new MissingEmbeddingError();
  }
  return t.embedding;
}

/**
 * 单条轨迹综合分（0-1，按 weights 加权）。
 *
 * - tokenEff：低 token = 高分（1/(1 + tokens/REF)，soft 归一化，跨 taskType 可比）
 * - success：成功 1，失败 0
 * - diversity：embedding 距原点距离归一化（dist/(1+dist)，远离基线 = 高多样性）
 *
 * ERRATA TL-T09：单 trajectory 多样性度量 = embedding 距原点距离。
 */
export function scoreTrajectory(t: Trajectory, weights: DistillWeights): number {
  const embedding = requireEmbedding(t);

  const tokenEff = 1 / (1 + Math.max(0, t.totalTokens) / TOKEN_REF);
  const success = t.success ? 1 : 0;
  const dist = embeddingDistanceFromOrigin(embedding);
  const diversity = dist / (1 + dist);

  const raw =
    weights.tokenEff * tokenEff +
    weights.success * success +
    weights.diversity * diversity;

  // 综合分 clamp 到 [0,1]（防御非单位权重和）
  return Math.min(1, Math.max(0, raw));
}

// ---------------------------------------------------------------------------
// 工厂 / 加载器
// ---------------------------------------------------------------------------

export interface CreateDistillSelectorOpts {
  /** 直接注入权重（覆盖 configPath）。 */
  weights?: DistillWeights;
  /** top-K（覆盖 configPath）。默认 5。 */
  topK?: number;
  /** distill_selector.yaml 路径（缺省读 bundled 默认 config）。 */
  configPath?: string;
}

/** 读取并解析 distill_selector.yaml 为 DistillSelectorConfig。 */
export function loadDistillSelectorConfig(
  opts: { configPath?: string } = {},
): DistillSelectorConfig {
  const configPath = opts.configPath ?? DEFAULT_DISTILL_CONFIG_PATH;
  const content = readFileSync(configPath, "utf8");
  return parseDistillYaml(content);
}

/** 仅暴露解析函数供测试/复用（不读盘）。 */
export function parseDistillSelectorConfig(content: string): DistillSelectorConfig {
  return parseDistillYaml(content);
}

/**
 * 创建 distill 选择器。
 *
 * 优先级：opts.weights / opts.topK > opts.configPath > bundled 默认 config。
 */
export function createDistillSelector(
  opts: CreateDistillSelectorOpts = {},
): DistillSelector {
  // exactOptionalPropertyTypes: 仅在 configPath 实际定义时传入，避免显式 undefined。
  const loadCfg = () =>
    opts.configPath !== undefined
      ? loadDistillSelectorConfig({ configPath: opts.configPath })
      : loadDistillSelectorConfig();
  const cfg =
    opts.weights !== undefined || opts.topK !== undefined
      ? {
          weights: opts.weights ?? { tokenEff: 0.5, success: 0.3, diversity: 0.2 },
          topK: opts.topK ?? loadCfg().topK,
        }
      : loadCfg();

  const weights = cfg.weights;
  const topK = cfg.topK;

  return {
    score(t: Trajectory): number {
      return scoreTrajectory(t, weights);
    },

    async select(trajectories: Trajectory[]): Promise<Trajectory[]> {
      // 错误路径：任一 trajectory 缺 embedding → MissingEmbeddingError
      for (const t of trajectories) requireEmbedding(t);

      // distillation 只选成功轨迹（失败轨迹走 TL-T08 聚类）
      const successOnly = trajectories.filter((t) => t.success);
      if (successOnly.length === 0) return [];

      // 按综合分降序排序，取 top-K（倾向低 token + 高多样性）
      const sorted = successOnly.slice().sort((a, b) => {
        const sa = scoreTrajectory(a, weights);
        const sb = scoreTrajectory(b, weights);
        return sb - sa;
      });

      return sorted.slice(0, Math.max(0, topK));
    },
  };
}
