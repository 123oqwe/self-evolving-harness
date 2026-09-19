// L3-T13: ADAS meta-agent + growing archive + Turing-complete DSL [V1]
//
// RED state: AdasMetaSearchOptimizer / AgentDSL / AST not exported → RED.
// Invariants: archive growth never decreases (keep-all, T06a); DSL breaker
// flags eval/exec/network.
//
// Spec: execution/L3-engine/TASKS.md §L3-T13.

import { describe, it, expect } from "vitest";
import { AdasMetaSearchOptimizer, AgentDSL } from "@harness/l3-engine";
import type { Substrate } from "@harness/l3-engine";
import { TreeArchive } from "@harness/l3-engine";
import { FakeLLM } from "./fixtures/fake-llm";
import { FakeSandbox } from "./fixtures/fake-sandbox";
import { makeArchiveEntry, makeMutant, makeSubstrate } from "./fixtures/factories";

function buildArchive(n: number): TreeArchive {
  const a = new TreeArchive();
  for (let i = 0; i < n; i++) {
    a.insert(
      makeArchiveEntry({
        sha: `a-${i}`,
        fitness: { resolve_rate: 0.1 * i, token: 100, cache_hit: 0.5 },
        mutant: makeMutant({ id: `m-${i}`, content: `// skill ${i}` }),
      }),
    );
  }
  return a;
}

describe("L3-T13", () => {
  // =========================================================================
  // sampleArchive — high fitness + high diversity (seed-fixed ids)
  // =========================================================================
  it("sampleArchive(k=3, seed fixed) returns 3 high-fitness + high-diversity entries (seed-fixed ids)", () => {
    const archive = buildArchive(5);
    const opt = new AdasMetaSearchOptimizer({
      llm: new FakeLLM({}),
      archive,
      sampleK: 3,
      seed: 42,
    });
    const samples = opt.sampleArchive(archive, 3, 42);
    expect(samples).toHaveLength(3);
    // Deterministic re-run
    const samples2 = opt.sampleArchive(archive, 3, 42);
    expect(samples2.map((s) => s.sha).sort()).toEqual(
      samples.map((s) => s.sha).sort(),
    );
    // highest-fitness entry must be in the sample (greedy high-fitness)
    expect(samples.some((s) => s.fitness.resolve_rate === 0.4)).toBe(true);
  });

  it("proposeAgent: LLM writes a new DSL Mutant (origin='reflective', parentSha)", async () => {
    const llm = new FakeLLM({
      defaultReply: "function skill() { if (x) { tool('a'); } }",
    });
    const archive = buildArchive(3);
    const opt = new AdasMetaSearchOptimizer({
      llm,
      archive,
      sampleK: 2,
      seed: 42,
    });
    const parent = makeArchiveEntry({ sha: "a-2" });
    const samples = opt.sampleArchive(archive, 2, 42);
    const mutant = await opt.proposeAgent(parent, samples);
    expect(mutant.origin).toBe("reflective");
    expect(mutant.parentSha).toBe(parent.sha);
    expect(mutant.content.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // AgentDSL — breaker flag detection (eval / network / exec)
  // =========================================================================
  it("DSL containing eval() → validate ok=false + violations contains eval flag", () => {
    const dsl = new AgentDSL();
    const code = "function skill() { return eval('1+1'); }";
    const result = dsl.validate(dsl.parse(code), new FakeSandbox());
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toMatch(/eval/i);
  });

  it("DSL containing network egress (fetch/https) → ok=false", () => {
    const dsl = new AgentDSL();
    const code = "function skill() { fetch('https://evil.example'); }";
    const result = dsl.validate(dsl.parse(code), new FakeSandbox());
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("DSL containing exec/spawn (subprocess) → ok=false", () => {
    const dsl = new AgentDSL();
    const code = "function skill() { const {execSync}=require('child_process'); execSync('rm -rf /'); }";
    const result = dsl.validate(dsl.parse(code), new FakeSandbox());
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toMatch(/exec|spawn|subprocess/i);
  });

  // =========================================================================
  // Growing archive invariants
  // =========================================================================
  it("archived entry can be re-sampled in later generation (growing archive open-ended)", () => {
    const archive = buildArchive(3);
    const opt = new AdasMetaSearchOptimizer({
      llm: new FakeLLM({}),
      archive,
      sampleK: 2,
      seed: 42,
    });
    const s1 = opt.sampleArchive(archive, 2, 42);
    // insert a new entry (simulating a new generation)
    archive.insert(makeArchiveEntry({ sha: "a-new" }));
    const s2 = opt.sampleArchive(archive, 2, 42);
    // the original archived entries remain sampleable
    expect(s1.every((e) => archive.rollback(e.sha))).toBeTruthy();
    expect(s2.every((e) => archive.rollback(e.sha))).toBeTruthy();
  });

  it("archive.size() monotonically non-decreasing across N generations (keep-all)", () => {
    const archive = buildArchive(2);
    const sizes: number[] = [archive.size()];
    for (let g = 0; g < 4; g++) {
      archive.insert(makeArchiveEntry({ sha: `gen-${g}` }));
      sizes.push(archive.size());
    }
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });

  it("cold start (archive empty) → returns empty or zero-shot", async () => {
    const archive = new TreeArchive();
    const opt = new AdasMetaSearchOptimizer({
      llm: new FakeLLM({ defaultReply: "// zero-shot skill" }),
      archive,
      sampleK: 3,
      seed: 42,
    });
    const sub: Substrate = makeSubstrate({ kind: "skill", sha: "cold" });
    const out = await opt.generate(sub, { trajectories: [], best: null });
    // empty or zero-shot — at most one zero-shot candidate, never throws
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it("DSL expressiveness: control flow (if/loop) + tool call parses to correct AST node types", () => {
    const dsl = new AgentDSL();
    const code = `
      function skill() {
        for (const x of items) {
          if (x.ready) { tool('do', x); }
        }
      }
    `;
    const ast = dsl.parse(code);
    // AST exposes node types; assert control-flow + call nodes present.
    const types = collectNodeTypes(ast);
    expect(types).toContain("IfStatement");
    expect(types).toContain("ForOfStatement");
    expect(types).toContain("CallExpression");
  });
});

function walk(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, out);
    return;
  }
  const n = node as Record<string, unknown>;
  if (typeof n["type"] === "string") out.push(n["type"]);
  for (const key of Object.keys(n)) {
    if (key === "type") continue;
    walk(n[key], out);
  }
}

function collectNodeTypes(ast: unknown): string[] {
  const out: string[] = [];
  walk(ast, out);
  return out;
}
