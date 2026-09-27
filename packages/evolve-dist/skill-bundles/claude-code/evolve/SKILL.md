---
name: evolve
description: Run the self-evolving harness evolution cycle via `evolve run`. Use when the user asks to evolve, optimize, or refine prompts, skills, rules, or agent substrates, or to check evolution status.
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

```bash
evolve init --harness claude-code
```

This scaffolds `.harness/evolve.yaml` (harness id, substrate mapping, canary
task glob). Supported harness ids: `codex | opencode | hermes | openclaw |
cursor | generic` (+ `claude-code` substrate compat via the plugin registry).

## Run an evolution cycle

```bash
evolve run
```

Reads `.harness/evolve.yaml`, runs the mine → mutate → score → select →
deploy → verify cycle, and writes `.harness/evolve-state.json`. Useful flags:

- `--generations <n>` — number of evolution generations (default 1)
- `--canary-glob <g>` — canary task glob (default `.harness/canary/*.yaml`)
- `--llm <url>` — LLM base url (with `EVOLVE_LLM_API_KEY` /
  `EVOLVE_LLM_MODEL` env vars)

## Check status

```bash
evolve status
```

Shows the last evolution run (retained mutants, canary verdicts, deploy /
rollback state) from `.harness/evolve-state.json`.

## Notes

- Deployment is canary-gated: mutants only deploy when they strictly improve
  canary scores; failures roll back automatically.
- This skill is the agentskills.io install variant: copy it to
  `.claude/skills/evolve/SKILL.md` in the project (or `~/.claude/skills/evolve/`
  for user-level install).
