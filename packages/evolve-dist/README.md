# @harness/evolve-dist

Distribution orchestration for the `@harness/evolve-*` plugin family (PLG-T09):

- npm publishable validation — every `packages/evolve-*` package.json carries an
  independent semver `version`, `publishConfig`, `files`, and `exports`
  (source-published `./src/index.ts`, per monorepo convention).
- `scripts/publish.mjs` — validates publishability of every evolve-* package,
  then runs `pnpm -r publish --dry-run --filter "@harness/evolve-*" --no-git-checks`
  (dry-run only; real publishing requires a clean tree and explicit intent).
- `scripts/build-skill-bundles.mjs` — generates the agentskills.io install
  variants: `skill-bundles/claude-code/evolve/SKILL.md` (copy to
  `.claude/skills/evolve/SKILL.md`) and `skill-bundles/hermes/evolve/SKILL.md`
  (copy to `~/.hermes/skills/evolve/SKILL.md`). The bundles are instruction
  skills for the host agent — how to drive the `evolve` CLI — not HarnessPort
  implementations.

## Usage

```bash
node packages/evolve-dist/scripts/publish.mjs --dry-run
node packages/evolve-dist/scripts/build-skill-bundles.mjs
```
