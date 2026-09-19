// L2-T01: Agent Skills 标准加载器 [MVP]
//
// 把磁盘上的 skill 目录按 Agent Skills 开放标准加载为内存对象，执行 load-time 校验，
// 供给 3-level progressive disclosure。复用 pi skill loader 的校验规则：
//   - 缺 description 不加载
//   - malformed warn 不加载
//   - name 冲突 first-wins + warn
//   - name>64 / invalid warn（name 正则 ^[a-z0-9-]{1,64}$）
//
// 注意：本仓库未安装 `yaml` npm 包（且任务规则禁新增依赖），故 frontmatter 解析
// 采用自实现的容错 YAML 子集解析器（复用 REFACTOR 要求的 parseFrontmatter 纯函数），
// 语义覆盖 spec 与测试所用 frontmatter 形状。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

export type SkillFrontmatter = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  "allowed-tools"?: string[];
  "disable-model-invocation"?: boolean;
};

export interface LoadedSkill {
  dir: string;
  frontmatter: SkillFrontmatter;
  body: string;
  scriptsDir?: string;
  referencesDir?: string;
  level: 1 | 2 | 3;
}

export type LoadError = {
  kind: "missing-description" | "malformed" | "name-collision" | "name-invalid";
  dir: string;
  msg: string;
};

// name 正则：^[a-z0-9-]{1,64}$；description ≤ 1024 chars
const NAME_REGEX = /^[a-z0-9-]{1,64}$/;
const MAX_DESCRIPTION = 1024;

// ---------------------------------------------------------------------------
// REFACTOR: parseFrontmatter 纯函数（L2-T15 trust gate 复用）
// 解析 SKILL.md 的 `---` 分隔 frontmatter 块。返回 { fm, body, error }。
// ---------------------------------------------------------------------------

interface ParsedFrontmatter {
  fm: SkillFrontmatter | null;
  body: string;
  error: LoadError | null;
}

export function parseFrontmatter(
  raw: string,
  dir: string,
): ParsedFrontmatter {
  const lines = raw.split(/\r?\n/);

  // 缺 `---` 开分隔符 → malformed
  const first = lines[0];
  if (first === undefined || first.trim() !== "---") {
    return { fm: null, body: "", error: { kind: "malformed", dir, msg: "missing opening '---' delimiter" } };
  }

  // 找闭合 `---`
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex === -1) {
    return { fm: null, body: "", error: { kind: "malformed", dir, msg: "missing closing '---' delimiter" } };
  }

  const fmLines = lines.slice(1, closeIndex);
  const bodyLines = lines.slice(closeIndex + 1);
  // 去掉 body 开头一个空行（spec 约定 `---\n${body}` 形式）
  if (bodyLines.length > 0 && bodyLines[0] === "") {
    bodyLines.shift();
  }
  const body = bodyLines.join("\n");

  const fm = parseYamlLines(fmLines);
  if (fm === null) {
    return { fm: null, body, error: { kind: "malformed", dir, msg: "frontmatter is not a valid YAML mapping" } };
  }
  return { fm, body, error: null };
}

// 解析 YAML 子集：每行 `key: value`，value 容错（先 JSON.parse，失败则 bare string）。
// 支持空 value（→ 空串）。返回 SkillFrontmatter 或 null（非 mapping / 解析失败）。
function parseYamlLines(lines: string[]): SkillFrontmatter | null {
  const fm: Record<string, unknown> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      // 非 key:value 行 → 视为 malformed mapping
      return null;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    let valueRaw = trimmed.slice(colonIdx + 1).trim();
    let value: unknown;
    if (valueRaw === "") {
      value = "";
    } else {
      // 先尝试 JSON 解析（覆盖 "str"、["a","b"]、true、123、{...}）
      try {
        value = JSON.parse(valueRaw);
      } catch {
        // bare string：去掉成对引号
        if (
          valueRaw.length >= 2 &&
          ((valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
            (valueRaw.startsWith("'") && valueRaw.endsWith("'")))
        ) {
          value = valueRaw.slice(1, -1);
        } else {
          value = valueRaw;
        }
      }
    }
    fm[key] = value;
  }
  return fm as SkillFrontmatter;
}

