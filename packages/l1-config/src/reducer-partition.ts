// L1-T16 · reducer 表 + partition 策略进化（barrier await + tool_use_id static-core；custom_lua 沙箱；partition 不重叠）
//
// fan-out/barrier/reducer 的 reducer 函数表 + partition 策略
// （02-orchestration §3）。进化的对象 = `config/reducers.yaml`
// （`{state_key: {merge_op}}`）+ `config/partition_policy.yaml`
// （fan-out 划分策略）。
//
// **static-core 不变量**（信任域边界，不可被进化改写）：
// - barrier 须 await 全部 child（partial barrier = 数据丢失）。
// - tool_use_id 配对：reducer 合并 tool message 时须按 tool_use_id 配对，
//   不得凭顺序覆盖（02-orchestration §3）。
// - custom_lua reducer 须沙箱：受限 Lua 禁 os/io/网络，违反即拒
//   （02-orchestration §3(f)）。
// - partition 不重叠：fan-out 各 child 的查询/状态分区不得相交
//   （3 child 查同一子查询 = 重复劳动 + 合并冲突）。
//
// 信号 = 合并状态一致性（mergeConsistency↑：无 key 丢失/无重复 message-ID）
// + partition 不重叠率（partitionDisjointRate↑）+ acceptance。
// strict-improvement 门：mergeConsistency↑ ∧ partitionDisjointRate↑，
// 任一退化 → reject 候选 reducer 表（复用 L3-T04 strict-improvement 思路）。
//
// 复用 vs 自研：
// - LangGraph `Annotated[T, operator.add]` / `add_messages` 作 reducer 语义参考。
// - pi `runs.all` 作 fan-out 机制参考。
// - 受限 Lua 沙箱：MVP 用关键字扫描守卫（os/io/socket/http/loadstring/dofile），
//   不引入 fengari/wasmoon 依赖（spec 复用节允许 stub）。
// - 自研：`reducer-partition.ts`（进化 driver + lua 沙箱守卫 + partition 不重叠守卫）。

// ── 公共类型 ───────────────────────────────────────────────────────────────

export type MergeOp = "overwrite" | "append" | "dedup_by_id" | "custom_lua";

export interface ReducerEntry {
  readonly stateKey: string;
  readonly mergeOp: MergeOp;
  /** custom_lua mergeOp 须配 luaScript；其他 mergeOp 忽略。 */
  readonly luaScript?: string;
}

export interface ReducerScore {
  /** 合并状态一致性：无 key 丢失/无重复 message-ID（越高越好）。 */
  readonly mergeConsistency: number;
  /** partition 不重叠率（越高越好）。 */
  readonly partitionDisjointRate: number;
  /** acceptance（越高越好）。 */
  readonly acceptance: number;
  /** 是否为基线（active 当前版本）。 */
  readonly isBaseline: boolean;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * custom_lua reducer 脚本尝试逃逸沙箱（os/io/socket/http/动态加载）。
 * 受限 Lua 禁 os/io/网络，违反即拒（02-orchestration §3(f)）。
 */
export class LuaSandboxEscapeError extends Error {
  constructor(message?: string) {
    super(message ?? "custom_lua reducer escapes sandbox (os/io/network forbidden)");
    this.name = "LuaSandboxEscapeError";
  }
}

/**
 * fan-out partition 交集非空（重复劳动 + 合并冲突）。
 * 3 child 查同一子查询 → throw（02-orchestration §3）。
 */
export class PartitionOverlapError extends Error {
  constructor(message?: string) {
    super(message ?? "fan-out partitions overlap (disjoint invariant violated)");
    this.name = "PartitionOverlapError";
  }
}

// ── 常量 ───────────────────────────────────────────────────────────────────

/** strict-improvement 退化阈值 τ（任一退化 ≥ τ → reject 候选）。 */
const DEFAULT_STRICT_TAU = 0.02;

/**
 * 「并行写覆盖」信号阈值：mergeConsistency 低于此值视为并行写覆盖失败
 * （overwrite 在并行写场景丢消息）→ 触发 overwrite→dedup_by_id 升级。
 */
const PARALLEL_WRITE_SIGNAL_THRESHOLD = 0.7;

/**
 * Lua 沙箱禁用关键字集（受限 Lua 禁 os/io/网络/动态加载）。
 * 以 `name.` 形式匹配库访问（os.execute / io.open / socket.connect / http.get），
 * 以及裸函数名（loadstring / dofile / require）。
 */
const LUA_SANDBOX_FORBIDDEN: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\bos\./, reason: "os library forbidden in sandbox" },
  { pattern: /\bio\./, reason: "io library forbidden in sandbox" },
  { pattern: /\bsocket\./, reason: "socket library forbidden in sandbox" },
  { pattern: /\bhttp\./, reason: "http library forbidden in sandbox" },
  { pattern: /\bloadstring\b/, reason: "loadstring forbidden in sandbox" },
  { pattern: /\bdofile\b/, reason: "dofile forbidden in sandbox" },
  { pattern: /\brequire\b/, reason: "require forbidden in sandbox" },
];

