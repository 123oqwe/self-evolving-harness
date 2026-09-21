/**
 * L0S-T07 — profile loader
 *
 * 职责：
 *   - 读取 `v{n}.yaml` 并解析为 SandboxProfile（极简 YAML 解析，不引入 js-yaml 依赖）。
 *   - 旁挂 `v{n}.sha256` 锁定文件：当 sidecar 是「真实 pin」（非空且非全零 sentinel）
 *     时，校验 sha256(yaml 内容) === sidecar，不匹配 → throw（篡改检测）。
 *   - 自指 denyRead 注入：把 profile 目录自身追加进 fs.denyRead，
 *     防 agent 读 profile 推测收紧策略（02-sandbox-security C1 不变量）。
 *
 * 裁决 L0S-05：profile 文件命名 `v{n}.yaml` + 旁挂 `v{n}.sha256`；
 *   YAML schema 直映 SandboxProfile（version/fs/syscalls/sha256）。
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { FsRules } from "../os-sandbox/types.js";

/** 沙箱策略 profile（C1 fs profile / syscall deny 版本化对象）。 */
export interface SandboxProfile {
  version: string;
  fs: FsRules;
  syscalls: { deny: string[] };
  sha256: string;
}

/** 全零 sentinel = 未钉死（authoring 占位），跳过 sha256 校验。 */
const UNPINNED_SENTINEL = "0".repeat(64);

/**
 * 极简 YAML 解析：仅支持本 profile schema 的形状
 *   version: <scalar>
 *   fs:
 *     allowWrite: [ - item ... ]
 *     denyWrite:  [ - item ... ]
 *     denyRead:   [ - item ... ]
 *     allowRead:  [ - item ... ]
 *   syscalls:
 *     deny: [ - item ... ]
 *
 * 不引入 js-yaml 依赖（与 telemetry / l1-config 自研极简解析一致）。
 */
export function parseProfileYaml(content: string): Omit<SandboxProfile, "sha256"> {
  const lines = content.split("\n");
  const version = "v?";
  // 缺省四字段为空数组，保证 FsRules 形状完整。
  const fs: FsRules = {
    allowWrite: [],
    denyWrite: [],
    denyRead: [],
    allowRead: [],
  };
  const syscalls = { deny: [] as string[] };

  let i = 0;
  // 顶层 key: value
  const topScalar: Record<string, string> = {};
  while (i < lines.length) {
    const raw = lines[i]!;
    i++;
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    const key = m[1];
    const val = m[2].trim();
    if (val !== "") {
      // 顶层 scalar（如 version: v1）
      topScalar[key] = val;
      continue;
    }
    // val 为空 → 后续缩进块为该 key 的子结构
    // 收集本块缩进行
    const childLines: string[] = [];
    while (i < lines.length) {
      const cl = lines[i]!;
      if (cl.trim() === "") {
        i++;
        continue;
      }
      if (/^\s+/.test(cl)) {
        childLines.push(cl);
        i++;
      } else {
        break;
      }
    }
    if (key === "fs") {
      parseFsBlock(childLines, fs);
    } else if (key === "syscalls") {
      parseSyscallsBlock(childLines, syscalls);
    }
    // 其余顶层未知块忽略（向前兼容）
  }

  return {
    version: topScalar["version"] ?? version,
    fs,
    syscalls,
  };
}

/** 解析 `fs:` 子块：四个列表字段。 */
function parseFsBlock(childLines: string[], fs: FsRules): void {
  let j = 0;
  while (j < childLines.length) {
    const raw = childLines[j]!;
    j++;
    const m = /^\s+([A-Za-z0-9_]+):\s*$/.exec(raw);
    if (!m || m[1] === undefined) continue;
    const field = m[1] as keyof FsRules;
    const list: string[] = [];
    while (j < childLines.length) {
      const cl = childLines[j]!;
      const itemMatch = /^\s+-\s+(.*)$/.exec(cl);
      if (itemMatch && itemMatch[1] !== undefined) {
        list.push(stripQuotes(itemMatch[1].trim()));
        j++;
      } else if (cl.trim() === "") {
        j++;
        // 空行后若遇到下一字段头则结束本字段
        const next = childLines[j];
        if (next !== undefined && /^\s+([A-Za-z0-9_]+):\s*$/.test(next)) break;
        continue;
      } else {
        break;
      }
    }
    if (field in fs) {
      (fs[field] as string[]) = list;
    }
  }
}

/** 解析 `syscalls:` 子块：deny 列表。 */
function parseSyscallsBlock(
  childLines: string[],
  syscalls: { deny: string[] },
): void {
  let j = 0;
  while (j < childLines.length) {
    const raw = childLines[j]!;
    j++;
    const m = /^\s+([A-Za-z0-9_]+):\s*$/.exec(raw);
    if (!m || m[1] === undefined) continue;
    const field = m[1];
    const list: string[] = [];
    while (j < childLines.length) {
      const cl = childLines[j]!;
      const itemMatch = /^\s+-\s+(.*)$/.exec(cl);
      if (itemMatch && itemMatch[1] !== undefined) {
        list.push(stripQuotes(itemMatch[1].trim()));
        j++;
      } else if (cl.trim() === "") {
        j++;
        const next = childLines[j];
        if (next !== undefined && /^\s+([A-Za-z0-9_]+):\s*$/.test(next)) break;
        continue;
      } else {
        break;
      }
    }
    if (field === "deny") {
      syscalls.deny = list;
    }
  }
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/** 计算 yaml 文件内容的 sha256（utf8，与 crypto.createHash().update(string) 一致）。 */
function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * 加载并校验一个 profile。
 *
 * @param profilesDir profile 目录
 * @param version 形如 `v1`（不带扩展名）
 * @returns 校验通过、已注入自指 denyRead 的 SandboxProfile
 * @throws sha256 不匹配（真实 pin 被篡改）时 throw
 */
export function loadProfile(
  profilesDir: string,
  version: string,
): SandboxProfile {
  const yamlPath = join(profilesDir, `${version}.yaml`);
  const shaPath = join(profilesDir, `${version}.sha256`);

  const content = readFileSync(yamlPath, "utf8");
  const parsed = parseProfileYaml(content);
  const computed = sha256Of(content);

  // 旁挂 sha256 锁定：真实 pin（非空、非全零 sentinel）须严格匹配。
  if (existsSync(shaPath)) {
    const pinned = readFileSync(shaPath, "utf8").trim();
    if (pinned !== "" && pinned !== UNPINNED_SENTINEL) {
      if (pinned !== computed) {
        throw new Error(
          `profile ${version} sha256 mismatch: expected ${pinned}, got ${computed}`,
        );
      }
    }
  }

  // 自指 denyRead：把 profile 目录自身注入 denyRead（防 agent 读 profile 推测策略）。
  const selfDir = resolve(profilesDir);
  if (!parsed.fs.denyRead.includes(selfDir)) {
    parsed.fs.denyRead = [...parsed.fs.denyRead, selfDir];
  }

  return { ...parsed, sha256: computed };
}
