/**
 * L0S-T05 — canary 注入器
 *
 * 把 canary token 作为 pseudo-secret 注入 sandbox env + proxy sentinel 映射表。
 * canary 是高熵随机串（`crypto.randomUUID` + 前缀 `canary-`，由调用方生成），
 * distinct from 真实 secret。sandbox env 见 sentinel 占位符（canary 真值不落 env，
 * C5 凭据零容忍）；proxy 在 injectHosts 出站时把 sentinel 替换为 canary 真值。
 *
 * 复用 T04b SessionVault 机制：canary 即 pseudo-real-value，sentinel 形态一致。
 */

/**
 * 注入 canary 到 sandbox env。
 *
 * 行为：保留原 env 透传项，追加一个 sentinel 占位符（值不含 canary 真值，
 * 防 sandbox 进程 env / stdout grep canary 误命中）。canary 真值的映射由
 * CanaryLeakVerifier 经 proxy onEgress 拦截在 injectHosts 出站时替换。
 *
 * 返回新对象，不修改入参。
 */
export function injectCanaryEnv(
  sandboxEnv: Record<string, string>,
  _canaryToken: string,
): Record<string, string> {
  // canary 真值不落 env：sandbox 见 sentinel 占位符，brain/proxy 域持有 canary
  // 真值并在 injectHosts 出站时替换。占位符串不含 canary 真值，避免 env grep
  // 误命中（canary 是 deterministic 二值 oracle 的 needle）。
  const out: Record<string, string> = { ...sandboxEnv };
  out["__CANARY_SENTINEL__"] = "sentinel_canary";
  return out;
}