// ---------------------------------------------------------------------------
// 目录可达性（scripts / references 子目录存在性）
// ---------------------------------------------------------------------------

function dirIfExists(parent: string, child: string): string | undefined {
  const p = join(parent, child);
  if (existsSync(p)) {
    try {
      if (statSync(p).isDirectory()) return p;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// loadSkill / loadAll
// ---------------------------------------------------------------------------

export function loadSkill(dir: string): LoadedSkill | LoadError {
  const skillMdPath = join(dir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    return { kind: "malformed", dir, msg: "SKILL.md not found" };
  }
  let raw: string;
  try {
    raw = readFileSync(skillMdPath, "utf8");
  } catch {
    return { kind: "malformed", dir, msg: "SKILL.md unreadable" };
  }

  const { fm, body, error } = parseFrontmatter(raw, dir);
  if (error !== null || fm === null) {
    return error ?? { kind: "malformed", dir, msg: "frontmatter parse failed" };
  }

  // name 校验
  const name = fm.name;
  if (typeof name !== "string" || !NAME_REGEX.test(name)) {
    return { kind: "name-invalid", dir, msg: `name does not match ${NAME_REGEX.source}: ${JSON.stringify(name)}` };
  }

  // description 校验（缺或空 → missing-description）
  const desc = fm.description;
  if (typeof desc !== "string" || desc === "") {
    return { kind: "missing-description", dir, msg: "frontmatter.description is missing or empty" };
  }
  if (desc.length > MAX_DESCRIPTION) {
    return { kind: "missing-description", dir, msg: `description exceeds ${MAX_DESCRIPTION} chars` };
  }

  const scriptsDir = dirIfExists(dir, "scripts");
  const referencesDir = dirIfExists(dir, "references");
  // level 标注：L3 = scripts/references 可达；否则 L1（name+description+body 基线）。
  const level: 1 | 2 | 3 = scriptsDir !== undefined || referencesDir !== undefined ? 3 : 1;

  const result: LoadedSkill = { dir, frontmatter: fm, body, level };
  if (scriptsDir !== undefined) result.scriptsDir = scriptsDir;
  if (referencesDir !== undefined) result.referencesDir = referencesDir;
  return result;
}

export function loadAll(roots: string[]): LoadedSkill[] {
  const byName = new Map<string, LoadedSkill>();
  for (const root of roots) {
    // root 可以是 skill 目录本身（含 SKILL.md），也可以是父目录（含多个 skill 子目录）
    const dirs = enumerateSkillDirs(root);
    for (const dir of dirs) {
      const result = loadSkill(dir);
      if ("kind" in result) {
        // LoadError → warn 不抛，不阻塞其他 skill 加载
        console.warn(`[l2-memory] loadSkill failed (${result.kind}): ${result.msg} [${result.dir}]`);
        continue;
      }
      const name = result.frontmatter.name;
      if (byName.has(name)) {
        // first-wins + warn
        console.warn(
          `[l2-memory] name-collision for '${name}': keeping [${byName.get(name)!.dir}], skipping [${dir}]`,
        );
        continue;
      }
      byName.set(name, result);
    }
  }
  return Array.from(byName.values());
}

// 给定 root：若 root/SKILL.md 存在 → [root]；否则枚举 root 下含 SKILL.md 的直接子目录。
function enumerateSkillDirs(root: string): string[] {
  if (existsSync(join(root, "SKILL.md"))) {
    return [root];
  }
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const ent of entries) {
    const name: string = ent.name;
    if (ent.isDirectory() && existsSync(join(root, name, "SKILL.md"))) {
      dirs.push(join(root, name));
    }
  }
  return dirs;
}
