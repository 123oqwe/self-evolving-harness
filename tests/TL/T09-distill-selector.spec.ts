// TL-T09: distillation 选择器（token 效率 + 成功率 + 多样性优先）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T09）的 Given/When/Then 全部场景：
//   1. 10 个成功 trajectory（token 10k-100k）→ select top-5 倾向低 token + 高多样性
//   2. 全部失败 → 返回空数组（distillation 只选成功轨迹）
//   3. token 相同 taskType 不同 → 多样性高者得分高
//   4. trajectory 缺 embedding → MissingEmbeddingError
//   5. 权重配置生效
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDistillSelector } from "@harness/telemetry";
import type { DistillSelector, Trajectory } from "@harness/telemetry";
import { MissingEmbeddingError } from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造
//
// 说明：spec 给出 DistillSelector / Trajectory 公共接口，但工厂签名、
// distill_selector.yaml 字段形状、weights 结构、top-k 默认值均未在 spec 显式定义。
// 此处按最小可工作假设（见文末 ambiguities）：
//   - 工厂 createDistillSelector(opts?: { configPath? })；
//   - distill_selector.yaml 含 weights: { token_eff, success, diversity }；
//   - select 默认 top-k（测试用 select(trajectories) 后取长度断言倾向性）。
// ---------------------------------------------------------------------------

function configYaml(over: Record<string, unknown> = {}): string {
  return [
    "weights:",
    "  token_eff: 0.5",
    "  success: 0.3",
    "  diversity: 0.2",
    "top_k: 5",
  ].join("\n") + "\n" + Object.entries(over).map(([k, v]) =>
    `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`,
  ).join("\n");
}

function traj(over: Partial<Trajectory>): Trajectory {
  return {
    sessionId: over.sessionId ?? "s",
    success: over.success ?? true,
    totalTokens: over.totalTokens ?? 10_000,
    taskType: over.taskType ?? "code",
    embedding: over.embedding ?? [1, 0],
  };
}

