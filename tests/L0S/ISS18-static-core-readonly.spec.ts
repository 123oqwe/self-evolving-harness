// ISS-18: static-core read-only 织进 l0-sandbox fs 隔离（真正边界）。
//
// 背景（VERDICT ISS-18，前置 ISS-10）：把 L0C-T11 的 STATIC_CORE_DIRS
// （repo 内三子树）只读挂载进 l0-sandbox 的 fs profile：
//   - seatbelt: `(deny file-write* (subpath <abs>))` → 写 = EPERM
//   - bwrap:    `--ro-bind <abs> <abs>`（在 `--bind cwd cwd` 之后重挂只读）
//               → 写 = EROFS/EPERM
//   - none/nested: 无法强制（sandboxBypassed=true / fail-closed），闭环由
//     ISS-05 保证不用 NoneBackend。
//
// 本文件锁定三件事：
//   1. `STATIC_CORE_PATHS` 常量 = 三子树（frozen）。
//   2. seatbelt `buildProfile` / bwrap `buildArgs` 对每个 static-core 路径
//      产出 deny-write 片段（argv/profile 文本断言，跨平台确定性）。
//   3. 真实后端（detect()）下，向 static-core 子树写入被内核拒绝、文件不被
//      篡改（platform-gated，detect()==none 时 skip，同附录 A.4 语义）。
//
// 集成测试用临时目录作为 cwd 并内置 `packages/l0-core/` 假子树，写目标落在
// 临时目录内，绝不触碰真实 repo 的 static-core（防误伤）。

import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  STATIC_CORE_PATHS,
  SeatbeltBackend,
  BubblewrapBackend,
  detect,
  type FsRules,
  type NetRules,
} from "@harness/l0-sandbox";

const EMPTY_FS: FsRules = {
  allowWrite: [],
  denyWrite: [],
  denyRead: [],
  allowRead: [],
};
const EMPTY_NET: NetRules = { allowedDomains: [], denyOutCidr: [] };

describe("ISS-18 · STATIC_CORE_PATHS 常量", () => {
  it("registers the three static-core subtrees, frozen", () => {
    expect([...STATIC_CORE_PATHS]).toEqual([
      "packages/l0-core",
      "packages/canary-eval/src/verifier",
      "packages/canary-eval/canary",
    ]);
    expect(Object.isFrozen(STATIC_CORE_PATHS)).toBe(true);
  });
});

describe("ISS-18 · seatbelt 后端 deny file-write", () => {
  it("buildProfile 对每个 static-core 路径产出 deny file-write", () => {
    const backend = new SeatbeltBackend();
    const profile = backend.buildProfile(EMPTY_FS, EMPTY_NET, process.cwd());
    expect(profile).toContain("(deny file-write*");
    for (const rel of STATIC_CORE_PATHS) {
      // rel 是 realpath 后的规范路径子串（本机 repo 根无 symlink）。
      expect(profile, `profile should deny ${rel}`).toContain(rel);
    }
  });
});

describe("ISS-18 · bwrap 后端 --ro-bind", () => {
  it("buildArgs 对存在的 static-core 路径产出 --ro-bind，不存在的跳过", () => {
    const backend = new BubblewrapBackend();
    const argv = backend.buildArgs("true", EMPTY_FS, EMPTY_NET, process.cwd(), []);
    expect(argv[0]).toBe("bwrap");
    for (const rel of STATIC_CORE_PATHS) {
      const abs = resolve(process.cwd(), rel);
      if (existsSync(abs)) {
        const idx = argv.indexOf(abs);
        expect(idx, `argv should contain ${rel}`).toBeGreaterThan(0);
        expect(argv[idx - 1], `--ro-bind should precede ${rel}`).toBe("--ro-bind");
      } else {
        expect(argv, `argv should NOT contain non-existent ${rel}`).not.toContain(abs);
      }
    }
  });

  it("buildArgs 在非 repo 根 cwd（static-core 不存在）时不注入 --ro-bind", () => {
    // bwrap --ro-bind 要求源存在；cwd 非 repo 根时 static-core 不存在 → 跳过。
    const backend = new BubblewrapBackend();
    const argv = backend.buildArgs("true", EMPTY_FS, EMPTY_NET, "/tmp/nonexistent-iss18", []);
    for (const rel of STATIC_CORE_PATHS) {
      expect(argv, `should not inject ${rel} under foreign cwd`).not.toContain(rel);
    }
  });
});

describe("ISS-18 · OS sandbox 内核强制写入拒绝", () => {
  const backend = detect();
  const noBackend = backend.platform === "none";

  it.skipIf(noBackend)(
    "写 static-core 子树被内核拒绝，文件不被篡改",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "iss18-sc-"));
      try {
        const scDir = join(cwd, "packages", "l0-core");
        mkdirSync(scDir, { recursive: true });
        const target = join(scDir, "canary.txt");
        writeFileSync(target, "ORIGINAL\n");

        const result = await backend.runVerify(`echo HACKED > ${target}`, {
          cwd,
          timeout_ms: 10_000,
          fsRules: EMPTY_FS,
          netRules: EMPTY_NET,
        });

        // 内核拒绝：exitCode 非 0（bwrap --ro-bind → EROFS，seatbelt → EPERM）。
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toMatch(
          /Operation not permitted|EPERM|Permission denied|Read-only file system/i,
        );
        // 文件未被篡改（最硬、后端无关的证据）。
        const after = readFileSync(target, "utf8");
        expect(after).toContain("ORIGINAL");
        expect(after).not.toContain("HACKED");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );
});