// ── 纯函数：strict-improvement 门 ──────────────────────────────────────────

/**
 * strict-improvement 硬门：mergeConsistency↑ ∧ partitionDisjointRate↑，
 * 任一退化 ≥ τ → false。
 *
 * - mergeConsistency：越高越好；candidate < baseline 为退化
 *   （baseline - cand >= τ → reject）。
 * - partitionDisjointRate：越高越好；candidate < baseline 为退化
 *   （baseline - cand >= τ → reject）。
 *
 * 纯函数无 IO，便于 canary 对抗场景复用（与 T04b/T15 strictImprovementGate 同构）。
 */
export function reducerStrictImprovementGate(
  cand: ReducerScore,
  baseline: ReducerScore,
  tau: number,
): boolean {
  // mergeConsistency 越高越好：candidate < baseline 为退化
  if (baseline.mergeConsistency - cand.mergeConsistency >= tau) return false;
  // partitionDisjointRate 越高越好：candidate < baseline 为退化
  if (baseline.partitionDisjointRate - cand.partitionDisjointRate >= tau) return false;
  return true;
}

// ── 纯函数：partition 不重叠守卫 ───────────────────────────────────────────

/**
 * partition 不重叠守卫（static-core）：fan-out 各 child 的分区不得相交。
 *
 * 用集合交集检测：任两个 partition 的 key 交集非空 → throw
 * `PartitionOverlapError`（重复劳动 + 合并冲突，回滚 + 安全告警）。
 *
 * 纯函数无 IO，供 canary 对抗场景（N child 并发写同一 state key）复用
 * （spec REFACTOR：抽成纯函数）。
 */
export function checkPartitionsDisjoint(partitions: readonly (readonly string[])[]): void {
  for (let i = 0; i < partitions.length; i++) {
    const setI = new Set(partitions[i] ?? []);
    for (let j = i + 1; j < partitions.length; j++) {
      for (const key of partitions[j] ?? []) {
        if (setI.has(key)) {
          throw new PartitionOverlapError(
            `partitions[${i}] and partitions[${j}] overlap on key "${key}"`,
          );
        }
      }
    }
  }
}

// ── 纯函数：custom_lua 沙箱守卫 ────────────────────────────────────────────

/**
 * custom_lua reducer 沙箱守卫（static-core）：受限 Lua 禁 os/io/网络/动态加载。
 *
 * 扫描关键字集（os./io./socket./http./loadstring/dofile/require），
 * 命中 → throw `LuaSandboxEscapeError`（02-orchestration §3(f)）。
 *
 * 纯函数无 IO，供 commit/canary 前守卫复用。
 */
export function checkLuaSandboxed(luaScript: string): void {
  for (const { pattern, reason } of LUA_SANDBOX_FORBIDDEN) {
    if (pattern.test(luaScript)) {
      throw new LuaSandboxEscapeError(reason);
    }
  }
}

// ── ReducerPartition ───────────────────────────────────────────────────────

export interface ReducerPartitionOptions {
  /** strict-improvement 退化阈值 τ（缺省 DEFAULT_STRICT_TAU）。 */
  readonly tau?: number;
}

/**
 * reducer 表 + partition 策略进化 driver + custom_lua 沙箱守卫 +
 * partition 不重叠守卫。
 *
 * - `evolve(reducers, partition, scores)`：候选 reducer 表经
 *   strict-improvement 门 + 并行写信号 → 返回 evolved `{ reducers, partition }`。
 * - `assertLuaSandboxed(luaScript)`：custom_lua 沙箱守卫，含 os/io/网络 → throw。
 * - `assertPartitionDisjoint(partitions)`：partition 不重叠守卫，交集非空 → throw。
 *
 * barrier await 全部 child + tool_use_id 配对 = static-core，由 L0C 不变量测试
 * 集断言，本类不进化（仅消费）。custom_lua reducer 须沙箱；partition 须不重叠。
 */