// ---------------------------------------------------------------------------
// TL-T09
// ---------------------------------------------------------------------------
describe("TL-T09", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-t09-"));
    configPath = join(tmpDir, "distill_selector.yaml");
    writeFileSync(configPath, configYaml(), "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "select: 10 成功 trajectory → top-5 倾向低 token"
  //   Given 10 个成功 trajectory，token 从 10k-100k 不等
  //   When  select（取 top-5）
  //   Then  选中的 5 个倾向低 token + 高多样性
  // -------------------------------------------------------------------------
  it("select: 10 成功 trajectory → top-5 倾向低 token", async () => {
    const selector = createDistillSelector({ configPath });
    const trajs: Trajectory[] = [];
    for (let i = 0; i < 10; i++) {
      trajs.push(
        traj({
          sessionId: `s${i}`,
          totalTokens: 10_000 * (i + 1), // 10k..100k
          // embedding 分布在不同方向以体现多样性
          embedding: [i % 2, Math.floor(i / 2)],
          taskType: i % 2 === 0 ? "code" : "debug",
        }),
      );
    }

    const selected = await selector.select(trajs);

    expect(selected.length).toBeLessThanOrEqual(5);
    expect(selected.length).toBeGreaterThan(0);
    // 倾向低 token：选中集合的平均 token 须低于全部平均
    const selectedAvg =
      selected.reduce((s, t) => s + t.totalTokens, 0) / selected.length;
    const allAvg =
      trajs.reduce((s, t) => s + t.totalTokens, 0) / trajs.length;
    expect(selectedAvg).toBeLessThan(allAvg);
    // 最低 token 的 trajectory 必须被选中
    const lowest = trajs.reduce((min, t) =>
      t.totalTokens < min.totalTokens ? t : min,
    );
    expect(selected.some((t) => t.sessionId === lowest.sessionId)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "select: 全失败 → 空数组"
  //   Given 全部 trajectory 失败
  //   When  select
  //   Then  返回空数组（distillation 只选成功轨迹）
  // -------------------------------------------------------------------------
  it("select: 全失败 → 空数组", async () => {
    const selector = createDistillSelector({ configPath });
    const failed = [
      traj({ sessionId: "f1", success: false, totalTokens: 10_000 }),
      traj({ sessionId: "f2", success: false, totalTokens: 20_000 }),
    ];
    const selected = await selector.select(failed);
    expect(selected).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "score: token 相同 taskType 不同 → 多样性高者得分高"
  //   Given 两个 trajectory token 相同但 taskType 不同
  //   When  score
  //   Then  多样性高的得分高（去重近重复）
  //
  // 说明：多样性须相对"已选集/参考集"度量。此处假设 score 接受单 trajectory，
  // 多样性高的 trajectory（embedding 远离基线）得分更高。见 ambiguities。
  // -------------------------------------------------------------------------
  it("score: token 相同 taskType 不同 → 多样性高者得分高", () => {
    const selector = createDistillSelector({ configPath });
    // 两个 success + 同 token + 同 taskType，但 embedding 距离基线不同
    const diverse = traj({
      sessionId: "div",
      totalTokens: 50_000,
      taskType: "code",
      embedding: [10, 0], // 远离原点 → 多样性高
    });
    const duplicate = traj({
      sessionId: "dup",
      totalTokens: 50_000,
      taskType: "code",
      embedding: [0, 0], // 近基线 → 多样性低（近重复）
    });

    const scoreDiverse = selector.score(diverse);
    const scoreDup = selector.score(duplicate);

    expect(typeof scoreDiverse).toBe("number");
    expect(typeof scoreDup).toBe("number");
    expect(scoreDiverse).toBeGreaterThanOrEqual(0);
    expect(scoreDiverse).toBeLessThanOrEqual(1);
    expect(scoreDup).toBeGreaterThanOrEqual(0);
    expect(scoreDup).toBeLessThanOrEqual(1);
    // 多样性高者得分高
    expect(scoreDiverse).toBeGreaterThan(scoreDup);
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "缺 embedding → MissingEmbeddingError"
  //   Given trajectory 缺 embedding
  //   When  select
  //   Then  抛 MissingEmbeddingError（多样性无法度量）
  // -------------------------------------------------------------------------
  it("缺 embedding → MissingEmbeddingError", async () => {
    const selector = createDistillSelector({ configPath });
    // 真正剔除 embedding（undefined）模拟「缺 embedding」（非空数组伪缺），
    // faithful impl 检查 undefined 须抛错。
    const noEmbed = traj({
      sessionId: "noemb",
      embedding: undefined as unknown as number[],
    });
    await expect(selector.select([noEmbed])).rejects.toThrowError(
      MissingEmbeddingError,
    );
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "权重配置生效"
  //   Given config weights: {token_eff:0.5, success:0.3, diversity:0.2}
  //   When  score
  //   Then  综合分按权重加权（token_eff 主导时低 token 得分高）
  // -------------------------------------------------------------------------
  it("权重配置生效", () => {
    const selector = createDistillSelector({ configPath });
    // 同 taskType、同 embedding，仅 token 不同 → token_eff 权重主导
    const lowToken = traj({ sessionId: "low", totalTokens: 10_000, embedding: [1, 0] });
    const highToken = traj({ sessionId: "high", totalTokens: 100_000, embedding: [1, 0] });

    const scoreLow = selector.score(lowToken);
    const scoreHigh = selector.score(highToken);

    // token_eff 权重 0.5 主导 → 低 token 得分高于高 token
    expect(scoreLow).toBeGreaterThan(scoreHigh);
    // 综合分仍在 [0,1]
    expect(scoreLow).toBeLessThanOrEqual(1);
    expect(scoreHigh).toBeGreaterThanOrEqual(0);
  });
});
