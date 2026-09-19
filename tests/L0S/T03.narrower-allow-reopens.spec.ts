import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveFsRules,
  isDenied,
  type FsRules,
  type ResolvedFsRules,
} from "@harness/l0-sandbox";

/**
 * L0S-T03 · 边界（narrower allow reopens wider deny）
 * Given denyWrite ['/repo'] + allowWrite ['/repo/tmp']
 * When  isDenied('/repo/tmp/x', rules, 'write')
 * Then  denied=false（narrower allow 重开 wider deny）
 *
 * 长前缀匹配 + 优先级表 narrower > wider：
 * - /repo/tmp/x 命中 allowWrite['/repo/tmp']（更长）→ allow 重开
 * - /repo/other 仅命中 denyWrite['/repo']（更长前缀）→ 仍 deny
 */
describe("L0S-T03", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "l0s-t03-repo-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("narrower allowWrite reopens wider denyWrite", () => {
    const rules: FsRules = {
      allowWrite: [`${repoRoot}/tmp`],
      denyWrite: [repoRoot],
      denyRead: [],
      allowRead: [],
    };

    const resolved: ResolvedFsRules = resolveFsRules(rules, repoRoot);

    const result = isDenied(`${repoRoot}/tmp/x`, resolved, "write");

    expect(result.denied).toBe(false);
  });

  test("wider denyWrite still blocks sibling outside narrower allow", () => {
    const rules: FsRules = {
      allowWrite: [`${repoRoot}/tmp`],
      denyWrite: [repoRoot],
      denyRead: [],
      allowRead: [],
    };

    const resolved = resolveFsRules(rules, repoRoot);

    const result = isDenied(`${repoRoot}/other`, resolved, "write");

    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/denyWrite/);
  });

  test("exact narrower boundary path is allowed", () => {
    const rules: FsRules = {
      allowWrite: [`${repoRoot}/tmp`],
      denyWrite: [repoRoot],
      denyRead: [],
      allowRead: [],
    };

    const resolved = resolveFsRules(rules, repoRoot);

    const result = isDenied(`${repoRoot}/tmp`, resolved, "write");

    expect(result.denied).toBe(false);
  });

  test("narrower allowRead reopens wider denyRead", () => {
    const rules: FsRules = {
      allowWrite: [],
      denyWrite: [],
      denyRead: [repoRoot],
      allowRead: [`${repoRoot}/public`],
    };

    const resolved = resolveFsRules(rules, repoRoot);

    const reopened = isDenied(`${repoRoot}/public/notes.md`, resolved, "read");
    expect(reopened.denied).toBe(false);

    const stillDenied = isDenied(`${repoRoot}/secret.key`, resolved, "read");
    expect(stillDenied.denied).toBe(true);
    expect(stillDenied.reason).toMatch(/denyRead/);
  });
});
