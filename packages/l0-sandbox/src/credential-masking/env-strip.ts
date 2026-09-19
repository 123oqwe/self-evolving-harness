/**
 * L0S-T04b — env strip：strip TOKEN/SECRET/KEY/AUTH/PASSWORD/CREDENTIAL env var → sentinel
 *
 * 真实凭据隔离的第一道防线：sandbox 进程 env 中匹配敏感名或匹配真实值的变量，
 * 一律替换为 per-session sentinel 占位符。真实值永不进 hands 域。
 *
 * 匹配规则（任一命中即替换）：
 *   1. env var 名出现在 secrets 映射表（key 名精确匹配）；
 *   2. env var 值等于某个真实 secret 值（防模型把真实值搬到非敏感名下）；
 *   3. env var 名匹配敏感正则 `/^(TOKEN|SECRET|KEY|AUTH|PASSWORD|CREDENTIAL)/i`
 *      —— 注意此正则为 *包含* 语义的归一化变体（见 SENSITIVE_ENV_NAME_RE），
 *      以覆盖 `GITHUB_TOKEN` / `AWS_SECRET_ACCESS_KEY` 等真实世界命名。
 */

import type { SessionVault } from "./sentinel.js";

/** 敏感 env var 名匹配规则（包含敏感子串即视为敏感）。 */
export const SENSITIVE_ENV_NAME_RE =
  /(?:TOKEN|SECRET|KEY|AUTH|PASSWORD|CREDENTIAL)/i;

export interface StripSecretEnvOpts {
  /** key 名 → 真实值 映射（brain 域持有）。 */
  secrets: Map<string, string>;
  /** per-session sentinel vault（brain 域持有）。 */
  vault: SessionVault;
}

/**
 * 把 rawEnv 中的真实凭据替换为 sentinel。返回新对象，不修改入参。
 *
 * 替换优先级：key 名精确命中 secrets → 用该 key 的 sentinel；否则若值命中真实值
 * → 用对应 sentinel；否则若名匹配敏感正则 → 用该名注册一个新 sentinel（值为空
 * 也替换，防模型探测变量名存在性）。
 */
export function stripSecretEnv(
  rawEnv: Record<string, string>,
  opts: StripSecretEnvOpts,
): Record<string, string> {
  const { secrets, vault } = opts;
  // 预先把 secrets 注册进 vault，建立 key→sentinel 与 value→sentinel 映射。
  for (const [keyName, realValue] of secrets) {
    vault.register(keyName, realValue);
  }

  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawEnv)) {
    const inSecrets = secrets.has(name);
    const matchedValue = vault.sentinelByValue(value);
    const sensitiveName = SENSITIVE_ENV_NAME_RE.test(name);

    if (inSecrets) {
      // key 名精确命中：用该 key 的 sentinel。
      const sentinel = vault.sentinelFor(name) ?? vault.register(name, value);
      out[name] = sentinel;
    } else if (matchedValue !== undefined) {
      // 值命中真实值：复用对应 sentinel。
      out[name] = matchedValue;
    } else if (sensitiveName) {
      // 敏感名（不在 secrets 表）：注册新 sentinel（值未知也替换）。
      out[name] = vault.register(name, value);
    } else {
      // 非敏感 env 透传。
      out[name] = value;
    }
  }
  return out;
}
