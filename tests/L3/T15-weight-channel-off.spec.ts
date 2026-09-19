// L3-T15: 权重通道 spec — 默认 off 不变量测试 [V2]
//
// This is NOT a TDD task: it's a spec-review + default-off invariant test.
// RED state: WEIGHT_CHANNEL_DEFAULT / WeightChannelGate not exported → RED.
// Invariants: WEIGHT_CHANNEL_DEFAULT === 'off'; runtime off→on without
// human signature → breaker reject + securityEvent; four preconditions gate
// any open.
//
// Spec: execution/L3-engine/TASKS.md §L3-T15 + specs/L3-T15-weight-channel-spec.md.

import { describe, it, expect } from "vitest";
import {
  WEIGHT_CHANNEL_DEFAULT,
  WeightChannelGate,
  BreakerError,
} from "@harness/l3-engine";
import { FakeSandbox } from "./fixtures/fake-sandbox";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Spec-pinned threshold constants (mirror the spec document).
const KL_MAX = 0.05;
const ORACLE_PASS_MIN = 0.9;

const SPEC_PATH = path.resolve(
  process.cwd(),
  "specs/L3-T15-weight-channel-spec.md",
);

describe("L3-T15", () => {
  it("WEIGHT_CHANNEL_DEFAULT === 'off' (default-off invariant, PRD §6.1 N1)", () => {
    expect(WEIGHT_CHANNEL_DEFAULT).toBe("off");
  });

  // =========================================================================
  // Four-threshold gate (WeightChannelGate.checkOpen)
  // =========================================================================
  it("checkOpen: KL > KL_MAX(0.05) → open=false + reasons non-empty", () => {
    const gate = new WeightChannelGate();
    const r = gate.checkOpen({
      klDivergence: 0.1, // > KL_MAX
      oraclePassRate: 0.95,
      consolidationNonInferior: true,
      humanSigned: true,
    });
    expect(r.open).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.join(" ")).toMatch(/kl/i);
  });

  it("checkOpen: oraclePassRate < ORACLE_PASS_MIN(0.9) → open=false", () => {
    const gate = new WeightChannelGate();
    const r = gate.checkOpen({
      klDivergence: 0.01,
      oraclePassRate: 0.8, // < 0.9
      consolidationNonInferior: true,
      humanSigned: true,
    });
    expect(r.open).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/oracle/i);
  });

  it("checkOpen: consolidationNonInferior=false → open=false", () => {
    const gate = new WeightChannelGate();
    const r = gate.checkOpen({
      klDivergence: 0.01,
      oraclePassRate: 0.95,
      consolidationNonInferior: false,
      humanSigned: true,
    });
    expect(r.open).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/consolidat/i);
  });

  it("checkOpen: humanSigned=false → open=false (human gate)", () => {
    const gate = new WeightChannelGate();
    const r = gate.checkOpen({
      klDivergence: 0.01,
      oraclePassRate: 0.95,
      consolidationNonInferior: true,
      humanSigned: false,
    });
    expect(r.open).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/human/i);
  });

  it("checkOpen: all four preconditions satisfied → open=true", () => {
    const gate = new WeightChannelGate();
    const r = gate.checkOpen({
      klDivergence: 0.01,
      oraclePassRate: 0.95,
      consolidationNonInferior: true,
      humanSigned: true,
    });
    expect(r.open).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  // =========================================================================
  // Breaker: runtime off→on without human signature → reject + securityEvent
  // =========================================================================
  it("breaker: runtime off→on attempt (no human signature) → BreakerError + securityEvent", () => {
    const sandbox = new FakeSandbox();
    const gate = new WeightChannelGate({ sandbox });
    // Attempt to flip on at runtime without the four preconditions.
    expect(() => {
      gate.attemptOpen({
        klDivergence: 0.01,
        oraclePassRate: 0.95,
        consolidationNonInferior: true,
        humanSigned: false, // no human signature → reject
      });
    }).toThrow(BreakerError);
    expect(sandbox.log.securityEvents.length).toBeGreaterThanOrEqual(1);
    // Channel still off after the rejected attempt.
    expect(WEIGHT_CHANNEL_DEFAULT).toBe("off");
  });

  // The spec document is a required T15 deliverable; the threshold values
  // must be pinned there. In RED the file is absent → fails (genuine RED
  // gate for the spec-deliverable acceptance criterion).
  it("spec deliverable specs/L3-T15-weight-channel-spec.md exists and pins the four thresholds", () => {
    expect(existsSync(SPEC_PATH)).toBe(true);
    const spec = readFileSync(SPEC_PATH, "utf8");
    expect(spec).toMatch(/KL_MAX/);
    expect(spec).toMatch(/ORACLE_PASS_MIN/);
    expect(spec).toMatch(/CONSOLIDATION_NONINFERIOR/);
    expect(spec).toMatch(/HUMAN_GATE_SIGNED/);
    // default-off invariant stated in the spec
    expect(spec).toMatch(/off/i);
  });
});
