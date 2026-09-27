// skill bundle 模板（PLG-T09 agentskills.io 变体）。
//
// skill bundle = 给宿主 agent 的"如何调用 evolve CLI"指令 skill（SKILL.md，
// YAML frontmatter + markdown body），非 HarnessPort 实现（spec 执行提示 (3)）。
// description 须含触发词 evolve/optimize/substrate（执行提示 (4)），
// body 须引用 `evolve run` 命令（行为规范）。

const CLAUDE_CODE_SKILL_MD = `---
name: evolve
description: Run the self-evolving harness evolution cycle via \`evolve run\`. Use when the user asks to evolve, optimize, or refine prompts, skills, rules, or agent substrates, or to check evolution status.
---

# evolve — self-evolving harness (Claude Code skill)

Drive the self-evolving harness from this repository: mine trajectories, mutate
the agent substrate, score mutants against canary tasks, and deploy only
strict improvements (with automatic rollback).

## When to use

- The user asks to **evolve**, **optimize**, or otherwise improve agent
  prompts, skills, rules, or the agent substrate.
- The user asks to **tune** or **self-improve** the harness/agent setup.
- The user asks for evolution **status** or results of the last run.

## Setup (once per project)

\`\`\`bash
evolve init --harness claude-code
\`\`\`

This scaffolds \`.harness/evolve.yaml\` (harness id, substrate mapping, canary
task glob). Supported harness ids: \`codex | opencode | hermes | openclaw |
cursor | generic\` (+ \`claude-code\` substrate compat via the plugin registry).

## Run an evolution cycle

\`\`\`bash
evolve run
\`\`\`

Reads \`.harness/evolve.yaml\`, runs the mine → mutate → score → select →
deploy → verify cycle, and writes \`.harness/evolve-state.json\`. Useful flags:

- \`--generations <n>\` — number of evolution generations (default 1)
- \`--canary-glob <g>\` — canary task glob (default \`.harness/canary/*.yaml\`)
- \`--llm <url>\` — LLM base url (with \`EVOLVE_LLM_API_KEY\` /
  \`EVOLVE_LLM_MODEL\` env vars)

## Check status

\`\`\`bash
evolve status
\`\`\`

Shows the last evolution run (retained mutants, canary verdicts, deploy /
rollback state) from \`.harness/evolve-state.json\`.

## Notes

- Deployment is canary-gated: mutants only deploy when they strictly improve
  canary scores; failures roll back automatically.
- This skill is the agentskills.io install variant: copy it to
  \`.claude/skills/evolve/SKILL.md\` in the project (or \`~/.claude/skills/evolve/\`
  for user-level install).
`;

const HERMES_SKILL_MD = `---
name: evolve
description: Run the self-evolving harness evolution cycle via \`evolve run\`. Use when the user asks to evolve, optimize, or refine prompts, skills, rules, or agent substrates, or to check evolution status.
---

# evolve — self-evolving harness (Hermes skill)

Drive the self-evolving harness: mine session trajectories, mutate the agent
substrate (skills / rules / prompts), score mutants against canary tasks, and
deploy only strict improvements (with automatic rollback).

## When to use

- The user asks to **evolve**, **optimize**, or otherwise improve agent
  prompts, skills, rules, or the agent substrate.
- The user asks for evolution **status** or results of the last run.
- A scheduled (cron-triggered) evolve run is mentioned in the state file.

## Setup (once per project)

\`\`\`bash
evolve init --harness hermes
\`\`\`

This scaffolds \`.harness/evolve.yaml\` (harness id, substrate mapping, canary
task glob). Supported harness ids: \`codex | opencode | hermes | openclaw |
cursor | generic\`.

## Run an evolution cycle

\`\`\`bash
evolve run
\`\`\`

Reads \`.harness/evolve.yaml\`, runs the mine → mutate → score → select →
deploy → verify cycle, and writes \`.harness/evolve-state.json\`. Useful flags:

- \`--generations <n>\` — number of evolution generations (default 1)
- \`--canary-glob <g>\` — canary task glob (default \`.harness/canary/*.yaml\`)
- \`--llm <url>\` — LLM base url (with \`EVOLVE_LLM_API_KEY\` /
  \`EVOLVE_LLM_MODEL\` env vars)

## Check status

\`\`\`bash
evolve status
\`\`\`

Shows the last evolution run from \`.harness/evolve-state.json\`.

## Notes

- Deployment is canary-gated: mutants only deploy when they strictly improve
  canary scores; failures roll back automatically.
- This skill is the agentskills.io install variant: copy it to
  \`~/.hermes/skills/evolve/SKILL.md\`.
`;

/** frontmatter + body 自检（生成前校验，非法即 build 报错——spec 行为规范）。 */
export function validateSkillMarkdown(text, label) {
  if (!/^---\r?\n/.test(text)) {
    return { ok: false, reason: `${label}: must start with YAML frontmatter (---)` };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) {
    return { ok: false, reason: `${label}: frontmatter is not closed` };
  }
  const frontmatter = text.slice(4, end);
  if (!/^name:\s*\S/m.test(frontmatter)) {
    return { ok: false, reason: `${label}: frontmatter "name" is empty` };
  }
  if (!/^description:\s*\S/m.test(frontmatter)) {
    return { ok: false, reason: `${label}: frontmatter "description" is empty` };
  }
  const body = text.slice(end + 4);
  if (!body.includes("evolve run")) {
    return { ok: false, reason: `${label}: body must reference the "evolve run" command` };
  }
  return { ok: true };
}

/** @returns {{ dir: string, text: string }[]} */
export function skillBundleTargets() {
  return [
    { dir: "claude-code", text: CLAUDE_CODE_SKILL_MD },
    { dir: "hermes", text: HERMES_SKILL_MD },
  ];
}
