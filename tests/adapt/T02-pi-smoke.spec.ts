// ADP-T02: pi 适配器真实 pi -p 往返 smoke（skipIf 无 pi 环境）
//
// 覆盖 spec（execution/adapt/TASKS.md §ADP-T02 smoke）：
//   - it.skipIf(!canSpawnPi): 真实 pi -p 往返返回非空字符串
//
// 门控：检测 pi CLI 是否可用（command -v pi）。CI 无 pi 时自动跳过不红；
// 本地有 pi 时真跑。mock 子进程测试为主体（见 T02-pi-adapter.spec.ts）。
//
// RED state: @harness/adapters 未实现 → import 失败 = 合法 RED（即使 skipIf
// 的 pi 可达，import 抛错使文件 RED）。实现 GREEN 后，无 pi 环境 skip、
// 有 pi 环境真跑往返。
//
import { describe, it, expect } from "vitest";
import { canSpawnPi } from "./pi-probe";
import { PiHeadlessLLM } from "@harness/adapters";
import { hasPiCli } from "./fixtures/helpers";

const hasPi = hasPiCli();

describe("ADP-T02 · real pi -p smoke", () => {
  it.skipIf(!canSpawnPi)(
    "real pi -p roundtrip returns non-empty",
    async () => {
      const llm = new PiHeadlessLLM({
        piBin: "pi",
        // 不指定 model，用 pi 默认 model（spec 执行提示(3)）
        timeoutMs: 60_000,
        maxRetries: 1,
      });
      const out = await llm.complete("Reply with the single word PONG");
      // Then 返回非空字符串
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    },
    90_000,
  );
});
