// TL-T08: 失败聚类器（Clio-style embedding + clusterer_config）v0
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T08）的 Given/When/Then 全部场景：
//   1. 5 个失败 turn（3 相似 tool 超时 + 2 相似 schema 校验失败）→ 2 cluster 正确分组
//   2. min_cluster_size=2 + 单个失败 turn → 进 outliers cluster（不强行聚类）
//   3. k='auto' → 自动选 k
//   4. embedding 模型不可用 → EmbeddingUnavailableError
//   5. labelCluster → 返回 label_schema 内标签
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFailureClusterer } from "@harness/telemetry";
import type {
  FailureClusterer,
  FailureCluster,
  FailedTurn,
  ClustererConfig,
  EmbeddingProvider,
} from "@harness/telemetry";
import { EmbeddingUnavailableError } from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造
//
// 说明：spec 给出 FailureClusterer / FailureCluster / ClustererConfig 公共接口，
// 但 FailedTurn 类型、EmbeddingProvider 接口、工厂签名、clusterer_config.yaml
// 字段形状、outliers cluster 表示均未在 spec 显式定义。此处按最小可工作假设
// （见文末 ambiguities）：
//   - FailedTurn = { uuid: string; content: string }（最小可 embed 文本）；
//   - EmbeddingProvider = { embed(turn: FailedTurn): Promise<number[]> }；
//   - 工厂 createFailureClusterer(opts: { configPath?, embeddingProvider? })；
//   - min_cluster_size 不满足的 turn 归入一个 label='outliers' 的 cluster。
// 测试用固定向量 mock embedding，确保聚类确定性可测。
// ---------------------------------------------------------------------------

function configYaml(over: Record<string, unknown> = {}): string {
  return [
    "embedding_model: mock-embed-v1",
    "k: 2",
    "min_cluster_size: 2",
    "label_schema:",
    "  - tool_timeout",
    "  - schema_validation_failure",
    "  - outliers",
  ].join("\n") + "\n" + Object.entries(over).map(([k, v]) => `${k}: ${v}`).join("\n");
}

function turn(uuid: string, content: string): FailedTurn {
  return { uuid, content } as unknown as FailedTurn;
}

/** 固定向量 mock embedding：按 content key 映射到 2D 向量。 */
class FixedEmbedding implements EmbeddingProvider {
  constructor(private readonly map: Map<string, number[]>) {}
  async embed(turn: FailedTurn): Promise<number[]> {
    const key = (turn as unknown as { content: string }).content;
    const v = this.map.get(key);
    if (!v) throw new Error(`no fixed vector for ${key}`);
    return v;
  }
}

/** 不可用 embedding：始终抛错。 */
class UnavailableEmbedding implements EmbeddingProvider {
  async embed(): Promise<number[]> {
    throw new EmbeddingUnavailableError("embedding provider unavailable");
  }
}

// 找含指定成员 uuid 的 cluster
function clusterOf(clusters: FailureCluster[], memberUuid: string): FailureCluster | undefined {
  return clusters.find((c) => c.members.includes(memberUuid));
}

