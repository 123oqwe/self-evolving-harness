// TL-T08: 失败聚类器（Clio-style embedding + clusterer_config）v0
//
// Clio 风格失败聚类把失败 trajectory 分组供根因分析 + insight 蒸馏（喂 L2-T04a
// ExpeL feed）。流程：failed turn → embedding → kmeans 聚类 → 标签。
//
// 设计（ERRATA-w2plus TL-11 裁决）：
//   - FailedTurn = { uuid, content }（最小可 embed 文本）
//   - EmbeddingProvider = { embed(turn): Promise<number[]> }（可 mock，测试确定性）
//   - 工厂 createFailureClusterer({ configPath?, embeddingProvider?, embed?, k?,
//     minClusterSize?, labelSchema?, embeddingModel? }) —— 既支持 configPath 加载
//     clusterer_config.yaml，也支持内联参数（与 ERRATA 裁决签名兼容）。
//
// 聚类算法 v0：kmeans（固定 k）+ min_cluster_size 守卫（小簇归 outliers）；
// k='auto' 用 silhouette 最大化选 k。hdbscan 留 v1 升级。
//
// 自研：不引入 ml-kmeans / density-clustering 依赖（与 T06/T07 自研风格一致）。

import { loadClustererConfig } from "./clusterer-config";
import type { ClustererConfig } from "./clusterer-config";

// ---------------------------------------------------------------------------
// 类型（static-core 接口契约）
// ---------------------------------------------------------------------------

/** 失败 turn 最小可 embed 文本载体（uuid + content）。 */
export interface FailedTurn {
  uuid: string;
  content: string;
}

/** embedding 提供方接口（可 mock，测试用固定向量实现确定性）。 */
export interface EmbeddingProvider {
  embed(turn: FailedTurn): Promise<number[]>;
}

/** 失败簇（供 L2-T04a insight 蒸馏消费）。 */
export interface FailureCluster {
  clusterId: string;
  /** 簇心 embedding（成员向量均值）。 */
  centroid: number[];
  /** 成员 failedTurn uuid 列表。 */
  members: string[];
  /** 失败模式标签（从 label_schema 选）。 */
  label: string;
  /** 代表性示例文本（簇内最接近质心的成员 content），供 insight 蒸馏。 */
  representativeExample: string;
}

