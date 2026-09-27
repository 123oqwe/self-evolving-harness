// validatePackageJson — PLG-T09 publishable 字段校验（spec §PLG-T09 行为规范）。
//
// 每个 evolve-* 包必须携带独立语义化版本 + publishConfig/files/exports。
// workspace 占位 "0.0.0" 视为未发布（spec 执行提示 (1)），判 invalid。

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/**
 * @param {unknown} pkg 解析后的 package.json 内容
 * @param {string} pkgDir 包目录（诊断信息用）
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validatePackageJson(pkg, pkgDir) {
  if (pkg === null || typeof pkg !== "object") {
    return { ok: false, reason: `${pkgDir}: package.json is not a JSON object` };
  }
  const p = /** @type {Record<string, unknown>} */ (pkg);

  const version = p.version;
  if (typeof version !== "string" || version.length === 0) {
    return { ok: false, reason: `${pkgDir}: package.json has no version field` };
  }
  if (version === "0.0.0") {
    return {
      ok: false,
      reason: `${pkgDir}: version is the workspace placeholder "0.0.0" — set an independent semver (0.1.0+) before publish`,
    };
  }
  if (!SEMVER.test(version)) {
    return { ok: false, reason: `${pkgDir}: version "${version}" is not valid semver` };
  }

  const publishConfig = p.publishConfig;
  if (publishConfig === null || typeof publishConfig !== "object" || Array.isArray(publishConfig)) {
    return { ok: false, reason: `${pkgDir}: publishConfig must be an object (e.g. { "access": "public" })` };
  }

  const files = p.files;
  if (!Array.isArray(files) || files.length === 0 || files.some((f) => typeof f !== "string")) {
    return { ok: false, reason: `${pkgDir}: files must be a non-empty string array (spec: ["src", "README.md"])` };
  }

  const exportsField = p.exports;
  if (
    exportsField === null ||
    typeof exportsField !== "object" ||
    Array.isArray(exportsField) ||
    !("." in /** @type {object} */ (exportsField))
  ) {
    return { ok: false, reason: `${pkgDir}: exports must contain a "." entry (spec: { ".": "./src/index.ts" })` };
  }

  return { ok: true };
}
