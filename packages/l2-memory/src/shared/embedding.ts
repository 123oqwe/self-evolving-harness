// L2-T07 · shared embedding（确定性 mock；真实模型属 static-core）。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T07 + §0.3 文件布局 +
// REFACTOR（line 381）："embedding 接口抽到 shared/embedding.ts，
// L2-T07 A-Mem 也复用。"
//
// 本模块由 L2-T07 拥有（T05 trajectory-store 在其注释中明确把
// shared/embedding 让渡给 T07，自包含以避免并行冲突）。
//
// 设计铁律：
//   1. **embedding 模型属 static-core**——L2 不提供改 embedding 模型的
//      接口（改模型需重索引全库）。这里只提供确定性 mock，供 A-Mem
//      link-judge 的 embedding pre-filter（O(N²) 安全门：先 retrieve 近邻
//      再 judge，禁全库两两 judge）。
//   2. **确定性**——同输入恒同向量，测试可复现。
//   3. **退化安全**——空输入返回单位首分量，保证 cosine 可计算。
//
// 真实 embedding 模型在集成阶段由 static-core 注入（替换本 mock）。

// ---------------------------------------------------------------------------
// 维度
// ---------------------------------------------------------------------------

/**
 * mock embedding 维度。
 *
 * 选 8：足够区分不同 keyword 组合，又不至于在 mock 场景下浪费内存。
 * 真实维度由 static-core embedding 模型决定（L2 不改）。
 */
export const EMBED_DIM = 8;

// ---------------------------------------------------------------------------
// embedding（确定性 mock）
// ---------------------------------------------------------------------------

/**
 * 基于文本的确定性 mock embedding：按字符码累加到 EMBED_DIM 个 bucket，
 * 归一化为单位向量。
 *
 * 退化情况（全零向量，如空文本）返回单位首分量，保证 cosine 可计算。
 */
export function embed(text: string): number[] {
  const buckets = new Array<number>(EMBED_DIM).fill(0);
  const src = String(text ?? "");
  for (let i = 0; i < src.length; i++) {
    const code = src.charCodeAt(i);
    const bi = code % EMBED_DIM;
    buckets[bi] = (buckets[bi] ?? 0) + 1;
  }
  const norm = Math.sqrt(buckets.reduce((s, v) => s + v * v, 0));
  if (norm === 0) {
    const v = new Array<number>(EMBED_DIM).fill(0);
    v[0] = 1;
    return v;
  }
  return buckets.map((v) => v / norm);
}

// ---------------------------------------------------------------------------
// 余弦相似度
// ---------------------------------------------------------------------------

/**
 * 余弦相似度。两向量长度不一致时按较短者截断 + 较长者补零对齐
 * （兼容查询向量维度 < embedding 维度的退化情形）。
 */
export function cosine(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// top-k 检索（embedding pre-filter）
// ---------------------------------------------------------------------------

export interface ScoredItem<T> {
  item: T;
  sim: number;
}

/**
 * 按余弦相似度返回 top-k 条目（降序）。空库返回 []。
 *
 * 用于 A-Mem link-judge 的 pre-filter：先 retrieve 近邻再 judge，
 * 禁全库两两 judge（O(N²) 安全门，02-memory-skills.md 组件 5）。
 *
 * @param query 查询向量。
 * @param docs  候选条目（附带其 embedding）。
 * @param k     返回条数。
 */
export function topK<T>(
  query: number[],
  docs: { item: T; embedding: number[] }[],
  k: number,
): ScoredItem<T>[] {
  if (docs.length === 0) return [];
  const scored = docs.map((d) => ({
    item: d.item,
    sim: cosine(query, d.embedding),
  }));
  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, Math.max(0, k));
}
