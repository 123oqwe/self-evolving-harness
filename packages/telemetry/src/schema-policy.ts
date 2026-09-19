// TL-T05: telemetry schema 写策略 config
//
// 项目 scope 不可覆写（防 prompt-injected 仓库改 schema 偷数据，PRD §11.2）。
// PII 字段 denylist + 启发式（宁可误报不可漏报）。
// applyToWriter: capture_thinking_blocks=false 时在落盘前从 content 剥离 thinking 块。
//
// 类型 TranscriptWriter / NormalizedContent / NormalizedBlock 来自 TL-T01 的
// transcript-schema.ts。此处用 `import type`（仅类型，运行时擦除），即使
// transcript-schema.ts 尚未落地也不会导致运行时模块解析失败。
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
// ProjectScopeOverrideRejectedError 为 TL 模块跨任务共享错误（T05 schema-policy
// 与 T06 budget-policy 均需抛出）。为避免在 index barrel 产生重复导出
// （TS2308 / 运行时 instanceof 失效），此处从 T06 的 budget-policy 导入单一
// 定义，不在本文件重复定义。（协调备注见返回报告。）
import { ProjectScopeOverrideRejectedError } from "./budget-policy";

// ---------------------------------------------------------------------------
// TL-T01 共享类型（结构等价本地声明）
// ---------------------------------------------------------------------------
// 说明：TranscriptWriter / TranscriptNode 的权威定义在 TL-T01 的
// transcript-schema.ts。本任务（TL-T05）与 TL-T01 并行开发，为避免对尚未落地的
// transcript-schema.ts 产生编译期模块依赖（致 `tsc --noEmit` build 红），此处声明
// 结构等价的本地类型，不导出（避免与 TL-T01 的导出在 index barrel 冲突）。
// applyToWriter 仅依赖 writer.append 的结构签名，结构兼容即可。

interface NormalizedBlockLike {
  type?: string;
  [k: string]: unknown;
}

interface WriterAppendNode {
  content?: unknown;
  [k: string]: unknown;
}

interface TranscriptWriterLike {
  append: (node: WriterAppendNode) => Promise<string>;
}

// ---------------------------------------------------------------------------
// 公共类型
// ---------------------------------------------------------------------------

export interface SchemaConfig {
  schema_version: string;
  required_fields: string[];
  truncate_bytes: number; // 默认 50000
  capture_thinking_blocks: boolean;
  sample_non_llm_spans: number; // 0-1 采样率
  telemetry_schema_frozen?: boolean;
}

export interface ValidateResult {
  ok: boolean;
  piiFields: string[];
  violations: string[];
}

export interface SchemaPolicy {
  /**
   * 加载 config。无参读默认 config；传 projectScopePath（项目 scope 覆写）→ reject。
   * frozen 优先于 scope reject：若当前 config 已 frozen → SchemaFrozenError。
   */
  load(projectScopePath?: string): SchemaConfig;
  /**
   * PII 检测 + 下限检查。扫描 required_fields[] 等字段命中 denylist
   * （full_env_vars/credentials/secrets/api_keys/pii_* 前缀 + 含
   * secret/key/token/password/env 全词）。
   */
  validate(cfg: SchemaConfig): ValidateResult;
  /**
   * in-place 包裹 writer.append：capture_thinking_blocks=false 时在落盘前
   * 从 content（NormalizedBlock[]）剥离 type='thinking' 块。
   */
  applyToWriter(cfg: SchemaConfig, writer: TranscriptWriterLike): void;
}

// ---------------------------------------------------------------------------
// 错误类
// ---------------------------------------------------------------------------

// ProjectScopeOverrideRejectedError 见文件顶部 import（来自 ./budget-policy，
// 跨任务共享，不在本文件重复定义亦不 re-export，避免 index barrel 重复导出）。

export class SchemaFrozenError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "SchemaFrozenError: telemetry schema is frozen and cannot be modified",
    );
    this.name = "SchemaFrozenError";
  }
}

// ---------------------------------------------------------------------------
// PII denylist
// ---------------------------------------------------------------------------

/** 显式 denylist（精确匹配 required_fields 条目）。 */
const PII_DENYLIST: ReadonlySet<string> = new Set([
  "full_env_vars",
  "credentials",
  "secrets",
  "api_keys",
]);

/** pii_ 前缀检测。 */
function isPiiPrefix(field: string): boolean {
  return /^pii_/i.test(field);
}

