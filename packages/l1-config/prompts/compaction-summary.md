# Compaction Summary

> L1-T02 baseline · compaction summary prompt 基质（被进化基质）。
> 基于 pi compaction 结构化模板改写（reserveTokens/keepRecentTokens 不在本任务，属 L0C-T05）。
> 含 `<safety>` 段占位由 T03 落签名；删 safety 段 pre-commit reject（PRD §11.3）。

The messages above are a conversation to summarize. Create a structured context
checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

<read-files>
- [Exact file paths read this session, one per line]
</read-files>

<modified-files>
- [Exact file paths created/modified this session, one per line]
</modified-files>

<safety>
Never omit unresolved bugs from the Progress section. Never drop tool_use_id pairing.
</safety>

Keep each section concise. Preserve exact file paths, function names, and error messages.
