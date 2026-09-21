/**
 * L0S-T07 — profiles barrel（ProfileRegistry + 类型导出）
 *
 * C1 fs profile / syscall deny 版本化目录：
 *   profiles/v{n}.yaml + v{n}.sha256 + 自指 denyRead + 单调收紧。
 *
 * 裁决 L0S-05：ProfileRegistry 构造器 `{ profilesDir }`；
 *   current() 返回已注册 current profile（须先 load 注册）。
 */

export type { SandboxProfile } from "./loader.js";
export { parseProfileYaml, loadProfile } from "./loader.js";
export type { ProfileDiff } from "./diff.js";
export { diffProfiles } from "./diff.js";
export { assertMonotonicTighten } from "./monotonic.js";

import { resolve } from "node:path";
import { loadProfile } from "./loader.js";
import { diffProfiles } from "./diff.js";
import { assertMonotonicTighten } from "./monotonic.js";
import type { SandboxProfile } from "./loader.js";
import type { ProfileDiff } from "./diff.js";

/**
 * Profile 注册表：加载 + sha256 校验 + 自指 denyRead 注入 +
 * diff + 单调收紧守卫。
 */
export class ProfileRegistry {
  private readonly profilesDir: string;
  private currentProfile: SandboxProfile | undefined;

  constructor(opts?: { profilesDir?: string }) {
    // 缺省指向包内 profiles/ 目录（baseline v1.yaml 所在）。
    this.profilesDir = opts?.profilesDir
      ? resolve(opts.profilesDir)
      : defaultProfilesDir();
  }

  /**
   * 加载并校验一个 profile（sha256 + 自指 denyRead 注入），并注册为 current。
   *
   * 单调收紧守卫（fail-closed）：若已有 current profile，须 prev→next diff
   * 经 assertMonotonicTighten（relaxed 非空即 throw）。防 load 路径静默接受
   * 放宽/回退 profile 绕过「只允许单调收紧」不变量。持平（relaxed 为空）合法。
   *
   * @throws sha256 不匹配（真实 pin 被篡改）时 throw
   * @throws prev→next diff 含放宽项（relaxed 非空）时 throw
   */
  async load(version: string): Promise<SandboxProfile> {
    const p = loadProfile(this.profilesDir, version);
    if (this.currentProfile !== undefined) {
      const d = diffProfiles(this.currentProfile, p);
      assertMonotonicTighten(d);
    }
    this.currentProfile = p;
    return p;
  }

  /** 计算 prev → next 的 diff（fs deny 路径 + syscall 名混合差集）。 */
  diff(prev: SandboxProfile, next: SandboxProfile): ProfileDiff {
    return diffProfiles(prev, next);
  }

  /** 断言 diff 为单调收紧方向（relaxed 非空 → throw）。 */
  assertMonotonicTighten(diff: ProfileDiff): void {
    assertMonotonicTighten(diff);
  }

  /** 返回已注册 current profile（须先 load 注册）。 */
  current(): SandboxProfile {
    if (!this.currentProfile) {
      throw new Error("no profile loaded: call load(version) first");
    }
    return this.currentProfile;
  }
}

function defaultProfilesDir(): string {
  // 包内 profiles/ 目录（src/profiles → ../../profiles）。
  return resolve(new URL("../../profiles/", import.meta.url).pathname);
}
