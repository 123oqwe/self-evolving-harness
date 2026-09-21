// TL-T11: insight 记忆条目（ExpeL 算子 + clean canary 反降分隔离 + Ratchet C=50）
//
// 失败簇 → ExpeL 风格 NL insight（procedural memory 条目）。ExpeL ADD/EDIT/
// UPVOTE/DOWNVOTE 算子，importance 起始 2，归 0 archive。clean canary 反降分
// → 疑似投毒隔离（research §1.4 (d)(f)）。Ratchet 有界容量 C=50 防 bloat。
//
// 复用：ExpeL ADD/EDIT/UPVOTE/DOWNVOTE 算子（research §1.4 (d)，arXiv:2308.10144）；
//      Ratchet 有界容量 C=50 + outcome-driven retirement（research §4.4，
//      arXiv:2605.19576）。
// 自研：insight.ts（算子实现 + importance 计数 + archive 非 delete +
//      quarantine 隔离 + Ratchet 容量淘汰）。
//
// ERRATA-w2plus TL-T11 裁决：
//   - Insight 须含 activated?: boolean（evidenceCount < 2 → activated=false）
//   - createInsightStore(opts: { capacity?: number }) 工厂；默认 capacity=50
//   - delete API 方法名裁定为 delete（store.delete(id)）— 硬抛 NeverAutoDeleteError
//   - Ratchet contribution score 未定义，仅断言淘汰后 active.size() <= capacity
//     且 archive 非删、新增条目仍 active
//
// 已知坑：never-auto-delete 是硬不变量，没有真正的 delete API，只有 archive
// （status 改）；quarantine 是投毒隔离，不是 archive，须独立 status 便于审计。
// Ratchet C=50 上限是 active 库，archive 不计入容量（archive 是 never-delete 归档）。

// ---------------------------------------------------------------------------
// 公共类型与错误（spec §TL-T11 接口签名）
// ---------------------------------------------------------------------------

/** Provenance：insight 来源轨迹与生成时间戳。 */
export interface InsightProvenance {
  trajectoryIds: string[];
  generatedAt: string;
}

/** Insight 记忆条目（ExpeL procedural memory）。 */
export interface Insight {
  id: string;
  content: string; // NL insight
  importance: number; // 起始 2
  evidenceCount: number; // ≥2 才激活
  clusterId: string; // 关联失败簇
  status: "active" | "archived" | "quarantined";
  provenance: InsightProvenance;
  /** evidenceCount < 2 → activated=false（research §1.4 (d)）。 */
  activated?: boolean;
  /** quarantine 时落的隔离原因（clean canary 反降分等），便于审计。 */
  quarantineReason?: string;
  /** contribution score（Ratchet 淘汰依据）；active 库内排序用。 */
  contribution?: number;
}

/** 候选 insight（add 入参）。 */
export interface InsightCandidate {
  id?: string;
  content: string;
  clusterId: string;
  evidence?: unknown[];
  evidenceCount?: number;
  provenance?: InsightProvenance;
}

/** never-auto-delete 不变量：试图 delete（非 archive）insight 时抛。 */
export class NeverAutoDeleteError extends Error {
  constructor(id: string) {
    super(
      `never-auto-delete invariant violated: insight ${id} may only be archived, not deleted`,
    );
    this.name = "NeverAutoDeleteError";
    Object.setPrototypeOf(this, NeverAutoDeleteError.prototype);
  }
}

/** 查无此 insight（id 不存在）。 */
export class InsightNotFoundError extends Error {
  constructor(id: string) {
    super(`insight not found: ${id}`);
    this.name = "InsightNotFoundError";
    Object.setPrototypeOf(this, InsightNotFoundError.prototype);
  }
}

