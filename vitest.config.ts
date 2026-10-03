import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],
    passWithNoTests: true,
    // ISS-30: v8 覆盖率按包报告(只报告不拦截门槛)。
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts", "adapters/src/**/*.ts"],
    },
  },
});
