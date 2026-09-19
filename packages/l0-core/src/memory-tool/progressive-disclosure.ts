// L0C-T06 · 3-level progressive disclosure contract.
//
// Spec: execution/L0-core/TASKS.md §L0C-T06 (ERRATA-amended).
//
// Progressive disclosure (Agent Skills open standard, agentskills.io §1;
// research/03-skills.md §1):
//   L1-metadata   — `name` + `description` only, permanently resident in the
//                   system prompt (cheap, always loaded).
//   L2-skill-md   — full `SKILL.md` body, loaded on demand.
//   L3-references — scripts / references, loaded by reference only.
//
// The Level 1 contract is a hard window-budget invariant: only `name` and
// `description` may sit in the always-resident prompt region. Leaking a
// Level 2 body (or any other field) into Level 1 would balloon the stable
// cache prefix and defeat the 3-level cost model. `assertLevel1Only`
// enforces exactly that: any key beyond `name`/`description` is rejected.

/**
 * Level 1 skill metadata — the only two fields permanently resident in the
 * system prompt. Intentionally bare: no `body`, no `scripts`, no `references`.
 */
export interface SkillMetadataL1 {
  readonly name: string;
  readonly description: string;
}

/**
 * The three progressive-disclosure levels in their canonical order
 * (L1 → L2 → L3). Frozen so callers cannot mutate the level set or order
 * (changing the command set breaks the tool-use contract, PRD §6.6).
 */
export const PROGRESSIVE_LEVELS = [
  "L1-metadata",
  "L2-skill-md",
  "L3-references",
] as const;

/** The only keys permitted in a Level 1 metadata object. */
const L1_ALLOWED_KEYS: ReadonlySet<string> = new Set(["name", "description"]);

/**
 * Assert that `meta` carries **only** the two Level 1 fields (`name`,
 * `description`). Throws if any extra field is present — this is the guard
 * against Level 2 content leaking into the always-resident Level 1 region
 * (which would inflate the stable cache prefix and break the cost model).
 *
 * `name`/`description` type-correctness is NOT enforced here; downstream
 * loaders validate types. This function only guards the *shape* contract.
 */
export function assertLevel1Only(meta: SkillMetadataL1): void {
  if (meta === null || typeof meta !== "object") {
    throw new Error(
      "L1 metadata must be a non-null object with only `name` and `description`",
    );
  }
  const obj = meta as unknown as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!L1_ALLOWED_KEYS.has(key)) {
      throw new Error(
        `L1 metadata must not carry extra field \`${key}\`; only \`name\` and \`description\` are allowed at Level 1 (Level 2 content must stay out of the always-resident region)`,
      );
    }
  }
  // Require both name and description to be present.
  if (!("name" in obj) || !("description" in obj)) {
    throw new Error(
      "L1 metadata must define both `name` and `description`",
    );
  }
}