export class ReducerPartition {
  private readonly tau: number;

  constructor(opts: ReducerPartitionOptions = {}) {
    this.tau = opts.tau ?? DEFAULT_STRICT_TAU;
  }

  /**
   * strict-improvement 硬门：mergeConsistency↑ ∧ partitionDisjointRate↑，
   * 任一退化 ≥ τ → false。
   *
   * 纯函数无 IO，便于 canary 对抗场景复用（与 T04b/T15 strictImprovementGate 同构）。
   */
  strictImprovementGate(
    cand: ReducerScore,
    baseline: ReducerScore,
    tau: number = this.tau,
  ): boolean {
    return reducerStrictImprovementGate(cand, baseline, tau);
  }

  /**
   * 进化 reducer 表：候选经 strict-improvement 门 + 并行写信号检测
   * → 返回 evolved `{ reducers, partition }`。
   *
   * - 「并行写覆盖」信号（mergeConsistency < PARALLEL_WRITE_SIGNAL_THRESHOLD）
   *   → overwrite 升级为 dedup_by_id（并行写场景 overwrite 丢消息）。
   * - 候选 strict-improvement 通过（mergeConsistency↑ ∧ partitionDisjointRate↑）
   *   → append/overwrite 升级为 dedup_by_id（改善合并一致性）。
   * - custom_lua 候选须沙箱校验通过（assertLuaSandboxed），违反 → throw。
   *
   * 退化或无候选 → 原样回传（不入选，需人审/canary）。
   */
  evolve(
    reducers: readonly ReducerEntry[],
    partition: string,
    scores: readonly ReducerScore[],
  ): { reducers: readonly ReducerEntry[]; partition: string } {
    const baseline = scores.find((s) => s.isBaseline) ?? null;
    const candidates = scores.filter((s) => !s.isBaseline);

    // 「并行写覆盖」信号：任一 score mergeConsistency 低（含候选/基线）
    const parallelWriteSignal = scores.some(
      (s) => s.mergeConsistency < PARALLEL_WRITE_SIGNAL_THRESHOLD,
    );

    // strict-improvement：候选 mergeConsistency↑ ∧ partitionDisjointRate↑
    let improved = false;
    if (baseline && candidates.length > 0) {
      improved = candidates.some((cand) => this.strictImprovementGate(cand, baseline));
    }

    if (!parallelWriteSignal && !improved) {
      // 无改善信号 → 原样回传（退化候选 reject）
      return { reducers, partition };
    }

    // 升级 reducer 表：overwrite/append → dedup_by_id（改善并行写合并一致性）
    const evolvedReducers: ReducerEntry[] = reducers.map((r) => {
      if (parallelWriteSignal && r.mergeOp === "overwrite") {
        return { ...r, mergeOp: "dedup_by_id" };
      }
      if (improved && (r.mergeOp === "overwrite" || r.mergeOp === "append")) {
        return { ...r, mergeOp: "dedup_by_id" };
      }
      return r;
    });

    // custom_lua 候选须沙箱校验通过（commit 前守卫）
    for (const r of evolvedReducers) {
      if (r.mergeOp === "custom_lua" && r.luaScript) {
        this.assertLuaSandboxed(r.luaScript);
      }
    }

    return { reducers: evolvedReducers, partition };
  }

  /**
   * custom_lua reducer 沙箱守卫（static-core）：受限 Lua 禁 os/io/网络/动态加载。
   *
   * 含 os.execute / io.open / socket / http / loadstring / dofile / require
   * → throw `LuaSandboxEscapeError`（02-orchestration §3(f)）。
   */
  assertLuaSandboxed(luaScript: string): void {
    checkLuaSandboxed(luaScript);
  }

  /**
   * partition 不重叠守卫（static-core）：fan-out 各 child 的分区不得相交。
   *
   * 任两个 partition 交集非空 → throw `PartitionOverlapError`
   * （重复劳动 + 合并冲突，回滚 + 安全告警）。
   */
  assertPartitionDisjoint(partitions: readonly (readonly string[])[]): void {
    checkPartitionsDisjoint(partitions);
  }
}
