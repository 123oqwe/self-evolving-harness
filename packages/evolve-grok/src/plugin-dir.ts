// PLG-T12: grok 插件目录（.grok/plugins/evolve/）渲染。
//
// Spec: execution/plugin/TASKS.md §PLG-T12（plugin-dir.ts）。
//
// 复用铁律（§0.2）：hooks.json 的 PreToolUse 考卷锁定语义**复用** ADP-T03
// exam-lock（`tests/**/*.spec.ts` 锁定范围，TEST-LOCK §1 出题权分离）——本模块
// 只渲染 grok 插件目录布局（skills/<n>/SKILL.md、hooks/hooks.json、.mcp.json），
// 不重定义锁定规则。

/**
 * grok 插件目录规格：skills + PreToolUse hooks（考卷锁定）+ .mcp.json 内容。
 */
export interface GrokPluginDirSpec {
  readonly skills: ReadonlyArray<{ readonly name: string; readonly body: string }>;
  readonly preToolUseHooks: ReadonlyArray<{
    readonly matcher: string; // 如 'Write|Edit|Bash'
    readonly command: string; // 考卷锁定命令（命中 tests/**/*.spec.ts 拒写）
  }>;
  readonly mcp: Record<string, unknown>; // .mcp.json 内容
}

/** hooks.json 至少含考卷锁定 hook，空数组非法。 */
export class InvalidHooksError extends Error {
  public override readonly name = "InvalidHooksError";
  constructor(message = "InvalidHooksError: hooks.json requires at least one PreToolUse exam-lock hook") {
    super(message);
  }
}

/**
 * 渲染 hooks.json（PreToolUse 数组，matcher/command 字段）。
 *
 * 空 hooks 数组 → throw `InvalidHooksError`（考卷锁定铁律：hooks.json 至少含
 * 一个命中 tests 下 .spec.ts 的 PreToolUse hook）。
 */
export function renderHooksJson(
  hooks: GrokPluginDirSpec["preToolUseHooks"],
): string {
  if (!Array.isArray(hooks) || hooks.length === 0) {
    throw new InvalidHooksError();
  }
  const config = {
    PreToolUse: hooks.map((h) => ({
      matcher: h.matcher,
      command: h.command,
    })),
  };
  return JSON.stringify(config, null, 2);
}

/**
 * 渲染 grok 插件目录：相对路径 → 文件内容。
 *
 * 产出文件（相对 `.grok/plugins/evolve/`）：
 *  - `skills/<name>/SKILL.md`
 *  - `hooks/hooks.json`
 *  - `.mcp.json`
 */
export function renderGrokPluginDir(
  spec: GrokPluginDirSpec,
): Map<string, string> {
  const files = new Map<string, string>();
  for (const skill of spec.skills) {
    files.set(`skills/${skill.name}/SKILL.md`, skill.body);
  }
  files.set("hooks/hooks.json", renderHooksJson(spec.preToolUseHooks));
  files.set(".mcp.json", JSON.stringify(spec.mcp, null, 2));
  return files;
}
