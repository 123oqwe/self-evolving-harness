// evolve-cli · 最小 YAML 读写（无第三方依赖）。
//
// 依赖纪律：spec §PLG-T08 建议复用 `yaml` 包，但「禁新 npm 依赖」门控下
// 沿用 PLG-T07（evolve-generic config.ts）先例——本包自有最小解析器。
// scope 限定：evolve.yaml 与 canary 任务文件均为 flat `key: value` 文档，
// 故只需 flat 解析/序列化，不实现嵌套块/锚点/多文档。

import { readFileSync } from "node:fs";

/** flat YAML 文档（string | number | boolean | null 值）。 */
export type FlatYaml = Record<string, string | number | boolean | null>;

/** 解析标量：去引号 → null/true/false → int → float → 原样字符串。 */
function parseScalar(raw: string): string | number | boolean | null {
  const s = raw.trim();
  if (s === "" || s === "~" || s.toLowerCase() === "null") return null;
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  if (s.toLowerCase() === "true") return true;
  if (s.toLowerCase() === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

/** 解析 flat YAML 文本（忽略注释/空行；不支持嵌套块）。 */
export function parseFlatYaml(src: string): FlatYaml {
  const out: FlatYaml = {};
  for (const line of src.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const valueRaw = trimmed.slice(colon + 1);
    // 行内注释剥离（仅对未加引号值；引号内 `#` 保留）。
    let valueStr = valueRaw;
    const unquoted = !/^['"]/.test(valueRaw.trim());
    if (unquoted) {
      const hash = valueStr.indexOf(" #");
      if (hash >= 0) valueStr = valueStr.slice(0, hash);
    }
    out[key] = parseScalar(valueStr);
  }
  return out;
}

/** 读取并解析 flat YAML 文件。 */
export function readFlatYaml(path: string): FlatYaml {
  return parseFlatYaml(readFileSync(path, "utf8"));
}

/** 标量序列化（字符串含特殊字符时加单引号）。 */
function scalar(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (/^[A-Za-z0-9._/@*-]+$/.test(v) && v !== "") return v;
  return `'${v.replace(/'/g, "''")}'`;
}

/** 序列化 flat YAML 文本（key 顺序 = 插入顺序；追加 `# comment` 尾注）。 */
export function writeFlatYaml(doc: FlatYaml, comments?: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(doc)) {
    const comment = comments?.[key];
    lines.push(`${key}: ${scalar(value)}${comment ? `  # ${comment}` : ""}`);
  }
  return lines.join("\n") + "\n";
}
