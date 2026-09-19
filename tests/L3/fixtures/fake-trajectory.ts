// L3 test fixture — FakeTrajectory + helpers.
//
// Spec: execution/L3-engine/TASKS.md §L3-T03 (Trajectory shape = §2
// TrajectoryFeed contract), reused T10/T12/T13. Trajectories are CE-T03
// Lucky-Pass-filtered; this fixture constructs them with the luckyPass flag
// controllable (defence-in-depth guard tested at the L3 boundary).

import type { Trajectory } from "@harness/l3-engine";

export interface MakeTrajectoryOpts {
  id?: string;
  sessionId?: string;
  substrateSha: string;
  diagnosis?: string;
  luckyPass?: boolean;
  raw?: unknown;
}

export function makeTrajectory(opts: MakeTrajectoryOpts): Trajectory {
  return {
    id: opts.id ?? `traj-${Math.random().toString(36).slice(2, 10)}`,
    sessionId: opts.sessionId ?? "sess-fake",
    substrateSha: opts.substrateSha,
    failed: true,
    diagnosis: opts.diagnosis ?? "no diagnosis",
    luckyPass: opts.luckyPass,
    raw: opts.raw,
  };
}

/** Build N failed trajectories (luckyPass=false) for a substrate. */
export function makeFailures(
  substrateSha: string,
  n: number,
  diagnosis = "failed to resolve",
): Trajectory[] {
  return Array.from({ length: n }, (_, i) =>
    makeTrajectory({
      id: `traj-${substrateSha}-${i}`,
      substrateSha,
      diagnosis,
      luckyPass: false,
    }),
  );
}