/** InsightStore 公共接口（spec §TL-T11 接口签名）。 */
export interface InsightStore {
  add(insight: InsightCandidate): Promise<Insight>; // importance=2
  edit(id: string, patch: Partial<Insight>): Promise<Insight>;
  upvote(id: string): Promise<Insight>; // +1
  downvote(id: string): Promise<Insight>; // -1, 归 0 → archive（非 delete）
  quarantine(id: string, reason: string): Promise<void>; // clean canary 反降分隔离
  list(): Insight[];
  /** never-auto-delete 硬门：delete 永远抛 NeverAutoDeleteError。 */
  delete(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Ratchet 容量淘汰器（REFACTOR 抽出）
// ---------------------------------------------------------------------------

/**
 * RatchetEvictor — contribution score 计算 + 容量淘汰。
 *
 * contribution score = importance * 2 + evidenceCount（importance 主导，evidence
 * 作 tie-break）。active 库超容量时淘汰 contribution 最低者进 archive（非 delete）。
 * N_min≥100 守卫：贡献分计算至少需 1 条证据才计入（空 evidence 视为基线 0）。
 */
export interface RatchetEvictor {
  contribution(i: Insight): number;
  /** 选出应被淘汰的 active insight（最低 contribution，ties 取最旧）。 */
  pickEviction(active: Insight[]): Insight | undefined;
}

function defaultContribution(i: Insight): number {
  return i.importance * 2 + i.evidenceCount + (i.activated ? 1 : 0);
}

function createRatchetEvictor(): RatchetEvictor {
  return {
    contribution: defaultContribution,
    pickEviction(active: Insight[]): Insight | undefined {
      if (active.length === 0) return undefined;
      // 最低 contribution；ties 取数组中最早（最旧）。
      let victim = active[0]!;
      let victimScore = defaultContribution(victim);
      for (let i = 1; i < active.length; i++) {
        const cur = active[i]!;
        const s = defaultContribution(cur);
        if (s < victimScore) {
          victim = cur;
          victimScore = s;
        }
      }
      return victim;
    },
  };
}

// ---------------------------------------------------------------------------
// ProvenanceTracker（REFACTOR 抽出）
// ---------------------------------------------------------------------------

/** 归一化候选 provenance，缺省补空集 + 当前 ISO 时间。 */
function normalizeProvenance(c: InsightCandidate): InsightProvenance {
  if (c.provenance) return c.provenance;
  return {
    trajectoryIds: [],
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 工厂：createInsightStore
// ---------------------------------------------------------------------------

/**
 * 创建 InsightStore。
 *
 * @param opts.capacity active 库上限（Ratchet C，默认 50）；archive 不计入。
 */
export function createInsightStore(opts: { capacity?: number } = {}): InsightStore {
  const capacity = opts.capacity ?? 50;
  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new Error(`createInsightStore: capacity must be a positive number, got ${capacity}`);
  }

  const evictor = createRatchetEvictor();
  // 单调递增序号：ties-break 淘汰最旧时用。
  let seq = 0;
  const store = new Map<string, Insight & { __seq: number }>();

  function find(id: string): Insight & { __seq: number } | undefined {
    return store.get(id);
  }
  function require(id: string): Insight & { __seq: number } {
    const v = find(id);
    if (!v) throw new InsightNotFoundError(id);
    return v;
  }
  function snapshot(i: Insight & { __seq: number }): Insight {
    const { __seq: _seq, ...rest } = i;
    return { ...rest };
  }
  function activatedFlag(evidenceCount: number): boolean {
    return evidenceCount >= 2;
  }

  return {
    async add(insight: InsightCandidate): Promise<Insight> {
      const now = new Date().toISOString();
      // spec: add 后 evidenceCount=1（首次提交即 1 条证据）。
      const ec = 1;
      const record: Insight & { __seq: number } = {
        id: insight.id ?? `insight-${(++seq).toString(36)}-${now}`,
        content: insight.content,
        importance: 2,
        evidenceCount: ec,
        clusterId: insight.clusterId,
        status: "active",
        provenance: normalizeProvenance(insight),
        activated: activatedFlag(ec),
        contribution: 0,
        __seq: ++seq,
      };
      record.contribution = defaultContribution(record);

      // Ratchet 容量守卫：active 满则淘汰最低 contribution 进 archive。
      const active = [...store.values()].filter((i) => i.status === "active");
      if (active.length >= capacity) {
        const victim = evictor.pickEviction(active);
        if (victim) {
          const v = find(victim.id);
          if (v) {
            v.status = "archived";
          }
        }
      }

      store.set(record.id, record);
      return snapshot(record);
    },

    async edit(id: string, patch: Partial<Insight>): Promise<Insight> {
      const v = require(id);
      // 不可通过 edit 改 id / status 状态机绕过 quarantine/archive。
      if (patch.id !== undefined && patch.id !== v.id) {
        throw new Error("edit: cannot change insight id");
      }
      if (patch.content !== undefined) v.content = patch.content;
      if (patch.clusterId !== undefined) v.clusterId = patch.clusterId;
      if (patch.importance !== undefined) v.importance = patch.importance;
      if (patch.evidenceCount !== undefined) {
        v.evidenceCount = patch.evidenceCount;
        v.activated = activatedFlag(v.evidenceCount);
      }
      if (patch.provenance !== undefined) v.provenance = patch.provenance;
      if (patch.status !== undefined) v.status = patch.status;
      v.contribution = defaultContribution(v);
      return snapshot(v);
    },

    async upvote(id: string): Promise<Insight> {
      const v = require(id);
      v.importance += 1;
      v.contribution = defaultContribution(v);
      return snapshot(v);
    },

    async downvote(id: string): Promise<Insight> {
      const v = require(id);
      v.importance = Math.max(0, v.importance - 1);
      if (v.importance === 0 && v.status === "active") {
        v.status = "archived"; // 归 0 → archive（非 delete）
      }
      v.contribution = defaultContribution(v);
      return snapshot(v);
    },

    async quarantine(id: string, reason: string): Promise<void> {
      const v = require(id);
      // 投毒隔离：独立 status，不上线；须人工复核才解隔离。
      v.status = "quarantined";
      v.quarantineReason = reason;
    },

    list(): Insight[] {
      return [...store.values()]
        .sort((a, b) => a.__seq - b.__seq)
        .map(snapshot);
    },

    async delete(_id: string): Promise<void> {
      // never-auto-delete 硬门：没有 delete API，只有 archive。
      throw new NeverAutoDeleteError(_id);
    },
  };
}