// ---------------------------------------------------------------------------
// TL-T08
// ---------------------------------------------------------------------------
describe("TL-T08", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-t08-"));
    configPath = join(tmpDir, "clusterer_config.yaml");
    writeFileSync(configPath, configYaml(), "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "clusterFailures: 5 个失败 → 2 cluster 正确分组"
  //   Given 5 个失败 turn（3 个相似：tool 调用超时；2 个相似：schema 校验失败）
  //   When  clusterFailures（用 mock embedding 固定向量）
  //   Then  产出 2 个 cluster，members 正确分组
  // -------------------------------------------------------------------------
  it("clusterFailures: 5 个失败 → 2 cluster 正确分组", async () => {
    const vecs = new Map<string, number[]>([
      ["timeout-a", [1, 0]],
      ["timeout-b", [1, 0]],
      ["timeout-c", [1, 0]],
      ["schema-a", [0, 1]],
      ["schema-b", [0, 1]],
    ]);
    const clusterer = createFailureClusterer({
      configPath,
      embeddingProvider: new FixedEmbedding(vecs),
    });
    const turns = [
      turn("t1", "timeout-a"),
      turn("t2", "timeout-b"),
      turn("t3", "timeout-c"),
      turn("t4", "schema-a"),
      turn("t5", "schema-b"),
    ];

    const clusters = await clusterer.clusterFailures(turns);

    expect(clusters.length).toBe(2);
    // 全部 turn 都被分到某个 cluster
    const allMembers = clusters.flatMap((c) => c.members);
    expect(allMembers.sort()).toEqual(
      ["t1", "t2", "t3", "t4", "t5"].sort(),
    );
    // 超时组 3 个成员同 cluster
    const t1c = clusterOf(clusters, "t1");
    expect(t1c?.members.sort()).toEqual(["t1", "t2", "t3"].sort());
    // schema 组 2 个成员同 cluster
    const t4c = clusterOf(clusters, "t4");
    expect(t4c?.members.sort()).toEqual(["t4", "t5"].sort());
    // 两组不同 cluster
    expect(t1c).not.toBe(t4c);
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "min_cluster_size=2: 单个失败进 outliers"
  //   Given 1 个失败 turn（min_cluster_size=2）
  //   When  clusterFailures
  //   Then  该 turn 进 outliers cluster（不强行聚类）
  // -------------------------------------------------------------------------
  it("min_cluster_size=2: 单个失败进 outliers", async () => {
    const cfg2 = join(tmpDir, "min2.yaml");
    writeFileSync(cfg2, configYaml({ k: 1, min_cluster_size: 2 }), "utf8");
    const vecs = new Map<string, number[]>([["solo", [1, 0]]]);
    const clusterer = createFailureClusterer({
      configPath: cfg2,
      embeddingProvider: new FixedEmbedding(vecs),
    });

    const clusters = await clusterer.clusterFailures([turn("s1", "solo")]);

    expect(clusters.length).toBeGreaterThanOrEqual(1);
    // 单个 turn 须归入 outliers cluster（不强行聚成正常簇）
    const outlier = clusters.find(
      (c) => c.label === "outliers" || /outlier/i.test(c.label),
    );
    expect(outlier).toBeDefined();
    expect(outlier!.members).toContain("s1");
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "k=auto: 自动选 k"
  //   Given k='auto'
  //   When  clusterFailures
  //   Then  自动选 k（产出 >=1 cluster，全部 turn 被覆盖）
  // -------------------------------------------------------------------------
  it("k=auto: 自动选 k", async () => {
    const autoCfg = join(tmpDir, "auto.yaml");
    writeFileSync(autoCfg, configYaml({ k: "auto", min_cluster_size: 1 }), "utf8");
    const vecs = new Map<string, number[]>([
      ["a", [1, 0]],
      ["b", [1, 0]],
      ["c", [0, 1]],
    ]);
    const clusterer = createFailureClusterer({
      configPath: autoCfg,
      embeddingProvider: new FixedEmbedding(vecs),
    });

    const clusters = await clusterer.clusterFailures([
      turn("u1", "a"),
      turn("u2", "b"),
      turn("u3", "c"),
    ]);

    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const allMembers = clusters.flatMap((c) => c.members).sort();
    expect(allMembers).toEqual(["u1", "u2", "u3"].sort());
    // k 由算法自动决定，不得抛错或退化
    expect(clusters.every((c) => c.clusterId.length > 0)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "embedding 不可用 → EmbeddingUnavailableError"
  //   Given embedding 模型不可用
  //   When  clusterFailures
  //   Then  抛 EmbeddingUnavailableError，不静默用空 embedding
  // -------------------------------------------------------------------------
  it("embedding 不可用 → EmbeddingUnavailableError", async () => {
    const clusterer = createFailureClusterer({
      configPath,
      embeddingProvider: new UnavailableEmbedding(),
    });
    await expect(
      clusterer.clusterFailures([turn("e1", "anything")]),
    ).rejects.toThrowError(EmbeddingUnavailableError);
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "labelCluster: 返回 label_schema 内标签"
  //   Given 一个 cluster 含"tool 调用超时"类失败
  //   When  labelCluster
  //   Then  返回标签如 'tool_timeout'（从 label_schema 选）
  // -------------------------------------------------------------------------
  it("labelCluster: 返回 label_schema 内标签", async () => {
    const vecs = new Map<string, number[]>([
      ["timeout-a", [1, 0]],
      ["timeout-b", [1, 0]],
    ]);
    const clusterer = createFailureClusterer({
      configPath,
      embeddingProvider: new FixedEmbedding(vecs),
    });
    const clusters = await clusterer.clusterFailures([
      turn("t1", "timeout-a"),
      turn("t2", "timeout-b"),
    ]);
    const target = clusters[0]!;
    const label = await clusterer.labelCluster(target);

    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
    // 标签须落在 label_schema 集合内
    const schema = ["tool_timeout", "schema_validation_failure", "outliers"];
    expect(schema).toContain(label);
    // 标签须与失败类型匹配：content 含 'timeout' → 须选 'tool_timeout'，
    // 防止空壳实现恒返首个 schema 条目蒙混过关
    expect(label).toBe("tool_timeout");
  });
});
