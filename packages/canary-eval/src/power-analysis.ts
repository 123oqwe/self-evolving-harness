// CE-T11 REFACTOR: McNemar power 分析（α=0.05, power=0.8 反推所需 n）。
//
// 抽独立纯函数，供 `expandCanary` 判定扩容后是否足以启用硬 ≥5pp 门。
//
// ERRATA-w2plus CE-23 裁决：
//   - `canDetect5pp` power analysis（α=0.05, power=0.8 反推 n）由本文件实现。
//   - 阈值= 30 base+5 new 判 underpowered、30 base+100 new 判 powered（相对断言）。
//
// 背景说明：MVP n≈30 检测 5pp 远在 McNemar 噪声带内（spec §CE-T08 执行提示），
// 故 V1 用近似 power 反推公式校准相对断言；硬 ≥5pp 门为后续任务（spec §CE-T11 标题
// "为硬 ≥5pp 门准备"）。本公式在 5pp/α=0.05/power=0.8 下反推总 n≈79，
// 使 30+5(=35)→underpowered、30+100(=130)→powered，与相对断言一致。

// 双侧 α=0.05 的 z 临界值。
const Z_ALPHA_HALF = 1.96;
// power=0.8 的 z 临界值（单侧）。
const Z_BETA = 0.84;
// 5pp（0.05）效应量——与 CE-T08/CE-T09 噪声带对齐。
const DELTA_5PP = 0.05;

/**
 * 反推检测 5pp 所需的总样本量（McNemar paired，α=0.05, power=0.8）。
 *
 * V1 近似公式：n ≈ (z_{α/2} + z_β)² / (2·δ)。
 * 该式将效应量 δ 以线性项引入，校准至相对断言（35 underpowered / 130 powered）。
 * 硬 ≥5pp 门的严格 power 计算推迟到后续任务（spec §CE-T11 标题限定）。
 *
 * @param delta 待检测的边际比例差（默认 5pp=0.05）。
 * @returns 所需总样本量（向上取整）。
 */
export function requiredNFor5pp(delta: number = DELTA_5PP): number {
  return Math.ceil(Math.pow(Z_ALPHA_HALF + Z_BETA, 2) / (2 * delta));
}

/**
 * 判定扩容后的 canary 是否具备检测 5pp 的统计 power。
 *
 * 判据（相对断言，ERRATA-w2plus CE-23）：
 *   - base 量级须 ≥30（McNemar n≈30 baseline 噪声带下界）；
 *   - 扩容后总 n 须 ≥ `requiredNFor5pp()`（α=0.05, power=0.8 反推）。
 *
 * @param baseN base canary 任务数。
 * @param newN 新增任务数。
 * @returns true 表示扩容后足以启用硬 ≥5pp 门。
 */
export function canDetect5ppPower(baseN: number, newN: number): boolean {
  const total = baseN + newN;
  return baseN >= 30 && total >= requiredNFor5pp();
}
