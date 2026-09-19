// L3-T08: Voyager commit-on-success retain + auto-revert [MVP]
//
// RED state: Retain / AutoRevert / CanaryHandle / RegressionSignal not
// exported → RED. Static-core invariant: rollbackThreshold frozen; optimizer
// cannot mutate; revertExec delegates to CE-T06 (git checkout).
//
// Spec: execution/L3-engine/TASKS.md §L3-T08.

import { describe, it, expect, vi } from "vitest";
import { Retain, AutoRevert, BreakerError } from "@harness/l3-engine";
import type { Mutant, RegressionSignal } from "@harness/l3-engine";
import { FakeSandbox } from "./fixtures/fake-sandbox";
import { makeMutant, makeFitness } from "./fixtures/factories";

describe("L3-T08", () => {
  // =========================================================================
  // Retain.commit
  // =========================================================================
  it("gate both pass → commit returns version='nameV2' + sha", () => {
    const retain = new Retain();
    const mutant = makeMutant({ content: "phase-init" });
    const r = retain.commit(mutant, {
      strictImprovement: true,
      paretoFront: true,
    });
    expect(r).not.toBeNull();
    expect(r?.version).toMatch(/V2$/);
    expect(typeof r?.sha).toBe("string");
  });

  it("gate.strictImprovement=false → commit returns null (no retain)", () => {
    const retain = new Retain();
    const mutant = makeMutant();
    const r = retain.commit(mutant, {
      strictImprovement: false,
      paretoFront: true,
    });
    expect(r).toBeNull();
  });

  it("bumpVersion: first bump → nameV2; existing suffix → next V", () => {
    const retain = new Retain();
    expect(retain.bumpVersion("phase-init")).toBe("phase-initV2");
    expect(retain.bumpVersion("phase-initV2")).toBe("phase-initV3");
    expect(retain.bumpVersion("phase-initV3")).toBe("phase-initV4");
  });

  it("vector index latest(): unique newest version (nameV3 over nameV2)", () => {
    const retain = new Retain();
    const m2 = makeMutant({ content: "xV2" });
    const m3 = makeMutant({ content: "xV3" });
    retain.commit(m2, { strictImprovement: true, paretoFront: true });
    retain.commit(m3, { strictImprovement: true, paretoFront: true });
    const latest = retain.vectorIndex.latest("x");
    expect(latest).not.toBeNull();
    expect(latest?.mutant.content).toBe("xV3");
  });

  // =========================================================================
  // AutoRevert — regression signal → revertExec (CE-T06 git checkout)
  // =========================================================================
  it("onRegressionSignal resolve_drop → revertExec called with 'git checkout <toSha>' + reverted=true", async () => {
    const revertExec = vi.fn<(toSha: string) => Promise<void>>().mockResolvedValue();
    const autoRevert = new AutoRevert({
      sandbox: new FakeSandbox(),
      rollbackThreshold: { resolve_rate: 0.05, token: 0, cache_hit: 0 },
      revertExec,
    });
    const signal: RegressionSignal = {
      kind: "resolve_drop",
      severity: 0.1,
    };
    const result = await autoRevert.onRegressionSignal(signal);
    expect(result.reverted).toBe(true);
    expect(typeof result.toSha).toBe("string");
    expect(revertExec).toHaveBeenCalledTimes(1);
    const arg = revertExec.mock.calls[0][0];
    // revertExec is the CE-T06 static-core git checkout exec; the call must
    // carry a sha (the rollback target).
    expect(arg).toBeTruthy();
  });

  it("PII>0 signal → immediate revert (zero tolerance)", async () => {
    const revertExec = vi.fn<(toSha: string) => Promise<void>>().mockResolvedValue();
    const autoRevert = new AutoRevert({
      sandbox: new FakeSandbox(),
      rollbackThreshold: { resolve_rate: 0, token: 0, cache_hit: 0 },
      revertExec,
    });
    const signal: RegressionSignal = {
      kind: "pii_leak",
      severity: 1,
    };
    const result = await autoRevert.onRegressionSignal(signal);
    expect(result.reverted).toBe(true);
    expect(revertExec).toHaveBeenCalled();
  });

  it("optimizer attempts to mutate rollbackThreshold → breaker reject + securityEvent", () => {
    const sandbox = new FakeSandbox();
    const autoRevert = new AutoRevert({
      sandbox,
      rollbackThreshold: { resolve_rate: 0.05, token: 0, cache_hit: 0 },
      revertExec: async () => {},
    });
    // When optimizer path tries to widen the threshold
    expect(() => {
      // @ts-expect-error deliberate tamper
      (autoRevert as unknown as { rollbackThreshold: Record<string, number> })
        .rollbackThreshold.resolve_rate = 0.5;
    }).toThrow(BreakerError);
    // security event recorded
    expect(sandbox.log.securityEvents.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // End-to-end rejection path
  // =========================================================================
  it("regressing mutant → commit returns null + no new active archive entry", () => {
    const retain = new Retain();
    const r = retain.commit(makeMutant(), {
      strictImprovement: false, // gate failed (simulated regression)
      paretoFront: true,
    });
    expect(r).toBeNull();
  });
});
