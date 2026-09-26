// PLG-T11 (smoke): evolve-dsh 真实 ~/.dsh 往返。
//
// Spec: execution/plugin/TASKS.md §PLG-T11 + §0.5（环境探针门控）。
// 探针：`command -v dsh` 可达。无 dsh 环境 skip，exit 0 不红。

import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { FakeLLM, which } from "./helpers.js";
import { DshAdapter } from "@harness/evolve-dsh";

const dshHomeCandidate = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const hasDsh = which("dsh").exitCode === 0 || existsSync(dshHomeCandidate);

describe.skipIf(!hasDsh)("PLG-T11 dsh smoke (real ~/.dsh)", () => {
  it("parses real ~/.dsh event logs without throwing", async () => {
    const a = new DshAdapter({
      dshHome: dshHomeCandidate,
      profile: "default",
      repoRoot: process.cwd(),
      llmPort: new FakeLLM("improve"),
    });
    const trajs = await a.readTrajectories("smoke-sha");
    expect(Array.isArray(trajs)).toBe(true);
  });
});
