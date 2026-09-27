---
name: evolve
description: Run the self-evolving harness evolution cycle via `evolve run`. Use when the user asks to evolve, optimize, or refine prompts, skills, rules, or agent substrates, or to check evolution status.
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

```bash
evolve init --harness hermes
```

This scaffolds `.harness/evolve.yaml` (harness id, substrate mapping, canary
task glob). Supported harness ids: `codex | opencode | hermes | openclaw |
cursor | generic`.

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

Shows the last evolution run from `.harness/evolve-state.json`.

## Notes

- Deployment is canary-gated: mutants only deploy when they strictly improve
  canary scores; failures roll back automatically.
- This skill is the agentskills.io install variant: copy it to
  `~/.hermes/skills/evolve/SKILL.md`.
