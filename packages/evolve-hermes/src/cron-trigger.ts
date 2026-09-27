// PLG-T04: evolve-hermes · cron 触发器（生成 hermes cron add 兼容 job 定义）。
//
// Spec: execution/plugin/TASKS.md §PLG-T04。复用铁律（§0.2）：本插件不直接调度
// （hermes cron CLI 跨进程），只生成 job 定义对象；调度由 PLG-T08 evolve run
// 或文档 runbook 指引。
//
// 调度语法（调研 §执行提示 5）：duration / every 短语 / 5-field cron / ISO one-shot。
// buildCronJobSpec 须校验 schedule 字符串格式并 throw InvalidScheduleError（不静默
// 接受非法值）。

/** cron job 定义输入。 */
export interface CronTriggerOptions {
  /** 调度语法：5-field cron / 'every <dur>' / ISO one-shot / duration token。 */
  readonly schedule: string;
  /** 触发工作目录（evolve run 在此目录执行）。 */
  readonly workdir: string;
  /** 触发的 skill（evolve runner skill）。 */
  readonly skills: string[];
}

/** 非法调度语法（不静默接受）。 */
export class InvalidScheduleError extends Error {
  readonly schedule: string;
  constructor(schedule: string) {
    super(`invalid schedule: ${schedule}`);
    this.name = "InvalidScheduleError";
    this.schedule = schedule;
  }
}

/**
 * 校验 schedule 字符串格式。
 *
 * 接受：
 *  - 5-field cron（如 `0 9 * * *`）：5 个空白分隔字段，每字段含 [*\d,/\-L#?]。
 *  - every 短语（如 `every 2h`、`every 5 minutes`）：`every ...`。
 *  - ISO one-shot（如 `2026-01-01T09:00:00`、`2026-01-01 09:00`）。
 *  - duration token（如 `30m`、`2h`、`1d`）。
 */
export function isValidSchedule(schedule: string): boolean {
  const s = schedule.trim();
  if (s.length === 0) return false;
  // every 短语
  if (/^every\s+\S+/i.test(s)) return true;
  // ISO one-shot（日期[ T| ]时间）
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?Z?$/i.test(s)) return true;
  // duration token
  if (/^\d+(\.\d+)?(ms|s|m|h|d|w)$/i.test(s)) return true;
  // 5-field cron
  const fields = s.split(/\s+/);
  if (fields.length === 5) {
    return fields.every((f) => /^[*?\d,/\-]+$/.test(f));
  }
  return false;
}

/**
 * 生成 hermes cron add 兼容的 job 定义对象（可序列化为 JSON）。
 *
 * 不直接调度——返回的对象由调用方经 `hermes cron add '<json>'` 注册
 * （跨进程 CLI，宿主信任域）。
 */
export function buildCronJobSpec(opts: CronTriggerOptions): Record<string, unknown> {
  if (!isValidSchedule(opts.schedule)) {
    throw new InvalidScheduleError(opts.schedule);
  }
  return {
    schedule: opts.schedule,
    workdir: opts.workdir,
    skills: opts.skills,
    command: "evolve run",
  };
}
