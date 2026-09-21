/**
 * L0S-T08 — net policy diff（deny 收紧 vs allow 放宽判定）
 *
 * C2 策略三表（denyRead 路径集 / allowedDomains / denyOutCidr）的版本化差集：
 *   - deny 类（denyRead / denyOutCidr）：tightened = next - prev；relaxed = prev - next
 *   - allow 类（allowedDomains）：放宽（relaxed）= next 新增的 allow 条目
 *     （allow 放宽语义 = 允许出口范围扩大，即 next - prev）；
 *     收紧（tightened）= prev - next（移除 allow，无风险，不需签发）。
 *
 * 命名约定遵循 spec：deny 表用 `deny*Tightened`/`*Relaxed`，
 * allow 表统一映射到 `allowRelaxed`（放宽 = 风险面扩大，须签发）。
 * allow 收紧（移除 allow）无安全风险，本 diff 不单独报告（不纳入门）。
 *
 * 裁决 L0S-07：denyOutCidr 收紧语义——`169.254.169.254/32` 已被 `0.0.0.0/0`
 * 覆盖，但显式列出视为收紧信号（next 集合新增条目即 tightened）。
 *
 * 裁决 L0S-08（refix1）：denyRead 放宽面（prev - next，移除凭据黑名单路径）
 * 必须显式导出为 `denyReadRelaxed`——此前 prev-next 被丢弃导致 v2 从 denyRead
 * 移除 ~/.aws 时无任何 relaxed 字段、静默自动放行（exfil-enabling）。现导出该
 * 字段并由 `assertChangeAllowed` 强制单调收紧（非空即 throw，fail-closed），
 * 与 T07 monotonic-tighten 一致、与 spec「防 agent 自开 exfil 后门」意图一致。
 */

/** 网络策略三表 diff。 */
export interface PolicyDiff {
  /** denyRead 新增收紧项（next - prev）。 */
  denyTightened: string[];
  /**
   * denyRead 放宽项（prev - next，移除 deny-read 路径 = exfil-enabling）。
   *
   * 单调收紧策略：denyRead 只许增长、不许收缩。`assertChangeAllowed` 见此字段
   * 非空即 throw（fail-closed），即使有人工签发也不放行——凭据黑名单（如
   * ~/.aws/~/.ssh）一旦允许签名移除即打开 exfil 后门。导出此字段以消除
   * 「prev-next 被丢弃」的静默放行面。
   */
  denyReadRelaxed: string[];
  /** allowedDomains 放宽项（next - prev，新增 allow 域，须签发）。 */
  allowRelaxed: string[];
  /** denyOutCidr 新增收紧项（next - prev）。 */
  denyOutTightened: string[];
  /** denyOutCidr 放宽项（prev - next，移除 deny CIDR，须签发）。 */
  denyOutRelaxed: string[];
}

/** 计算两集合的差集：返回 `b - a`（b 中存在而 a 中不存在）。 */
function minus(a: Iterable<string>, b: Iterable<string>): string[] {
  const sa = new Set(a);
  const out: string[] = [];
  for (const x of b) if (!sa.has(x)) out.push(x);
  return out;
}

/**
 * 计算三表 prev → next 的 diff。
 *
 * deny 表：tightened = next - prev；relaxed = prev - next。
 * allow 表（allowedDomains）：allowRelaxed = next - prev（新增 allow 域 = 放宽）。
 */
export function diffNetPolicy(
  prev: {
    denyRead: string[];
    allowedDomains: string[];
    denyOutCidr: string[];
  },
  next: {
    denyRead: string[];
    allowedDomains: string[];
    denyOutCidr: string[];
  },
): PolicyDiff {
  return {
    denyTightened: minus(prev.denyRead, next.denyRead),
    // prev - next：denyRead 收缩项。非空 → assertChangeAllowed throw（单调收紧）。
    denyReadRelaxed: minus(next.denyRead, prev.denyRead),
    allowRelaxed: minus(prev.allowedDomains, next.allowedDomains),
    denyOutTightened: minus(prev.denyOutCidr, next.denyOutCidr),
    denyOutRelaxed: minus(next.denyOutCidr, prev.denyOutCidr),
  };
}
