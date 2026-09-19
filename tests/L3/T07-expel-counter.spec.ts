// L3-T07: ExpeL upvote/downvote importance 计数器 [MVP]
//
// RED state: ExpelCounter not exported → RED. initialCount=2, minEvidence=2;
// count==0 → retire (not delete); count cannot underflow below 0.
//
// The spec interface lists only upvote/downvote/shouldRetire/shouldActivate/
// retire. The "retire does not delete" invariant is observed through an
// injected TreeArchive (T06a), per the spec REFACTOR note that
// importanceCount unifies with T06a (ambiguity: archive injection shape not
// pinned in the constructor signature — see structured ambiguities).
//
// Spec: execution/L3-engine/TASKS.md §L3-T07.

import { describe, it, expect } from "vitest";
import { ExpelCounter, TreeArchive } from "@harness/l3-engine";
import { makeArchiveEntry } from "./fixtures/factories";

describe("L3-T07", () => {
  it("new entry → importanceCount=2 (provable via downvote→1)", () => {
    const counter = new ExpelCounter({ initialCount: 2, minEvidence: 2 });
    // First access auto-initializes count=2, then downvote → 1.
    expect(counter.downvote("fresh-sha")).toBe(1);
  });

  it("downvote from 1 → count=0 + shouldRetire=true", () => {
    const counter = new ExpelCounter({ initialCount: 2, minEvidence: 2 });
    counter.downvote("y"); // 2→1
    expect(counter.downvote("y")).toBe(0); // 1→0
    expect(counter.shouldRetire("y")).toBe(true);
  });

  it("retire does not delete entry (archive size invariant + status retired)", () => {
    const archive = new TreeArchive();
    archive.insert(makeArchiveEntry({ sha: "z" }));
    const counter = new ExpelCounter({
      initialCount: 2,
      minEvidence: 2,
      archive,
    });
    counter.downvote("z");
    counter.downvote("z");
    expect(counter.shouldRetire("z")).toBe(true);
    const sizeBefore = archive.size();
    counter.retire("z");
    expect(archive.size()).toBe(sizeBefore); // never-auto-delete
    expect(archive.rollback("z").status).toBe("retired");
  });

  it("evidenceCount < minEvidence(2) → shouldActivate=false (insufficient evidence)", () => {
    const counter = new ExpelCounter({ initialCount: 2, minEvidence: 2 });
    expect(counter.shouldActivate("a", 1)).toBe(false);
    expect(counter.shouldActivate("a", 2)).toBe(true);
    expect(counter.shouldActivate("a", 3)).toBe(true);
  });

  it("consecutive downvotes do not underflow (cap 0)", () => {
    const counter = new ExpelCounter({ initialCount: 2, minEvidence: 2 });
    for (let i = 0; i < 5; i++) counter.downvote("b");
    // After initial=2, 5 downvotes would give -3; cap at 0.
    expect(counter.shouldRetire("b")).toBe(true);
    // An upvote after hitting the floor goes 0→1 (not from negative).
    expect(counter.upvote("b")).toBe(1);
  });

  it("upvote increases count (returns new count)", () => {
    const counter = new ExpelCounter({ initialCount: 2, minEvidence: 2 });
    // First upvote: initial 2 → 3.
    expect(counter.upvote("c")).toBe(3);
    expect(counter.upvote("c")).toBe(4);
  });
});
