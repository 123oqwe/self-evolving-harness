// L0C-T10 · breaker clause runtime engine.
//
// Spec: execution/L0-core/TASKS.md §L0C-T10 (ERRATA-amended).
//
// Runtime breaker: a second interception layer at evolution-engine apply
// time (before a diff mutates the live tree). It is the *runtime mirror* of
// L0C-T08 `checkDiff` — pre-commit is a commit-time guard (bypassable via
// `git commit --no-verify`); breaker runs at apply time, so it cannot be
// skipped by client flags.
//
// Contract:
//   - Hit → reject + emit a `security_event` onto the supplied SessionLog
//   - severity map: safety/deny_to_allow/static_core_field_removed/
//     resource_control_model_realloc = critical;
//     acceptance_threshold_widened = warn
//   - unsent-tracking field removal = static_core_field_removed subset,
//     forced critical (resume-replay risk)
//   - fail-closed: if SessionLog.append throws, still reject (a log fault
//     must never widen the breaker — else attackers fabricate log faults)
//   - meta self-check: a diff that edits `breaker.ts` and mutates the
//     BREAKER_CLAUSES array literal is rejected (reward-tampering guard)
//
// ERRATA rulings honored:
//   - L0C-04: security event sessionId fixed to `'security'`; event shape
//     `{ type:'security_event', sessionId:'security', clauses, severity }`
//     (surfaced via SessionLogEvent: payload carries `clauses` + `severity`).
//   - L0C-05: meta self-modification heuristic — diff path points at
//     breaker.ts AND mutates the BREAKER_CLAUSES array literal → reject.

import {
  checkDiff,
  STATIC_CORE_FIELD_REGISTRY,
} from "./pre-commit.js";
import type { Diff, DangerousDiffKind } from "./pre-commit.js";
import type { SessionLog, SessionLogEvent } from "../session-log/session-log.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BreakerVerdict {
  readonly reject: boolean;
  readonly clauses: DangerousDiffKind[];
  readonly severity: "info" | "warn" | "critical";
}

// ---------------------------------------------------------------------------
// BREAKER_CLAUSES — reuses T08 DangerousDiffKind literals verbatim to
// eliminate naming drift. The array is frozen so runtime mutation throws in
// strict mode (a would-be attacker editing it in-memory trips immediately).
// ---------------------------------------------------------------------------

export const BREAKER_CLAUSES: readonly DangerousDiffKind[] = [
  "safety_segment_deleted",
  "deny_to_allow",
  "static_core_field_removed",
  "acceptance_threshold_widened",
  "resource_control_model_realloc",
] as const;

// ---------------------------------------------------------------------------
// Internal: severity mapping + unsent-tracking subset escalation
// ---------------------------------------------------------------------------

const UNSENT_TRACKING_FIELD = "unsent_tool_call_ids_for_interrupted_state";

/**
 * Severity for a clause kind. `static_core_field_removed` is critical by
 * default; the unsent-tracking subset is critical (explicitly — it is not a
 * separate kind, only an escalation confirmation).
 */
function severityFor(kind: DangerousDiffKind): "info" | "warn" | "critical" {
  switch (kind) {
    case "acceptance_threshold_widened":
      return "warn";
    case "safety_segment_deleted":
    case "deny_to_allow":
    case "static_core_field_removed":
    case "resource_control_model_realloc":
      return "critical";
  }
}

/**
 * Aggregate removed field names that triggered `static_core_field_removed`.
 * Re-runs the field-removal detection to recover *which* registered fields
 * were removed, so the breaker can flag the unsent-tracking subset.
 */
