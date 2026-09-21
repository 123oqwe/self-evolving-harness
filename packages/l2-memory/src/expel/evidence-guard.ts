// L2-T04b · evidence-guard —— insight 蒸馏前置安全门。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T04b。
//
// 两道铁律（02-memory-skills.md 组件 1.4 安全门）：
//   1. **≥2 evidence** —— ADD 时 evidenceCount 必须 ≥2（ExpeL importance 起始 2
//      即 ≥2 evidence 语义，防 garbage-in）。
//   2. **禁具体路径 / 凭据** —— insight 是 NL 规则，将注入 system prompt；
//      含具体文件路径 / 凭据会形成 prompt injection 持久化。故 ruleText 与
//      content 一律 reject（不做 mask 后落盘——与 shared/redact.ts 同语义：
//      遇敏感内容 reject + 不写，避免"脱敏后语义损坏"灰色状态）。
//
// 检测模式与 shared/redact.ts 对齐并扩展（redact.ts 的 ABS_PATH_RE 只覆盖
// `/Users/...`；evidence-guard 额外覆盖 `/etc/...` 等系统绝对路径，因 spec
// 显式 Given 用 `/etc/passwd`）。

/**
 * 具体绝对路径（/etc/... / /Users/... / /home/... 等系统路径）。
 * spec Given：insight 含 `/etc/passwd` 路径 → reject。
 */
const CONCRETE_PATH_RE =
  /\/(?:etc|Users|home|root|var|tmp|usr|opt|proc|sys|private|mnt|media|srv|lib|bin|sbin|boot|dev|run)\/[^\s"'`]+/;

/** AWS access key id（AKIA...）。spec 正则 `AKIA[A-Z0-9]+`。 */
const AWS_KEY_RE = /AKIA[A-Z0-9]+/;

/** 敏感字段值（SECRET/TOKEN/KEY/AUTH/PASSWORD = ... 或 : ...）。 */
const SECRET_FIELD_RE = /\b(?:SECRET|TOKEN|KEY|AUTH|PASSWORD)\b\s*[:=]\s*\S+/i;

/** 敏感凭据文件名（secret.key / id_rsa.pem / .env 等）。 */
const SECRET_FILE_RE = /(?:secret|id_rsa|\.env)\b\.(?:key|pem|env)/i;

/** evidence-guard 拒绝信息（含 "concrete paths/credentials" 关键词，供测试断言）。 */
const GUARD_MSG = "insight must not contain concrete paths/credentials";

/**
 * 检测自由文本是否含具体路径 / 凭据。
 *
 * @returns 检测到则返回拒绝信息；否则 `null`。
 */
export function detectInsightSensitive(content: string): string | null {
  if (typeof content !== "string" || content.length === 0) return null;
  if (CONCRETE_PATH_RE.test(content)) return GUARD_MSG;
  if (AWS_KEY_RE.test(content)) return GUARD_MSG;
  if (SECRET_FIELD_RE.test(content)) return GUARD_MSG;
  if (SECRET_FILE_RE.test(content)) return GUARD_MSG;
  return null;
}

/**
 * 判定文本是否含敏感信息。`true` = 应 reject。
 */
export function isInsightSensitive(content: string): boolean {
  return detectInsightSensitive(content) !== null;
}

export { GUARD_MSG };
