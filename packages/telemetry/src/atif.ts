// TL-T10: ATIF 格式编解码（eval dataset schema + 字段强制校验）
//
// ATIF = Agent Trajectory Interchange Format。成功低 token 轨迹导出为
// eval dataset / SFT 数据的载体格式。字段强制校验，宁拒不漏（eval dataset
// 质量是 flywheel 生命线）。
//
// ERRATA-w2plus TL-T10 裁决：
//   - TrajectoryStep 类型 = { role: string; content: string; toolUse?: { name: string; input: unknown } }
//   - ATIFDataset 须含 errors?: number（报告损坏 session 数）
//   - encodeATIFRecord(record): string 单条序列化函数须导出
//   - MissingJudgeScoreError 须为导出 class，error name 含类名
//
// static-core：ATIF schema 字段名/可选性一字不差于 spec 契约节。

// ---------------------------------------------------------------------------
// 类型（static-core 接口契约）
// ---------------------------------------------------------------------------

/**
 * 单步轨迹（ERRATA-w2plus TL-T10 裁定）。
 * role: 消息角色（user/assistant/tool/...）；content: 文本内容；
 * toolUse: 可选 tool_use 块（name + input）。
 */
export interface TrajectoryStep {
  role: string;
  content: string;
  toolUse?: { name: string; input: unknown };
}

/** ATIF 单条记录（spec §TL-T10 接口签名）。 */
export interface ATIFRecord {
  task: string;
  steps: TrajectoryStep[];
  outcome: "success" | "failure";
  totalTokens: number;
  judgeScore: number;
}

/** ATIF dataset（spec §TL-T10 接口签名 + ERRATA errors 字段）。 */
export interface ATIFDataset {
  format: "ATIF";
  version: string;
  records: ATIFRecord[];
  /** 被跳过/损坏的 session 数（ERRATA-w2plus TL-T10）。 */
  errors?: number;
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/**
 * ATIF record 缺 judgeScore（强制字段）→ 抛此错。
 * error name 含类名，同时支持 instanceof 与正则匹配（与 TL-T02/T06 约定一致）。
 */
export class MissingJudgeScoreError extends Error {
  constructor(
    message = "MissingJudgeScoreError: ATIF record.judgeScore is required (must be a finite number)",
  ) {
    super(message);
    this.name = "MissingJudgeScoreError";
  }
}

// ---------------------------------------------------------------------------
// 编解码
// ---------------------------------------------------------------------------

/** ATIF 格式版本。 */
export const ATIF_VERSION = "1.0.0";

/**
 * 单条 ATIF record 序列化为字符串（JSON）。
 *
 * 字段强制校验：judgeScore 必须为有限数，缺失/NaN → MissingJudgeScoreError。
 * 宁拒不漏（eval dataset 质量是 flywheel 生命线）。
 */
export function encodeATIFRecord(record: ATIFRecord): string {
  if (
    record.judgeScore === undefined ||
    record.judgeScore === null ||
    typeof record.judgeScore !== "number" ||
    !Number.isFinite(record.judgeScore)
  ) {
    throw new MissingJudgeScoreError(
      `MissingJudgeScoreError: ATIF record.judgeScore is missing or not a finite number (task=${record.task})`,
    );
  }
  // 规范化输出：字段顺序固定（便于 diff / hash）
  const normalized: ATIFRecord = {
    task: record.task,
    steps: Array.isArray(record.steps) ? record.steps : [],
    outcome: record.outcome,
    totalTokens: record.totalTokens,
    judgeScore: record.judgeScore,
  };
  return JSON.stringify(normalized);
}

/**
 * 整个 ATIFDataset 序列化为字符串（NDJSON：每行一条 record）。
 * 首行为 header（format/version/errors），后续每行一条 encodeATIFRecord。
 */
export function encodeATIFDataset(dataset: ATIFDataset): string {
  const header = JSON.stringify({
    format: dataset.format,
    version: dataset.version,
    ...(dataset.errors !== undefined ? { errors: dataset.errors } : {}),
  });
  const lines = [header];
  for (const r of dataset.records) {
    lines.push(encodeATIFRecord(r));
  }
  return lines.join("\n");
}
