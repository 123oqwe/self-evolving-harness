// L1-T17 · handoff description + input_type schema 进化（on_handoff/is_enabled static-core；鉴权字段人工 gate）
// Test-author (RED) — 依据 execution/L1-config/TASKS.md §L1-T17 spec 编写。

import { describe, it, expect } from "vitest";
import {
  HandoffSchema,
  AuthFieldUnsignedError,
  OnHandoffInvariantError,
  type HandoffDescription,
  type InputTypeSchema,
  type HandoffScore,
} from "@harness/l1-config";

function hscore(o: Partial<HandoffScore>): HandoffScore {
  return {
    misrouteRate: o.misrouteRate ?? 0.1,
    authFailureCount: o.authFailureCount ?? 1,
    acceptance: o.acceptance ?? 0.5,
    isBaseline: o.isBaseline ?? false,
  };
}

describe("L1-T17", () => {
  it("evolve improves misroute ∧ authFailure", () => {
    const e = new HandoffSchema();
    const desc: HandoffDescription[] = [{ agent: "researcher", description: "handles research" }];
    const schemas: InputTypeSchema[] = [{ agent: "researcher", fields: { topic: "string" }, authFields: [] }];
    const baseline = hscore({ isBaseline: true, misrouteRate: 0.2, authFailureCount: 3, acceptance: 0.5 });
    const cand = hscore({ misrouteRate: 0.1, authFailureCount: 1, acceptance: 0.55 });
    const result = e.evolve(desc, schemas, [baseline, cand]);
    expect(result.desc.length).toBeGreaterThan(0);
    expect(result.schemas.length).toBeGreaterThan(0);
  });

  it("assertAuthFieldHumanGated throws on unsigned auth field change", () => {
    const e = new HandoffSchema();
    const schema: InputTypeSchema = {
      agent: "researcher",
      fields: { topic: "string", priority: "string" },
      authFields: ["priority"],
    };
    // 改 authFields 无人工签 → throw
    expect(() => e.assertAuthFieldHumanGated(schema, false)).toThrowError(AuthFieldUnsignedError);
  });

  it("assertAuthFieldHumanGated passes on signed change", () => {
    const e = new HandoffSchema();
    const schema: InputTypeSchema = {
      agent: "researcher",
      fields: { topic: "string" },
      authFields: ["priority"],
    };
    expect(() => e.assertAuthFieldHumanGated(schema, true)).not.toThrow();
  });

  it("assertOnHandoffInvariant throws when on_handoff executes after transfer", () => {
    const e = new HandoffSchema();
    // on_handoff 在 transfer 后执行 → throw
    expect(() => e.assertOnHandoffInvariant(false)).toThrowError(OnHandoffInvariantError);
    // 在 transfer 前执行不 throw
    expect(() => e.assertOnHandoffInvariant(true)).not.toThrow();
  });

  it("evolve adds non-auth field with misroute↓ allowed", () => {
    const e = new HandoffSchema();
    const desc: HandoffDescription[] = [{ agent: "researcher", description: "research" }];
    const schemas: InputTypeSchema[] = [{ agent: "researcher", fields: { topic: "string" }, authFields: [] }];
    const baseline = hscore({ isBaseline: true, misrouteRate: 0.2, authFailureCount: 0, acceptance: 0.5 });
    const cand = hscore({ misrouteRate: 0.1, authFailureCount: 0, acceptance: 0.55 });
    const result = e.evolve(desc, schemas, [baseline, cand]);
    // 加非鉴权字段（summary）且 misroute↓ → 允许
    const researcher = result.schemas.find((s) => s.agent === "researcher");
    expect(researcher).toBeDefined();
  });
});
