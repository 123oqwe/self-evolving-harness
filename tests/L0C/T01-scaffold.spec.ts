// L0C-T01 · monorepo scaffold + pre-commit harness 骨架
// Test-author (RED) — 依据 execution/L0-core/TASKS.md §L0C-T01 spec 编写。
// 断言行为：scaffold 结构、tsconfig strict 护栏、verify.sh dispatch、L0_CORE_VERSION 契约、
// pnpm install/build/test 行为门。当前模块未实现（verify.sh 缺失 / index.ts 仅占位）→ 合法 RED。

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

// ── 仓库根定位：从当前包目录向上找 pnpm-workspace.yaml ────────────────────────
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate repo root from ${start}`);
}

// 当前包目录 = packages/l0-core（spec: pnpm --filter @harness/l0-core vitest run …）
// 从 cwd 向上找仓库根；PKG_DIR = <repoRoot>/packages/l0-core（不依赖 ESM __dirname）
const REPO_ROOT = findRepoRoot(process.cwd());
const PKG_DIR = join(REPO_ROOT, "packages", "l0-core");

// WBS §2 七包权威名表（scope @harness/<name>，目录名 <name>）
const SEVEN_PACKAGES = [
  "l0-core",
  "l0-sandbox",
  "l1-config",
  "l2-memory",
  "l3-engine",
  "canary-eval",
  "telemetry",
] as const;

const SEVEN_SCOPES = SEVEN_PACKAGES.map((n) => `@harness/${n}`);

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf8"));
}

function run(cmd: string, args: string[], opts: { cwd: string; timeout?: number } = { cwd: REPO_ROOT }): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeout ?? 60_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("L0C-T01", () => {
  // ── RED 节指定测试名（必须出现）──────────────────────────────────────────

  it("monorepo has 7 packages", () => {
    // RED: `fs.readdirSync('packages')` 含 7 个目录
    const packagesDir = join(REPO_ROOT, "packages");
    expect(existsSync(packagesDir)).toBe(true);

    const entries = readdirSync(packagesDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

    // 数量
    expect(dirs).toHaveLength(7);
    // 名字完全一致（场景 4：比对 WBS §2 七包名）
    expect(dirs).toEqual([...SEVEN_PACKAGES].sort());

    // 每个目录是合法包（含 package.json + scope 名）
    for (const name of SEVEN_PACKAGES) {
      const pjPath = join(packagesDir, name, "package.json");
      expect(existsSync(pjPath), `${pjPath} should exist`).toBe(true);
      const pj = readJson(pjPath) as { name?: string };
      expect(pj.name).toBe(`@harness/${name}`);
    }
  });

  it("tsconfig strict enabled", () => {
    // RED: 读 tsconfig.base.json 断言 compilerOptions.strict===true
    const base = readJson(join(REPO_ROOT, "tsconfig.base.json")) as {
      compilerOptions?: Record<string, unknown>;
    };
    expect(base.compilerOptions).toBeDefined();
    expect(base.compilerOptions!.strict).toBe(true);

    // 执行提示 ①：static-core 编译期护栏三件套
    expect(base.compilerOptions!.noUncheckedIndexedAccess).toBe(true);
    expect(base.compilerOptions!.exactOptionalPropertyTypes).toBe(true);
  });

  it("verify.sh dispatches TASK-ID", () => {
    // RED: 断言 `bash scripts/verify.sh L0C-T01` exit 0（占位）
    const verifyPath = join(REPO_ROOT, "scripts", "verify.sh");
    expect(existsSync(verifyPath), "scripts/verify.sh should exist").toBe(true);

    // 必须可执行
    const mode = statSync(verifyPath).mode;
    expect(mode & 0o111, "verify.sh should be executable").not.toBe(0);

    // 已知 TASK-ID → exit 0
    const known = run("bash", ["scripts/verify.sh", "L0C-T01"], { cwd: REPO_ROOT });
    expect(known.status, `known TASK-ID should exit 0; stderr=${known.stderr}`).toBe(0);

    // 未知 TASK-ID → exit != 0（dispatch 表只认注册 ID）
    const unknown = run("bash", ["scripts/verify.sh", "DOES-NOT-EXIST-99"], { cwd: REPO_ROOT });
    expect(unknown.status).not.toBe(0);
  });

  // ── 接口契约：L0_CORE_VERSION 导出（spec 接口签名节）──────────────────────

  it("exports L0_CORE_VERSION === 0.1.0", async () => {
    // spec: packages/l0-core/src/index.ts → export const L0_CORE_VERSION = "0.1.0";
    // 直接相对路径导入源文件：packages/l0-core 无 exports 字段，pnpm 不 hoist，
    // vitest 也未配 alias，裸包名 @harness/l0-core 在 vitest 下不可解析。
    const mod = await import("../../src/index.ts");
    expect(mod.L0_CORE_VERSION).toBe("0.1.0");
    expect(typeof mod.L0_CORE_VERSION).toBe("string");
  });

  // ── G/W/T 场景 1：pnpm install 生成 lockfile + 无 peer warning ───────────

  it("pnpm install produces lockfile with no peer warnings", () => {
    // Given 空仓库(scaffold 配置就绪)；When pnpm install；Then pnpm-lock.yaml 生成且无 peer warning。
    // 错误路径护栏：workspace 字段必须存在（缺则 install 失败）。
    const ws = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
    expect(ws).toMatch(/packages:\s*\n\s*-\s*["']?packages\/\*/);

    const res = run("pnpm", ["install", "--frozen-lockfile=false"], { cwd: REPO_ROOT, timeout: 180_000 });
    expect(res.status, `pnpm install should exit 0; stderr=${res.stderr}`).toBe(0);

    const lockPath = join(REPO_ROOT, "pnpm-lock.yaml");
    expect(existsSync(lockPath), "pnpm-lock.yaml should be generated").toBe(true);
    // lockfile 非空且含 lockfileVersion
    const lock = readFileSync(lockPath, "utf8");
    expect(lock.length).toBeGreaterThan(0);
    expect(lock).toMatch(/lockfileVersion/);

    // 无 peer dependency warning（10x 成本/兼容不变量之外的基础卫生）
    const combined = `${res.stdout}\n${res.stderr}`;
    expect(combined, "no peer dependency warnings allowed").not.toMatch(/peer dep(?:endency)?/i);
  });

  // ── G/W/T 场景 2：pnpm -r build 七包全 exit 0；tsconfig extends base 边界 ─

  it("pnpm -r build succeeds for all 7 packages", () => {
    // Given scaffold 完成；When pnpm -r build；Then 7 包全 exit 0。
    const res = run("pnpm", ["-r", "run", "build"], { cwd: REPO_ROOT, timeout: 180_000 });
    expect(res.status, `pnpm -r build should exit 0; stderr=${res.stderr}`).toBe(0);

    // 边界：每包 tsconfig 必须 extends base（某包不 extends → tsc 报错）
    for (const name of SEVEN_PACKAGES) {
      const tsconfig = readJson(join(REPO_ROOT, "packages", name, "tsconfig.json")) as {
        extends?: string;
      };
      expect(tsconfig.extends, `${name}/tsconfig.json must extend base`).toBeDefined();
      expect(tsconfig.extends).toMatch(/tsconfig\.base\.json$/);
    }

    // 不可蒙混护栏：每包 build 脚本必须实际调用 tsc，防止 `"build": "exit 0"` 蒙混。
    for (const name of SEVEN_PACKAGES) {
      const pj = readJson(join(REPO_ROOT, "packages", name, "package.json")) as {
        scripts?: Record<string, string>;
      };
      const buildScript = pj.scripts?.build;
      expect(buildScript, `${name}/package.json must define a build script`).toBeDefined();
      expect(buildScript!, `${name} build script must invoke tsc`).toMatch(/\btsc\b/);
    }
  });

  // ── G/W/T 场景 3：pnpm -r test 空 suite 全绿（vitest 0 test 也 exit 0）────

  it("vitest exits 0 with passWithNoTests", () => {
    // Given scaffold 完成；When pnpm -r test；Then 空 suite 全绿（vitest 0 test 也 exit 0）。
    // 忠实覆盖 spec 的 When：必须实际运行 `pnpm -r test` 并断言 exit 0，
    // 防止实现者把 test 脚本设为 `exit 0` 而蒙混通过。
    const testRes = run("pnpm", ["-r", "run", "test"], { cwd: REPO_ROOT, timeout: 180_000 });
    expect(testRes.status, `pnpm -r run test should exit 0; stderr=${testRes.stderr}`).toBe(0);

    // 补充不变量：用 --passWithNoTests 在指定目录验证 0-test 也绿。
    const res = run(
      "pnpm",
      ["exec", "vitest", "run", "--passWithNoTests", "--root", REPO_ROOT, "--dir", PKG_DIR],
      { cwd: PKG_DIR, timeout: 120_000 },
    );
    expect(res.status, `vitest --passWithNoTests should exit 0; stderr=${res.stderr}`).toBe(0);
  });

  // ── G/W/T 场景 4：目录树比对 WBS §2 七包名完全一致 ─────────────────────────

  it("directory tree matches WBS §2 seven package names exactly", () => {
    // 场景 4 独立断言：除 packages/ 下七目录外无多余/缺失包目录
    const dirs = readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(new Set(dirs)).toEqual(new Set<string>([...SEVEN_PACKAGES]));

    // 同时断言七 scope 在 workspace 内可解析（@harness/<name> 包名存在）
    const rootPj = readJson(join(REPO_ROOT, "package.json")) as { name?: string };
    expect(rootPj.name).toBe("@harness/root");
    for (const scope of SEVEN_SCOPES) {
      const pkgJsonPath = join(REPO_ROOT, "packages", scope.replace(/^@harness\//, ""), "package.json");
      const pj = readJson(pkgJsonPath) as { name?: string };
      expect(pj.name).toBe(scope);
    }
  });
});
