// L2-T03a (REFACTOR) · 共享内容脱敏（redact）。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T03a（GREEN/REFACTOR 节）。
// Reflexion 笔记（T03a）与 episodic trajectory（T05）复用同一脱敏逻辑。
//
// 语义：检测 content 中是否含具体文件路径 / 凭据 / 敏感字段值。
//   - `/Users/[^ \n]+` —— 具体绝对路径（macOS home）。
//   - `AKIA[A-Z0-9]+` —— AWS access key id。
//   - `SECRET|TOKEN|KEY|AUTH` 字段值（`<FIELD>=<value>` / `<FIELD>: <value>`）。
//   - `secret.*\.(key|pem|env)` —— 敏感凭据文件名。
//
// 返回 `string | null`：检测到则返回 reason（供调用方拼入 reject 信息），
// 否则返回 null（内容安全）。脱敏**不**做正则 strip 后落盘——遇到敏感内容
// 一律 reject + warn，避免"脱敏后写入但语义已损坏"的灰色状态。
//
// 这是"禁具体路径/凭据"铁律（02-memory-skills.md 组件 9 static-core）在
// 写路径的前置门控。

/** 具体绝对路径（/Users/xxx）。spec 正则 `/Users/[^ \n]+`。 */
const ABS_PATH_RE = /\/Users\/[^\s\n]+/;
/** AWS access key id（AKIA...）。spec 正则 `AKIA[A-Z0-9]+`。 */
const AWS_KEY_RE = /AKIA[A-Z0-9]+/;
/** 敏感字段值（SECRET/TOKEN/KEY/AUTH = ... 或 : ...）。spec 正则。 */
const SECRET_FIELD_RE = /\b(?:SECRET|TOKEN|KEY|AUTH)\b\s*[:=]\s*\S+/i;
/** 敏感凭据文件名（secret.key / id_rsa.pem / .env 等）。 */
const SECRET_FILE_RE = /(?:secret|id_rsa|\.env)\b\.(?:key|pem|env)/i;

/**
 * 检测 content 是否含敏感信息（具体路径 / 凭据）。
 *
 * @returns 检测到则返回 reason 字符串；否则返回 `null`。
 */
export function detectSensitive(content: string): string | null {
  if (typeof content !== "string") return null;
  if (ABS_PATH_RE.test(content)) {
    return "concrete file path detected (/Users/...)";
  }
  if (AWS_KEY_RE.test(content)) {
    return "AWS credential detected (AKIA...)";
  }
  if (SECRET_FIELD_RE.test(content)) {
    return "credential field value detected (SECRET/TOKEN/KEY/AUTH)";
  }
  if (SECRET_FILE_RE.test(content)) {
    return "secret credential file detected";
  }
  return null;
}

/**
 * 判定 content 是否安全可写。`true` = 含敏感信息，应 reject。
 */
export function isSensitive(content: string): boolean {
  return detectSensitive(content) !== null;
}
