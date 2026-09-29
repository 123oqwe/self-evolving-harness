// packages/contracts — 跨层契约（纯类型，零运行时依赖）。
// ISS-13: 断开 l3-engine ↔ canary-eval 循环依赖。本包只放类型，
// 依赖方向 contracts ← 各层（谁也不许反向依赖 contracts 之外的东西）。
// 约定白名单（scripts/check-deps.mjs 校验）:
//   contracts ← l0-core ← l0-sandbox ← telemetry / l1 / l2 ← canary-eval ← l3 ← adapters

/** 失败轨迹（filter 后形状，与 l3-engine Trajectory 同构）。 */
export interface Trajectory {
  id: string;
  sessionId: string;
  substrateSha: string;
  failed: true;
  diagnosis: string;
  luckyPass?: boolean;
  raw?: unknown;
}

/** 验证运行结果（canary-eval 产出，l3/CE 消费）。 */
export interface VerifierRun {
  taskId: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  runId: string;
  contiguousRun: true;
  epermHits?: string[];
  sandboxBypassed?: boolean;
}