/** 失败聚类器接口。 */
export interface FailureClusterer {
  clusterFailures(failedTurns: FailedTurn[]): Promise<FailureCluster[]>;
  labelCluster(cluster: FailureCluster): Promise<string>;
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** embedding 模型不可用 —— 不静默用空 embedding（spec 错误路径）。 */
export class EmbeddingUnavailableError extends Error {
  constructor(message = "embedding provider unavailable") {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// 向量工具
// ---------------------------------------------------------------------------

function vecAdd(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + (b[i] ?? 0));
}

function vecScale(a: number[], s: number): number[] {
  return a.map((v) => v * s);
}

function euclid(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function vecMean(vecs: number[][]): number[] {
  if (vecs.length === 0) return [];
  const acc = vecs.reduce((acc, v) => vecAdd(acc, v), vecs.map(() => 0));
  return vecScale(acc, 1 / vecs.length);
}

/** 两个向量是否完全相同（用于去重初始化质心）。 */
function vecEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// kmeans（自研，v0 固定 k）
// ---------------------------------------------------------------------------

interface KmeansResult {
  /** 每个输入点归属的簇索引；-1 表示未分配（不应发生）。 */
  assignment: number[];
  /** 各簇质心（仅非空簇）。 */
  centroids: number[][];
  /** 非空簇在结果中的索引列表（与 centroids 对齐）。 */
  nonEmpty: number[];
}

/**
 * 极简 kmeans：
 *  - 初始化：取前 k 个互不相同的向量作为质心（向量完全相同则不重复取），
 *    若互异向量不足 k 个，则实际簇数 < k（避免在重复点上拆出空簇）。
 *  - 迭代：分配 → 重算质心，直到稳定或达上限。
 *  - 仅保留非空簇。
 */
function kmeans(points: number[][], k: number, maxIter = 50): KmeansResult {
  const n = points.length;
  if (n === 0) {
    return { assignment: [], centroids: [], nonEmpty: [] };
  }

  // 互异质心初始化
  const centroids: number[][] = [];
  for (const p of points) {
    if (centroids.length >= k) break;
    if (!centroids.some((c) => vecEqual(c, p))) {
      centroids.push(p.slice());
    }
  }
  // 若互异向量不足 k，centroids 即为全部互异向量（簇数 < k，可接受）

  if (centroids.length === 0) {
    // 全部点相同（理论上不会到这，因 n>0 时至少 1 个互异）
    centroids.push(points[0]!.slice());
  }

  let assignment: number[] = new Array(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    // 分配
    const next = points.map((p) => {
      let best = 0;
      let bestDist = Infinity;
      for (let ci = 0; ci < centroids.length; ci++) {
        const d = euclid(p, centroids[ci]!);
        if (d < bestDist) {
          bestDist = d;
          best = ci;
        }
      }
      return best;
    });

    const stable =
      next.length === assignment.length &&
      next.every((v, i) => v === assignment[i]);
    assignment = next;
    if (stable && iter > 0) break;

    // 重算质心
    const groups: number[][][] = centroids.map(() => []);
    for (let i = 0; i < n; i++) {
      groups[assignment[i]!]!.push(points[i]!);
    }
    for (let ci = 0; ci < centroids.length; ci++) {
      if (groups[ci]!.length > 0) {
        centroids[ci] = vecMean(groups[ci]!);
      }
      // 空簇保留旧质心（最终被 nonEmpty 过滤）
    }
  }

  // 仅保留非空簇
  const nonEmpty: number[] = [];
  for (let ci = 0; ci < centroids.length; ci++) {
    if (assignment.some((a) => a === ci)) nonEmpty.push(ci);
  }

  return { assignment, centroids, nonEmpty };
}

// ---------------------------------------------------------------------------
// silhouette（k='auto' 选 k）
// ---------------------------------------------------------------------------

/**
 * 平均 silhouette 系数（用于 auto-k 选择）。
 * 单点簇的 b 视为 0（s=0 约定），避免 inf。
 * 返回 [-1, 1]；n<=1 或单簇返回 0。
 */
function silhouetteScore(points: number[][], assignment: number[]): number {
  const n = points.length;
  if (n <= 1) return 0;
  const clusterIds = Array.from(new Set(assignment));
  if (clusterIds.length <= 1) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const ci = assignment[i]!;
    // a(i): 与同簇其他点的平均距离
    const sameCluster = points
      .map((_, j) => j)
      .filter((j) => j !== i && assignment[j] === ci);
    const a =
      sameCluster.length === 0
        ? 0
        : sameCluster.reduce((s, j) => s + euclid(points[i]!, points[j]!), 0) /
          sameCluster.length;

    // b(i): 与最近异簇的平均距离
    let b = Infinity;
    for (const other of clusterIds) {
      if (other === ci) continue;
      const others = points
        .map((_, j) => j)
        .filter((j) => assignment[j] === other);
      if (others.length === 0) continue;
      const avg =
        others.reduce((s, j) => s + euclid(points[i]!, points[j]!), 0) /
        others.length;
      if (avg < b) b = avg;
    }
    if (!Number.isFinite(b)) b = 0;

    const denom = Math.max(a, b);
    sum += denom === 0 ? 0 : (b - a) / denom;
  }
  return sum / n;
}

// ---------------------------------------------------------------------------
// 标签
// ---------------------------------------------------------------------------

/**
 * 从 label_schema 选失败模式标签：取 label 的下划线分词，若任一 token 作为
 * 子串出现在 representativeExample（小写）中即命中；不命中则回落 'outliers'
 * （若 'outliers' 不在 schema 则取 schema[0]）。
 *
 * 这样 'tool_timeout' 命中含 'timeout' 的 content，'schema_validation_failure'
 * 命中含 'schema' 的 content（spec 标签场景）。
 */
function labelFromContent(
  content: string,
  labelSchema: string[],
): string {
  const lower = content.toLowerCase();
  for (const label of labelSchema) {
    if (label === "outliers") continue;
    const tokens = label.split("_").filter((t) => t.length > 0);
    if (tokens.some((t) => lower.includes(t))) {
      return label;
    }
  }
  return labelSchema.includes("outliers")
    ? "outliers"
    : (labelSchema[0] ?? "outliers");
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

export interface CreateFailureClustererOpts {
  /** clusterer_config.yaml 路径（不传则用 bundled 默认 scope config）。 */
  configPath?: string;
  /** embedding 提供方（必传，或传 embed 函数）。 */
  embeddingProvider?: EmbeddingProvider;
  /** 等价于 embeddingProvider.embed（ERRATA 裁决签名的便捷入口）。 */
  embed?: (turn: FailedTurn) => Promise<number[]>;
  /** 内联覆盖 config（与 configPath 二选一；内联优先）。 */
  k?: number | "auto";
  minClusterSize?: number;
  labelSchema?: string[];
  embeddingModel?: string;
}

export function createFailureClusterer(
  opts: CreateFailureClustererOpts = {},
): FailureClusterer {
  // 解析 config（内联参数优先覆盖 configPath 加载值）
  let cfg: ClustererConfig;
  if (
    opts.k !== undefined ||
    opts.minClusterSize !== undefined ||
    opts.labelSchema !== undefined ||
    opts.embeddingModel !== undefined
  ) {
    cfg = {
      embedding_model: opts.embeddingModel ?? "mock-embed-v1",
      k: opts.k ?? 2,
      min_cluster_size: opts.minClusterSize ?? 1,
      label_schema: opts.labelSchema ?? [
        "tool_timeout",
        "schema_validation_failure",
        "outliers",
      ],
    };
  } else {
    const cfgOpts: { configPath?: string } = {};
    if (opts.configPath !== undefined) cfgOpts.configPath = opts.configPath;
    cfg = loadClustererConfig(cfgOpts);
  }

  // embedding provider 解析
  const provider: EmbeddingProvider | undefined =
    opts.embeddingProvider ??
    (opts.embed ? { embed: opts.embed } : undefined);

  const labelSchema = cfg.label_schema.length > 0 ? cfg.label_schema : ["outliers"];

  return {
    async clusterFailures(failedTurns: FailedTurn[]): Promise<FailureCluster[]> {
      if (failedTurns.length === 0) return [];

      if (!provider) {
        throw new EmbeddingUnavailableError(
          "no embedding provider configured (configPath or embeddingProvider required)",
        );
      }

      // 1. embedding（任一失败 → EmbeddingUnavailableError，不静默用空向量）
      const vectors: number[][] = [];
      for (const t of failedTurns) {
        let v: number[];
        try {
          v = await provider.embed(t);
        } catch (e) {
          if (e instanceof EmbeddingUnavailableError) throw e;
          throw new EmbeddingUnavailableError(
            e instanceof Error ? e.message : "embedding failed",
          );
        }
        if (!Array.isArray(v) || v.length === 0) {
          throw new EmbeddingUnavailableError(
            "embedding provider returned empty vector",
          );
        }
        vectors.push(v);
      }

      // 2. 选 k
      const n = failedTurns.length;
      let effectiveK: number;
      if (cfg.k === "auto") {
        effectiveK = chooseAutoK(vectors);
      } else {
        effectiveK = Math.min(cfg.k, n);
      }
      if (effectiveK < 1) effectiveK = 1;

      // 3. kmeans
      const km = kmeans(vectors, effectiveK);

      // 4. 按 nonEmpty 簇分组 + min_cluster_size 守卫
      type Bucket = { idxs: number[]; centroid: number[] };
      const normalBuckets: Bucket[] = [];
      const outlierIdxs: number[] = [];

      for (const ci of km.nonEmpty) {
        const idxs = km.assignment
          .map((a, i) => (a === ci ? i : -1))
          .filter((i) => i >= 0);
        if (idxs.length < cfg.min_cluster_size) {
          outlierIdxs.push(...idxs);
        } else {
          normalBuckets.push({
            idxs,
            centroid: vecMean(idxs.map((i) => vectors[i]!)),
          });
        }
      }

      // 5. 构建 FailureCluster
      const clusters: FailureCluster[] = [];
      let cCounter = 0;
      for (const b of normalBuckets) {
        const repIdx = pickRepresentative(vectors, b.idxs, b.centroid);
        const repContent = failedTurns[repIdx]!.content;
        const label = labelFromContent(repContent, labelSchema);
        clusters.push({
          clusterId: `cluster-${cCounter++}`,
          centroid: b.centroid,
          members: b.idxs.map((i) => failedTurns[i]!.uuid),
          label,
          representativeExample: repContent,
        });
      }
      if (outlierIdxs.length > 0) {
        const centroid = vecMean(outlierIdxs.map((i) => vectors[i]!));
        const repIdx = pickRepresentative(vectors, outlierIdxs, centroid);
        clusters.push({
          clusterId: `cluster-${cCounter++}`,
          centroid,
          members: outlierIdxs.map((i) => failedTurns[i]!.uuid),
          label: "outliers",
          representativeExample: failedTurns[repIdx]!.content,
        });
      }

      return clusters;
    },

    async labelCluster(cluster: FailureCluster): Promise<string> {
      // outliers 簇固定 'outliers'
      if (cluster.label === "outliers") return "outliers";
      return labelFromContent(cluster.representativeExample, labelSchema);
    },
  };
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 选簇内最接近质心的成员索引作为代表例。 */
function pickRepresentative(
  vectors: number[][],
  idxs: number[],
  centroid: number[],
): number {
  let best = idxs[0]!;
  let bestDist = Infinity;
  for (const i of idxs) {
    const d = euclid(vectors[i]!, centroid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** auto-k：在 k=2..min(n,8) 中选 silhouette 最高的 k；n<2 退化 k=1。 */
function chooseAutoK(vectors: number[][]): number {
  const n = vectors.length;
  if (n <= 1) return 1;
  const maxK = Math.min(n, 8);
  let bestK = 1;
  let bestScore = -Infinity;
  for (let k = 2; k <= maxK; k++) {
    const km = kmeans(vectors, k);
    // 重映射 assignment 到非空簇的连续 id（silhouette 需要）
    const idMap = new Map<number, number>();
    km.nonEmpty.forEach((ci, i) => idMap.set(ci, i));
    const remapped = km.assignment.map((a) => idMap.get(a) ?? 0);
    const score = silhouetteScore(vectors, remapped);
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
    }
  }
  // 若所有 k 的 silhouette 都 <= 0（如全同向量），退化为 k=1
  if (bestScore <= 0) return 1;
  return bestK;
}
