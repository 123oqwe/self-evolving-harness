// L3-T13 (REFACTOR): shared DSL breaker-flag walker.
//
// Spec: execution/L3-engine/TASKS.md §L3-T13 REFACTOR — "DSL 校验器复用 L2-T09b
// 的 breaker clause exec/eval/网络 flag 检测 (抽 dsl-validator.ts)".
//
// Pure static analysis over an acorn/ESTree-style AST. Walks every node
// (objects carrying a `type` string) and inspects CallExpression nodes for
// forbidden flags. Also scans Literal string values for network egress URLs.
//
// Forbidden flags (breaker clause, L2-T09b contract):
//   - eval():               "eval"
//   - network egress:       fetch / XMLHttpRequest / WebSocket / EventSource
//                           / sendBeacon / http(s) / ws(s) URLs in string literals
//   - subprocess:           exec / execSync / execFile / spawn / spawnSync
//                           / fork / require('child_process')
//
// All checks are fail-closed: a node we cannot classify is ignored, but the
// known-dangerous identifiers above are always flagged.

import type { AST } from "./agent-dsl.js";

export interface DslValidationResult {
  ok: boolean;
  violations: string[];
}

const EVAL_NAMES = new Set<string>(["eval"]);

const NETWORK_NAMES = new Set<string>([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "navigator",
  "sendBeacon",
  "connect",
]);

const EXEC_NAMES = new Set<string>([
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "spawn",
  "spawnSync",
  "fork",
  "system",
  "popen",
]);

const NETWORK_URL_RE = /\b(https?:|wss?:|ftp:|file:|\.example)\b/i;

/** Walk all ESTree-style nodes (objects with a string `type` field). */
function* walkNodes(root: unknown): IterableIterator<Record<string, unknown>> {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    if (typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    if (typeof n["type"] === "string") {
      yield n;
      for (const key of Object.keys(n)) {
        if (key === "type") continue;
        stack.push(n[key]);
      }
    }
  }
}

function identifierName(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (n["type"] === "Identifier" && typeof n["name"] === "string") {
    return n["name"];
  }
  return null;
}

function literalStringValue(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (n["type"] === "Literal" && typeof n["value"] === "string") {
    return n["value"];
  }
  return null;
}

/**
 * Validate an AST against the DSL breaker clause. Returns `{ ok, violations }`.
 */
export function validateBreakerFlags(ast: AST): DslValidationResult {
  const violations: string[] = [];

  for (const node of walkNodes(ast)) {
    if (node["type"] !== "CallExpression") continue;
    const callee = node["callee"] as unknown;
    const args = (node["arguments"] as unknown[]) ?? [];

    // Direct identifier callee.
    const name = identifierName(callee);
    if (name !== null) {
      if (EVAL_NAMES.has(name)) {
        violations.push(
          `breaker: eval() call is forbidden (eval flag)`,
        );
      }
      if (NETWORK_NAMES.has(name)) {
        violations.push(
          `breaker: network egress via ${name}() is forbidden (network flag)`,
        );
      }
      if (EXEC_NAMES.has(name)) {
        violations.push(
          `breaker: subprocess call ${name}() is forbidden (exec/spawn/subprocess flag)`,
        );
      }
      // require('child_process') → subprocess module
      if (name === "require") {
        const first = literalStringValue(args[0]);
        if (first !== null && /child_process/i.test(first)) {
          violations.push(
            `breaker: subprocess module 'child_process' require is forbidden (exec/spawn/subprocess flag)`,
          );
        }
      }
      continue;
    }

    // Member-expression callee: object.<prop>() e.g. cp.execSync().
    if (callee && typeof callee === "object") {
      const c = callee as Record<string, unknown>;
      if (c["type"] === "MemberExpression" && c["computed"] === false) {
        const prop = identifierName(c["property"]);
        if (prop !== null) {
          if (EXEC_NAMES.has(prop)) {
            violations.push(
              `breaker: subprocess call .${prop}() is forbidden (exec/spawn/subprocess flag)`,
            );
          }
          if (NETWORK_NAMES.has(prop)) {
            violations.push(
              `breaker: network egress via .${prop}() is forbidden (network flag)`,
            );
          }
          if (EVAL_NAMES.has(prop)) {
            violations.push(
              `breaker: eval() call is forbidden (eval flag)`,
            );
          }
        }
      }
    }
  }

  // Scan all string literals for network egress URLs (fail-closed: a URL
  // literal in a call's argument is flagged even if the callee is unknown).
  for (const node of walkNodes(ast)) {
    if (node["type"] !== "Literal") continue;
    const v = node["value"];
    if (typeof v === "string" && NETWORK_URL_RE.test(v)) {
      violations.push(
        `breaker: network egress URL '${v}' is forbidden (network flag)`,
      );
    }
  }

  // Dedupe while preserving order for deterministic output.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const v of violations) {
    if (!seen.has(v)) {
      seen.add(v);
      deduped.push(v);
    }
  }

  return { ok: deduped.length === 0, violations: deduped };
}