/**
 * 启发式：字段名含 secret/key/token/password/env（下划线或连字符分隔的整词）。
 * 宁可误报不可漏报。
 */
const PII_HEURISTIC_WORDS = ["secret", "key", "token", "password", "env"];

function matchesPiiHeuristic(field: string): boolean {
  const tokens = field
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  return tokens.some((tok) => PII_HEURISTIC_WORDS.includes(tok));
}

function isPiiField(field: string): boolean {
  return (
    PII_DENYLIST.has(field) ||
    isPiiPrefix(field) ||
    matchesPiiHeuristic(field)
  );
}

// ---------------------------------------------------------------------------
// 默认 config（与 config/telemetry_schema_config.json 同步）
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SchemaConfig = {
  schema_version: "v1",
  required_fields: ["type", "uuid", "parentUuid", "sessionId", "content"],
  truncate_bytes: 50000,
  capture_thinking_blocks: true,
  sample_non_llm_spans: 1.0,
};

/** bundled 默认 config 路径（src/schema-policy.ts → ../config/...）。 */
const BUNDLED_CONFIG_PATH = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "telemetry_schema_config.json",
);

function readDefaultConfig(defaultConfigPath?: string): SchemaConfig {
  const path = defaultConfigPath ?? BUNDLED_CONFIG_PATH;
  try {
    if (path && existsSync(path)) {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as Partial<SchemaConfig>;
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    // 读失败回落到内置默认
  }
  return { ...DEFAULT_CONFIG };
}

// ---------------------------------------------------------------------------
// 工具：剥离 thinking 块
// ---------------------------------------------------------------------------

/**
 * 从 content（NormalizedBlock[]）剥离 type='thinking' 块。
 * content 非数组时原样返回。
 */
function stripThinkingBlocks(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }
  return content.filter(
    (block) => (block as { type?: string } | null)?.type !== "thinking",
  );
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

/**
 * 工厂：无参读默认 config（bundled packages/telemetry/config/
 * telemetry_schema_config.json）；defaultConfigPath 可注入默认 config 路径
 * （供 frozen 测试）。
 */
export function createSchemaPolicy(opts?: {
  defaultConfigPath?: string;
}): SchemaPolicy {
  const defaultConfigPath = opts?.defaultConfigPath;

  return {
    load(projectScopePath?: string): SchemaConfig {
      const cfg = readDefaultConfig(defaultConfigPath);
      // frozen 优先于 scope reject
      if (cfg.telemetry_schema_frozen === true) {
        // 任何试图改 config 的调用（含 project scope 覆写）→ SchemaFrozenError
        if (projectScopePath !== undefined) {
          throw new SchemaFrozenError();
        }
        return cfg;
      }
      if (projectScopePath !== undefined) {
        throw new ProjectScopeOverrideRejectedError();
      }
      return cfg;
    },

    validate(cfg: SchemaConfig): ValidateResult {
      const piiFields: string[] = [];
      const violations: string[] = [];

      // PII 扫描 required_fields[]
      for (const f of cfg.required_fields ?? []) {
        if (isPiiField(f)) {
          piiFields.push(f);
        }
      }

      // 下限锁：truncate_bytes >= 1024
      if (
        typeof cfg.truncate_bytes !== "number" ||
        cfg.truncate_bytes < 1024
      ) {
        violations.push("truncate_bytes below 1KB floor");
      }

      // sample_non_llm_spans 范围
      if (
        typeof cfg.sample_non_llm_spans !== "number" ||
        cfg.sample_non_llm_spans < 0 ||
        cfg.sample_non_llm_spans > 1
      ) {
        violations.push("sample_non_llm_spans out of [0,1] range");
      }

      const ok = piiFields.length === 0 && violations.length === 0;
      return { ok, piiFields, violations };
    },

    applyToWriter(cfg: SchemaConfig, writer: TranscriptWriterLike): void {
      if (cfg.capture_thinking_blocks === false) {
        // 包裹 append：剥离 thinking 块后再委托原 append
        const orig = writer.append.bind(writer);
        writer.append = (async (node: WriterAppendNode) => {
          const stripped = stripThinkingBlocks(node.content);
          return orig({ ...node, content: stripped });
        }) as TranscriptWriterLike["append"];
      }
      // capture_thinking_blocks=true：不改 writer（保留 thinking）
    },
  };
}
