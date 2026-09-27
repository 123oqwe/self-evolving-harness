// PLG-T04: evolve-hermes · 基质路径映射。
//
// Spec: execution/plugin/TASKS.md §PLG-T04.
// 复用铁律（§0.2）：evolve 逻辑只在 evolve-core，本插件只做基质/轨迹/部署四方法映射。
//
// Hermes 基质 = ~/.hermes/skills/<name>/SKILL.md（HERMES_HOME 默认 ~/.hermes）。
// substrate id 形如 `hermes/skills/evolve/SKILL.md`；映射时剥掉 `hermes/` 前缀，
// 得到 hermesHome/repoRoot 内的相对路径 `skills/evolve/SKILL.md`。

/** Hermes substrate id 前缀（契约：所有 hermes 基质 id 以此开头）。 */
export const HERMES_SUBSTRATE_PREFIX = "hermes/";

/**
 * 把 substrate id（如 `hermes/skills/evolve/SKILL.md`）映射为 hermesHome /
 * repoRoot 内的相对路径（`skills/evolve/SKILL.md`）。
 *
 * 容错：若 id 不以 `hermes/` 开头（调用方直接传相对路径），原样返回。
 */
export function mapHermesSubstratePath(id: string): string {
  const norm = id.replace(/\\/g, "/");
  if (norm.startsWith(HERMES_SUBSTRATE_PREFIX)) {
    return norm.slice(HERMES_SUBSTRATE_PREFIX.length);
  }
  return norm;
}
