import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 包内单测配置（本地手动运行，不入根套件 / GREENS 基线）：
//   pnpm vitest run --config packages/l0-sandbox/vitest.config.ts
// 根 vitest.config.ts 的 include 是 tests/**/*.spec.ts，不会收集本目录；
// test-lock 门只锁定 tests/ 下的 *.spec.ts，本文件不受锁约束。
// tsconfig include 仅 src/，本目录不参与 tsc --noEmit。
export default defineConfig({
  test: {
    // 锚定到本包目录：--config 从仓库根调用时 include 相对 cwd 解析会失效。
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["test/**/*.spec.ts"],
    passWithNoTests: true,
  },
});