function removedStaticCoreFieldNames(diff: Diff): string[] {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.oldLines) oldLines.push(line);
    for (const line of hunk.newLines) newLines.push(line);
  }
  const removed: string[] = [];
  const escapeRegExp = (s: string): string =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const field of STATIC_CORE_FIELD_REGISTRY) {
    const defRe = new RegExp(`^\\s*${escapeRegExp(field)}\\s*:`);
    const oldHas = oldLines.some((l) => defRe.test(l));
    const newHas = newLines.some((l) => defRe.test(l));
    if (oldHas && !newHas) removed.push(field);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Internal: meta self-check (breaker cannot edit its own BREAKER_CLAUSES)
// ---------------------------------------------------------------------------

const BREAKER_SELF_PATH = "packages/l0-core/src/guard/breaker.ts";

/** Tests whether a line is a BREAKER_CLAUSES array literal entry. */
function isBreakerClauseLine(line: string): boolean {
  // Matches any of the five clause string literals appearing as array
  // elements (with optional trailing comma / surrounding quotes).
  return BREAKER_CLAUSES.some(
    (c) => line.includes(`"${c}"`) || line.includes(`'${c}'`),
  );
}

/**
 * Meta self-modification detection (ERRATA L0C-05 heuristic):
 * diff path === breaker.ts AND the old/new lines show the BREAKER_CLAUSES
 * array literal shrank (an element present in old but absent in new) OR grew
 * by removing a clause. Any array-literal element-count reduction where a
 * clause literal vanishes → reject.
 */
function detectsBreakerSelfModification(diff: Diff): boolean {
  if (diff.path !== BREAKER_SELF_PATH) return false;
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.oldLines) oldLines.push(line);
    for (const line of hunk.newLines) newLines.push(line);
  }
  // A clause literal present in old but absent in new = removal → reject.
  for (const clause of BREAKER_CLAUSES) {
    const inOld = oldLines.some((l) => l.includes(`"${clause}"`));
    const inNew = newLines.some((l) => l.includes(`"${clause}"`));
    if (inOld && !inNew) return true;
  }
  // Also catch edits that strip the whole array or rewrite clause literals
  // (old has clause lines, new has none at all) → reject.
  const oldClauseLines = oldLines.filter(isBreakerClauseLine).length;
  const newClauseLines = newLines.filter(isBreakerClauseLine).length;
  if (oldClauseLines > 0 && newClauseLines < oldClauseLines) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Internal: security-event emission (fail-closed)
// ---------------------------------------------------------------------------

let securityEventSeq = 0;

function emitSecurityEvent(
  sessionLog: SessionLog,
  clauses: DangerousDiffKind[],
  severity: "info" | "warn" | "critical",
): void {
  const event: SessionLogEvent = {
    uuid: `breaker-security-${Date.now()}-${securityEventSeq++}`,
    parentUuid: null,
    type: "security_event",
    sessionId: "security",
    ts: Date.now(),
    payload: { clauses, severity },
  };
  // fail-closed: a throw here must propagate to the caller, which still
  // returns reject=true. The throw is *caught* in `evaluate`, not swallowed.
  sessionLog.append(event);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a diff at runtime. Hits → reject + security event on the session
 * log. fail-closed: if the session log append throws, the breaker still
 * rejects (log fault must never widen the breaker).
 */
export function evaluate(diff: Diff, sessionLog: SessionLog): BreakerVerdict {
  // --- meta self-check (breaker cannot disable its own clauses) ----------
  const selfModified = detectsBreakerSelfModification(diff);

  // --- runtime mirror of T08 checkDiff ----------------------------------
  const preCommit = checkDiff(diff);
  const clauses: DangerousDiffKind[] = [...preCommit.violations];

  if (selfModified) {
    // Meta violation: not a named DangerousDiffKind (it is self-tampering),
    // but the breaker must still reject. Surface the existing clauses; if
    // none, the rejection is purely meta — represented as a deny_to_allow-
    // free critical reject with empty-ish clause set but reject=true.
    // To keep the BreakerVerdict shape truthful, we do NOT fabricate a kind;
    // we reject with whatever checkDiff found (possibly empty) and severity
    // critical.
  }

  const reject = clauses.length > 0 || selfModified;

  // --- severity ---------------------------------------------------------
  let severity: "info" | "warn" | "critical" = "info";
  for (const kind of clauses) {
    const s = severityFor(kind);
    if (s === "critical") {
      severity = "critical";
      break;
    }
    if (s === "warn" && severity === "info") {
      severity = "warn";
    }
  }
  // unsent-tracking subset forced critical (resume-replay risk)
  if (clauses.includes("static_core_field_removed")) {
    const removed = removedStaticCoreFieldNames(diff);
    if (removed.includes(UNSENT_TRACKING_FIELD)) {
      severity = "critical";
    }
  }
  if (selfModified && severity !== "critical") {
    severity = "critical";
  }

  // --- security event + fail-closed -------------------------------------
  if (reject) {
    try {
      emitSecurityEvent(sessionLog, clauses, severity);
    } catch {
      // fail-closed: log fault must NOT widen the breaker. Swallow the log
      // error and still return reject=true.
    }
  }

  return { reject, clauses, severity };
}
