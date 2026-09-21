// L2-T04a · ExpeL insight 失败聚类 feed [V1]
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T04a。
//
// 角色：feed 适配层——把 TL-T08 失败聚类器产出的 `FailureCluster[]`（Clio-style
// embedding + clusterer_config 聚类的失败 trajectory 簇）转换为 insight-LLM 可
// 消费的 `InsightSeed[]`。本任务**只**做格式转换 + 过滤，不做 insight 蒸馏
// （蒸馏在 L2-T04b）。
//
// 行为：
//   - 过滤 size<2 的簇（insight 需 ≥2 evidence，组件 1.4 安全门；ExpeL
//     importance 起始 2 即 ≥2 evidence 语义）。
//   - 脱敏：cluster.trajectories 含 credential 字段时脱敏后传入（错误路径
//     防护，委托 shared/redact.ts）。脱敏作用于流入 seed 的自由文本字段
//     （summary）——trajectoryIds 仅承载 id，不携带敏感内容。
//   - 空 clusters → []（边界）。
//
// 保持与 TL-T08 的 `FailureCluster` 类型严格一致，避免 schema drift。

import { detectSensitive } from "../shared/redact.js";

/** 失败 trajectory 引用。`id` 必填；`text` 为可选自由文本（可能含凭据）。 */
export interface TrajectoryRef {
  id: string;
  text?: string;
}

/** TL-T08 失败聚类器产出。簇 = 同质失败 trajectory 的集合 + 质心摘要。 */
export interface FailureCluster {
  id: string;
  trajectories: TrajectoryRef[];
  centroidSummary: string;
  size: number;
}

/** insight-LLM 蒸馏输入 seed。 */
export interface InsightSeed {
  clusterId: string;
  trajectoryIds: string[];
  summary: string;
}

/** 凭据掩码占位符（脱敏后替换敏感值）。 */
const REDACTED = "[REDACTED]";
/** AWS access key id（AKIA...）。spec 正则 `AKIA[A-Z0-9]+`。 */
const AWS_KEY_RE = /AKIA[A-Z0-9]+/g;
/** 敏感字段值（SECRET/TOKEN/KEY/AUTH = ... 或 : ...），保留字段名替换值。 */
const SECRET_FIELD_RE =
  /(\b(?:SECRET|TOKEN|KEY|AUTH)\b\s*[:=]\s*)(\S+)/gi;
/** 敏感凭据文件名（secret.key / id_rsa.pem / .env）。 */
const SECRET_FILE_RE = /(?:secret|id_rsa|\.env)\b\.(?:key|pem|env)/gi;
/** 具体绝对路径（/Users/xxx）。spec 正则 `/Users/[^ \n]+`。 */
const ABS_PATH_RE = /\/Users\/[^\s\n]+/g;

/**
 * 脱敏自由文本——mask 敏感值后落盘（与 shared/redact.ts 的 reject 语义不同：
 * feed 侧只是适配层，不能因含凭据丢弃整簇 insight 信号，而是 mask 后传入，
 * 防止 prompt injection 持久化到 insight 蒸馏产物）。
 *
 * 复用 shared/redact.ts 的检测模式（detectSensitive）确保两处敏感面一致；
 * 此处做 mask（替换为 `[REDACTED]`）而非 reject。
 */
export function redactContent(content: string): string {
  if (typeof content !== "string") return "";
  return content
    .replace(AWS_KEY_RE, REDACTED)
    .replace(SECRET_FIELD_RE, `$1${REDACTED}`)
    .replace(SECRET_FILE_RE, REDACTED)
    .replace(ABS_PATH_RE, REDACTED);
}

/**
 * 把单个 cluster 转为 insight seed。
 * - size<2 的簇在调用方过滤（insight 需 ≥2 evidence）。
 * - summary 脱敏后传入（防凭据/路径流入 insight-LLM）。
 * - trajectoryIds 仅取 id（不携带 text，天然不含敏感内容）。
 */
function toSeed(cluster: FailureCluster): InsightSeed {
  return {
    clusterId: cluster.id,
    trajectoryIds: cluster.trajectories.map((t) => t.id),
    summary: redactContent(cluster.centroidSummary),
  };
}

/**
 * 把 `FailureCluster[]` 转换为 `InsightSeed[]`。
 *
 * @param clusters TL-T08 产出的失败簇
 * @returns 过滤 size<2 后的 seed 列表（空输入 → 空列表）
 */
export function toInsightSeeds(clusters: FailureCluster[]): InsightSeed[] {
  if (!Array.isArray(clusters) || clusters.length === 0) return [];
  return clusters
    .filter((c) => c.size >= 2)
    .map(toSeed);
}

// 防御性 re-export：供 L2-T04b insight-store 复用 `InsightSeed` / `FailureCluster`
// 类型与脱敏逻辑（REFACTOR 节：与 T04b 共享 InsightSeed 类型）。
export { detectSensitive };
