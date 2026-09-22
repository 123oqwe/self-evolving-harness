# OPS-T03 · flaky 用例定位报告

> 由 `scripts/run-suite-5x.mjs` 自动生成。

## 概要

- 运行次数 (runs): 5
- 成功解析的 run: 5 / 5
- 跳过的 run (解析失败): 0
- 用例总数: 874
- flake 用例数: 1
- 状态: flake detected (1 个用例结果跨 run 不一致)

## pass/fail 矩阵

| 用例 | run-1 | run-2 | run-3 | run-4 | run-5 |
| --- | --- | --- | --- | --- | --- |
| CE-T01a should load >=30 decontaminated tasks | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T01a should reject task whose repo structure appears in trainSet | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T01a should keep agentVisible=false invariant | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T01b should add coverage tests and reject >=19.71% false positives | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T01b should reject plausible-but-incorrect patch after strengthening | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T01b should discard mutation case tainted by prompt injection | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T01c should PASS when all T/O valid and coverage>=0.9 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T01c should report BUDGET when coverage<0.9 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T01c should FAIL when agent visible | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T02 should return exitCode 0 after FAIL-to-PASS fix | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T02 should throw on cross-run stdout merge | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T02 should never produce prose-only verdict on timeout | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T03 should flag blind retry loop lucky pass | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T03 should pass solid trajectory | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T03 should handle missing toolCalls gracefully | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T03 filterAndTag tags each entry with luckyPass and substrateSha | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T04 should use different model family and cap iterations at 5 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T04 should throw when nlSummary provided | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T04 should throw on same model family | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T05 should swap A/B and report sigma | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T05 should mark inconsistent when sigma > gap | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T05 should drop same-family judge from pool | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T05 should calibrate accuracy against L0 verdicts | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T06 should auto-revert on resolveRate drop | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T06 should promote when no degradation | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T06 should reject runtime mutation of revert thresholds | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T07 should pass when exit-code evidence exists | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T07 should abort when no verifications | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T07 should abort on prose-only evidence | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T08 should report chi2/p/ci and scaffoldSha for n=30 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T08 should report unresolvedBudget when n<30 and coverage<0.9 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T08 should throw on incomplete pairs | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T09 should report positive delta with discrimination | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T09 should flag no discrimination when delta below threshold | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T09 should warn when mag<brute | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T10 should report four competencies and saturation gap | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T10 should flag weak selective forgetting | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T10 should throw when memory tool unavailable | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T11 should expand to detect 5pp with coverage>=0.9 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T11 should flag needsMoreTasks when underpowered | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T11 should reject un-decontaminated new tasks | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T12 should isolate variant that drops on clean canary | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T12 should pass normal-improving variant | ✅ | ✅ | ✅ | ✅ | ✅ |
| CE-T12 should throw when clean canary unavailable | ✅ | ✅ | ✅ | ✅ | ✅ |
| SEC-T01 · crossCheckEperm consistent when epermHits empty | ✅ | ✅ | ✅ | ✅ | ✅ |
| SEC-T01 · crossCheckEperm consistent when epermHits non-empty and exitCode non-zero | ✅ | ✅ | ✅ | ✅ | ✅ |
| SEC-T01 · crossCheckEperm forged-suspect when epermHits non-empty but exitCode=0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| SEC-T01 · filterForgedEperm drops forged-suspect runs and emits warnings | ✅ | ✅ | ✅ | ✅ | ✅ |
| SEC-T01 · filterForgedEperm all-consistent runs → kept unchanged, dropped empty | ✅ | ✅ | ✅ | ✅ | ✅ |
| SEC-T01 · assertFreshEvidence 接线 drops forged eperm evidence before judging | ✅ | ✅ | ✅ | ✅ | ✅ |
| SEC-T01 · assertFreshEvidence 接线 filterForgedEperm is wired into assertFreshEvidence entry (single responsibility) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T01 monorepo has 7 packages | ❌ | ❌ | ❌ | ❌ | ❌ |
| L0C-T01 tsconfig strict enabled | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T01 verify.sh dispatches TASK-ID | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T01 exports L0_CORE_VERSION === 0.1.0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T01 pnpm install produces lockfile with no peer warnings | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T01 pnpm -r build succeeds for all 7 packages | ❌ | ❌ | ❌ | ❌ | ✅ |
| L0C-T01 vitest exits 0 with passWithNoTests | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T01 directory tree matches WBS §2 seven package names exactly | ❌ | ❌ | ❌ | ❌ | ❌ |
| L0C-T02 pairs tool_use_id round-trip | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T02 rejects orphan tool_result with 400 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T02 rejects mismatched tool_use_id with 400 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T02 rejects out-of-order tool_result before its tool_use | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T02 flushes pending only at turn_end | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T02 turn_end requires id-matched tool_results | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T02 rejects null content in tool_result | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T02 rejects null element inside tool_result content array | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T02 normalizeContent accepts valid string content in tool_result | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 evaluateStop — 四层停止检测 end_turn layer triggers on end_turn stop reason | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 evaluateStop — 四层停止检测 max_turns layer triggers when turnIndex reaches maxTurns (boundary: equal) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 evaluateStop — 四层停止检测 max_turns layer triggers when turnIndex exceeds maxTurns | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 evaluateStop — 四层停止检测 unrecoverable_error layer triggers on retryExhausted + error | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 evaluateStop — 四层停止检测 abort layer triggers when abortSignal.aborted===true | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 evaluateStop — 优先级判定（spec GREEN: end_turn → abort → unrecoverable_error → max_turns） abort takes priority over max_turns | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 evaluateStop — 优先级判定（spec GREEN: end_turn → abort → unrecoverable_error → max_turns） unrecoverable_error takes priority over max_turns | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler accepts valid output and passes it through | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler accepts valid output with incomplete=true and empty nextSteps | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 max_turns handler falls back on invalid schema (missing incomplete field) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back on null input | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back when nextSteps is not an array | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back when summary is missing | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back when summary is not a string | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back when incomplete is not a boolean | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T04 resets retry counter on success | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T04 classifies 429 retryable, 400 not | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T04 overflow guard single-shot lock | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T04 dispose aborts even if hook throws | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T04 reset only on non-error non-length stop | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 constants STABLE_PREFIX_UNTOUCHABLE is true (prefix 不可被 compaction 触碰) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 constants DEFAULT_RESERVE === 16384 (L1 config 默认值锚点) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 constants DEFAULT_KEEP_RECENT === 20000 (L1 config 默认值锚点) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 assertStablePrefix — cache prefix exact-prefix 不变量 cache prefix unchanged passes: oldHash === newHash 不 emit violation | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 assertStablePrefix — cache prefix exact-prefix 不变量 cache prefix change emits violation: oldHash !== newHash → emit CachePrefixViolation 事件（不 throw，10x 成本告警不变量） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 assertStablePrefix — cache prefix exact-prefix 不变量 cache prefix violation handler 可取消订阅（unsubscribe 后不再收到事件） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 findValidCutPoints — 切点必须落在 user/assistant 消息边界 valid cut points exclude tool_result: [user, assistant(tool_use), tool_result, user] → [0,1,3] | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 findValidCutPoints — 切点必须落在 user/assistant 消息边界 valid cut points exclude compaction entries: compaction entry 不可作切点 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 findValidCutPoints — 切点必须落在 user/assistant 消息边界 findValidCutPoints respects [start, end) slice: 只返回该范围内的合法切点 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 assertCutNotOrphan — 切点不得产生孤儿 tool_result cut at tool_result throws orphan: 切点落在 tool_result 处 → throw | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 assertCutNotOrphan — 切点不得产生孤儿 tool_result cut at user/assistant boundary does not throw: 合法切点通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 assertCutNotOrphan — 切点不得产生孤儿 tool_result cut at compaction entry throws: compaction 不是合法切点 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 assertStablePrefixUntouched — compaction 切点不得落在 stable prefix 区域 cut inside stable prefix throws: cutIndex < prefixLen → throw | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T05 assertStablePrefixUntouched — compaction 切点不得落在 stable prefix 区域 cut after stable prefix passes: cutIndex >= prefixLen → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 progressive disclosure PROGRESSIVE_LEVELS exposes the 3 ordered levels L1->L2->L3 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 progressive disclosure L1 metadata only allows name+description (assertLevel1Only passes) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 progressive disclosure L1 metadata containing extra `body` field is rejected (防 Level 2 内容泄漏进 Level 1 常驻区) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 progressive disclosure L1 metadata containing any other extra field is rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands validates six commands (view/create/str_replace/insert/delete/rename each one valid case) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands valid `view /memories/foo` input returns {ok:true, command:'view'} | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands view with optional path omitted is still valid (path is Optional) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands rejects extra fields via strict schema (view command with stray `content`) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands rejects unknown command | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands rejects create missing required `content` | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands rejects str_replace missing required `old_str`/`new_str` | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands rejects insert missing required `insert_line`/`content` | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands rejects rename missing required `new_path` | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 validateMemoryCommand — six commands rejects non-object input | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertStrReplaceUnique passes when old_str appears exactly once in content | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertStrReplaceUnique str_replace rejects non-unique old_str (appears 2 times) — 不静默改错处 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertStrReplaceUnique rejects when old_str does not occur at all (nothing to replace) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertCreateNoOverwrite passes when target does not exist (exists=false) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertCreateNoOverwrite create rejects overwrite (exists=true) — 拒覆写 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertCanonicalPath passes for a legal nested memory path | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertCanonicalPath passes for a single-segment memory path | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertCanonicalPath canonical path rejects traversal `../` (越界) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertCanonicalPath canonical path rejects URL-encoded traversal `%2e%2e` | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertCanonicalPath canonical path rejects operating on the `/memories` root itself | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T06 assertCanonicalPath canonical path rejects path entirely outside the memory root | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 round-trips unsent_tool_call_ids round-trips unsent_tool_call_ids through serialize/deserialize | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 terminal requires persisted first markTerminalAfterPersist throws when persisted=false (must persist first) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 terminal requires persisted first markTerminalAfterPersist marks terminal=true only after persisted=true | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 terminal requires persisted first markTerminalAfterPersist throws on unknown toolUseId | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 resume does not resend terminal tool calls assertNoResentToolCalls throws when a terminal tool_use is in the executed set (hard constraint) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 resume does not resend terminal tool calls assertNoResentToolCalls passes when terminal tool calls are NOT re-executed (execution count = 0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 resume does not resend terminal tool calls resume keeps execution count of terminal tool calls at 0 (hard constraint invariant) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 rejects version mismatch deserializeRunState throws when version does not match (schema drift guard) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 rejects version mismatch deserializeRunState throws on malformed JSON | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 rejects version mismatch deserializeRunState accepts the current version unchanged | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07b SessionLog append-only contract append makes has return true | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07b SessionLog append-only contract append-only rejects rewrite | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07b SessionLog append-only contract parentUuid branch traceable | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07b wake rehydration wake rehydrates equivalent state | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07b WriteDeltaJournal journal replays in completion order | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T07b WriteDeltaJournal journal rejects conflicting key | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 STATIC_CORE_FIELD_REGISTRY registers the protected static-core fields including unsent_tool_call_ids_for_interrupted_state | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 STATIC_CORE_FIELD_REGISTRY registry is readonly (frozen) — 删 registry 项本身也属 violation 基础 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 safety_segment_deleted: diff deleting a `<safety>` line → allow=false, violations=['safety_segment_deleted'] | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 deny_to_allow: diff changing `bash: deny` → `bash: allow` → violations=['deny_to_allow'] | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 deny_to_allow: diff changing `write: deny` → `write: allow` → violations=['deny_to_allow'] | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 static_core_field_removed: diff deleting `unsent_tool_call_ids` field definition (field in registry) → violations=['static_core_field_removed'] | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 static_core_field_removed: deleting a non-registered field is NOT flagged | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 acceptance_threshold_widened: diff changing acceptance_threshold 0.8 → 0.6 (放宽) → violations=['acceptance_threshold_widened'] | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 acceptance_threshold tightening (0.8 → 0.9) is NOT a violation (调严放行) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 resource_control_model_realloc: diff changing resources control-model false → true → violations=['resource_control_model_realloc'] | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 allows legitimate prompt edit (改 prompt 文案不改字段/阈值方向) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 allows a diff that only adds new non-protected lines | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 aggregates multiple violation kinds in a single diff | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 returns a well-formed PreCommitVerdict for a clean diff | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 every violation kind is a valid DangerousDiffKind literal | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 installPreCommitHook installPreCommitHook writes executable hook to .git/hooks/pre-commit | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 installPreCommitHook installed hook file content references the pre-commit check (not empty) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T08 installPreCommitHook installPreCommitHook is idempotent (re-install does not throw) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 evaluate 已由 L0C 导出为 function | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 BREAKER_CLAUSES 已由 L0C 导出且为数组 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 rejects deny_to_allow and logs security event | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 rejects safety_segment_deleted and logs security event (critical) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 rejects resource_control_model_realloc (critical) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 rejects acceptance_threshold_widened (warn) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 flags unsent tracking removal as critical static_core_field_removed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 ordinary static_core_field_removed 也是 critical（默认映射） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 allows legitimate diff | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 rejects self-modification of BREAKER_CLAUSES | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 BREAKER_CLAUSES 覆盖全部五类 DangerousDiffKind（杜绝命名漂移） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T10 fail-closed when sessionLog throws | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 STATIC_CORE_DIRS registers the three protected static-core subtrees | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 isStaticCorePath returns true for a file inside packages/l0-core | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 isStaticCorePath returns true for the l0-core package root itself | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 isStaticCorePath returns true for a file inside the canary verifier subtree | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 isStaticCorePath returns true for a file inside the canary content subtree | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 isStaticCorePath returns false for an L1 evolvable substrate path | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 isStaticCorePath returns false for a prefix-collision sibling (l0-core-evil) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 assertWritable EPERM on static-core write | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 assertWritable EPERM on canary verifier write | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 assertWritable EPERM on canary content write | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 assertWritable allows L1 write | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 assertWritable resolves traversal | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 assertWritable traversal into static-core still blocked after resolve | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 assertWritable rejects prefix-collision attack | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 enforceReadOnly blocks wrapped writePath targeting a static-core path with EPERM | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T11 enforceReadOnly passes through wrapped writePath for an L1 path | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） mid_turn 插入点被拒：assistant 含 tool_use 且 tool_result 未到达 → isLegalInsertionPoint('mid_turn')===false | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） mid_turn flush 被拒（防孤儿 tool_use_id） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） turn_end 插入点合法：全部 tool_result 已到达 → isLegalInsertionPoint('turn_end')===true | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） turn_end flush 成功（destructive 清空，不抛） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） 纯文本 assistant（无 tool_use）= turn_end：合法插入点 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） 完整 transcript 中任一非 turn_end 点插入均被拒（端到端不变量） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-0 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-1 — 孤儿 → throw OrphanToolResultError(400) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-2 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-3 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-4 — 孤儿 → throw OrphanToolResultError(400) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-5 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-6 — 孤儿 → throw OrphanToolResultError(400) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-7 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-8 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-9 — 孤儿 → throw OrphanToolResultError(400) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-10 — 孤儿 → throw OrphanToolResultError(400) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-11 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-12 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-13 — 孤儿 → throw OrphanToolResultError(400) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-14 — 孤儿 → throw OrphanToolResultError(400) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-15 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-16 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-17 — 合法 → 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-18 — 孤儿 → throw OrphanToolResultError(400) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-19 — 孤儿 → throw OrphanToolResultError(400) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） 双例都覆盖：20 条中既有孤儿又有合法（fixture 完备性） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） 重复 tool_use id 视为 mismatch → throw 400 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） 重复 tool_result 同 id 视为 mismatch → throw 400 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b never-auto-delete（archive 非 delete） assertArchiveNotDeleted 已由 L0C 导出 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b never-auto-delete（archive 非 delete） archive 路径存在 → assertArchiveNotDeleted 通过（保留即恢复可能） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b never-auto-delete（archive 非 delete） archive 路径被物理删除 → assertArchiveNotDeleted throw（不可逆） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b C>0 下限（Ratchet bounded cap） assertCBound 已由 L0C 导出 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b C>0 下限（Ratchet bounded cap） C=50 → assertCBound 通过（有界容量） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b C>0 下限（Ratchet bounded cap） C=1 → assertCBound 通过（下限边界） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b C>0 下限（Ratchet bounded cap） C=0 → assertCBound throw（关掉有界容量 = 库崩塌） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b C>0 下限（Ratchet bounded cap） C=-5 → assertCBound throw（负值非法） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b authoring prior 存在 + 不可退役 assertAuthoringPriorExists 已由 L0C 导出 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b authoring prior 存在 + 不可退役 library 含 authoring prior 且不可退役 → assertAuthoringPriorExists 通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b authoring prior 存在 + 不可退役 library 不含 authoring prior → throw（移除损 43% gain） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b authoring prior 存在 + 不可退役 authoring prior 被标记为 retireable=true → throw（不可退役） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b unsent_tool_call_ids 跟踪（与 T07a 互补） round-trip 不丢失 unsent_tool_call_ids（中断恢复跟踪字段） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b unsent_tool_call_ids 跟踪（与 T07a 互补） 空 unsent_tool_call_ids 也能 round-trip（无未回填时不丢失空集） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b unsent_tool_call_ids 跟踪（与 T07a 互补） 多元素 unsent_tool_call_ids round-trip 保序 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b 切点=消息边界（findValidCutPoints 只返回 user/assistant） 100 条随机 entries → 所有返回 index 处 type ∈ {user, assistant} | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b 切点=消息边界（findValidCutPoints 只返回 user/assistant） 切点不含 tool_result（防孤儿 tool_result） | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T09b 切点=消息边界（findValidCutPoints 只返回 user/assistant） compaction 条目永不可为切点 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 三层守卫函数均已由 L0C 导出 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 fixture contains exactly 20 redteam cases | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 fixture ids are unique | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 fixture covers all 10 categories × 2 cases each | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-01 (safety_segment_deleted) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-01 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-02 (safety_segment_deleted) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-02 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-03 (deny_to_allow) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-03 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-04 (deny_to_allow) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-04 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-05 (acceptance_threshold_widened) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-05 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-06 (acceptance_threshold_widened) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-06 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-07 (static_core_field_removed) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-07 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-08 (static_core_field_removed) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-08 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-09 (resource_control_model_realloc) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-09 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-10 (resource_control_model_realloc) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-10 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-11 (breaker_self_modification) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-11 → expected layer (breaker) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-12 (breaker_self_modification) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-12 → expected layer (breaker) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-13 (read_only_write) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-13 → expected layer (read-only) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-14 (read_only_write) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-14 → expected layer (read-only) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-15 (read_only_canary) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-15 → expected layer (read-only) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-16 (read_only_canary) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-16 → expected layer (read-only) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-17 (read_only_verifier) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-17 → expected layer (read-only) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-18 (read_only_verifier) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-18 → expected layer (read-only) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-19 (static_core_field_removed) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-19 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-20 (static_core_field_removed) → rejected by at least one guard layer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam RT-20 → expected layer (pre-commit) rejects | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 0 of 20 redteam cases succeed (static-core compromise = 0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 夹带攻击：合法 prompt 改写里夹删 <safety> 行 → 被 safety_segment_deleted 检出 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 夹带攻击：合法 threshold edit 里夹 deny→allow → 被 deny_to_allow 检出 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0C-T12 redteam report format: succeeded count / total → 0/20 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T01 loadActive returns ConfigSet matching lock versionSha | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T01 loadActive throws ShaMismatchError when file tampered | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T01 reload atomically swaps only when all sha match | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T01 ScopeGuard rejects project scope override of policy.yaml | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T01 pinSha updates authoritative repo.lock.json.versionSha | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T01 pinSha propagates to loadActive versionSha | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T02 load returns baseline compaction substrate | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T02 load throws MissingSubstrateError when file absent | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T02 collectRecallSignal increments reread count | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T02 collectRecallSignal does not block on telemetry write failure | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T02 recall count 0 still emits signal | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T03 SignatureVerifier accepts matching safety segment | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T03 SignatureVerifier throws SignatureTamperError on one-byte change | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T03 SignatureVerifier throws when safety segment deleted | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T03 PhaseSubstrate.load verifies all three phase files | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T03 PhaseSubstrate.load throws and keeps old snapshot on tamper | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T03 collectCacheHit ignores warm-up session | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T03 load throws MissingSignatureManifestError when manifest absent | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04a generateCandidates returns up to 3 candidates with parentSha | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04a generateCandidates drops candidate that deletes safety segment | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04a generateCandidates returns empty on no failure trajectories | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04a generateCandidates returns empty on mutator failure | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04a generateCandidates runs mutator in sandbox with distinct session | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04b strictImprovementGate accepts all-improve candidate | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04b strictImprovementGate rejects cache degrade >= tau | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04b paretoFront returns non-dominated set | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04b paretoFront throws NoWeightedSumError on weighted single-number score | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04b commitOnSuccess writes active + staging v2 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04b rollback restores sha to pre-commit HEAD | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T04b rollback is idempotent on unchanged file | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05a generatePhaseCandidates returns candidates only for requested phase | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05a generatePhaseCandidates rejects candidate mutating static identity segment | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05a generatePhaseCandidates rejects candidate deleting safety | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05a generatePhaseCandidates returns empty on no failures | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05b select passes candidate with cacheHit null (warm-up not done) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05b select passes candidate with steady cache loss < tauCache | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05b select rejects candidate with steady cache loss > tauCache (divergence) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05b select rejects candidate with resolve degrade >= tau | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05b commitOnSuccess writes active + staging v2 + warmUpSessionId | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T05b rollback restores phase active sha | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T06 load returns ToolDoc with immutable name | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T06 load throws SchemaShapeLockedError when types field changed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T06 load throws SchemaShapeLockedError when required field changed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T06 load does not throw when non-shape property field changed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T06 collectSelectionSignal writes selection ∧ resolve joint signal | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T06 load flags cross-tool disparagement in description | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T07 generateToolCandidates patches only description not name/schema | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T07 select rejects candidate with resolve degrade (cheat selection) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T07 select passes candidate with selection∧resolve improve + token soft loss | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T07 commitOnSuccess rejects shape mutation | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T07 generateToolCandidates flags disparagement and excludes from staging | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T08 evolve defers low-freq high-cost tool | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T08 assertDeferNotHidingCritical allows defer bash with preserved discovery | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T08 assertDeferNotHidingCritical throws when bash deferred and discovery drops | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T08 evolve rejects candidate removing critical tool from active subset | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T08 Pareto select: token↓ + success持平 + discovery持平 → 入选 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T09 load returns ordered processor chain | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T09 evolve inserts CacheControl when cache hit low | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T09 Pareto rejects candidate with cacheHit degrade (over-truncation) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T09 assertCutBoundaryRespected throws on tool_result cut | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T09 fallback chain = drop oldest tool_results only | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T10 evolve enlarges maxBytes for high-reread tool | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T10 assertLimits throws when maxBytes < 1KB | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T10 assertLimits throws when timeout < 1s | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T10 assertErrorOutputNotHead throws on error class + head | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T10 assertDestructiveHumanGated throws on bash auto-evolved | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T10 Pareto: token↓ + success持平 + reread↓ → 入选 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T11 generateCandidates produces pending-approval patches | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T11 assertHumanApproval throws on unapproved patch | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T11 assertDecontaminated throws on canary reverse-degrade | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T11 patch reversing scope order (user overrides project) rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T11 approved + decontaminated → commit writes CLAUDE.md + staging suffix | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12a load returns ordered rule set | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12a assertSilenceNotApprove treats exit0+no-stdout as fall-through | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12a assertSilenceNotApprove throws when silence treated as approve | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12a assertBreaker throws on bash deny→allow | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12a assertBreaker throws on write deny→allow | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12a assertBreaker allows ask→deny (tightening) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12b generateHookCandidates passes breaker precheck | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12b select passes candidate with attack↓ ∧ false-deny↓ | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12b select rejects candidate trading utility for safety (false-deny↑) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12b select rejects candidate trading safety for utility (attack↑) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T12b agent runtime write to hooks/policy.yaml → EPERM | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T13 evolve narrows pause scope when false-pause high | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T13 assertDuplicateSideEffectZero throws when count > 0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T13 assertDuplicateSideEffectZero passes when count == 0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T13 assertBreaker throws on loosening unsent_tool_call_ids tracking | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T13 select rejects candidate with false-pause↓ but duplicate>0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T14 load returns template + scaling | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T14 assertRequiredFieldsIntact throws when acceptance field missing | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T14 assertRequiredFieldsIntact passes when all required fields present | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T14 evolve patches wording but keeps required field names | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T14 evolve throws when mutator shares session with orchestrator | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T14 strict-improvement: acceptance↑ ∧ reDispatch↓ → 入选 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T15 route returns fresh for review-type task | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T15 assertFreshNoParentHistory throws when fresh loads parent history | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T15 assertForkFullHistory throws when fork copies partial | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T15 evolve improves acceptanceInBudget ∧ redoRate | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T15 evolve summarized template adds field with redoRate↓ | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T16 evolve changes overwrite→dedup_by_id on parallel-write signal | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T16 assertLuaSandboxed throws on os.execute | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T16 assertLuaSandboxed throws on io.open | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T16 assertPartitionDisjoint throws on overlap | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T16 strict-improvement: consistency↑ ∧ disjoint↑ → 入选 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T17 evolve improves misroute ∧ authFailure | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T17 assertAuthFieldHumanGated throws on unsigned auth field change | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T17 assertAuthFieldHumanGated passes on signed change | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T17 assertOnHandoffInvariant throws when on_handoff executes after transfer | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T17 evolve adds non-auth field with misroute↓ allowed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T18 evolve improves adoption ∧ falseReject | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T18 assertKillPauseHumanGated throws on unsigned KILL widen | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T18 assertKillPauseHumanGated passes on signed widen | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T18 assertCheckpointOnly throws on mid-stream injection | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T18 evolve adds HINT permission (non-KILL/PAUSE) allowed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T19 evolve adjusts action on misclassified failure | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T19 assertIdempotencyZero throws when count > 0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T19 assertIdempotencyZero passes when count == 0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T19 assertCheckpointAtSuperStep throws on node-internal checkpoint | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T19 strict-improvement: acceptance↑ ∧ idempotency==0 → 入选 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T20 route returns vote for reasoning task | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T20 martingaleAblation reports voteGain ≥ debateGain | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T20 assertVoteIndependent throws on shared solver state | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T20 assertDebateSparse throws on full topology | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T20 evolve rejects max_rounds increase with no martingale gain | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T20 Pareto: acceptance↑ ∧ tokenCost not significantly↑ → 入选 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T21 rank returns resources sorted by weights | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T21 evolveRanker Pareto: success↑ ∧ token↓ ∧ reference↑ → 入选 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T21 assertAudienceUserNotInjectedToModel throws on audience:[user] injected to model | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T21 assertDestructivePromptHumanGated throws on unsigned execute prompt | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T21 assertDestructivePromptHumanGated passes on signed prompt | ✅ | ✅ | ✅ | ✅ | ✅ |
| L1-T21 evolvePromptTemplate improves userTaskSuccess | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 brain never holds real credential Observation.content does not contain the real secret after execute(printenv TOKEN) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 brain never holds real credential brain process.env never contains the real secret | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 brain never holds real credential env passed to hands runner does not contain the real secret | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 brain never holds real credential hands runner is only invoked through brain.execute (not via getEvents/wake) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 brain never holds real credential returns Observation.error="hands_unavailable" when hands runner crashes | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 session log rejects rewrite append adds entries and read returns them in insertion order | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 session log rejects rewrite rewrite throws (append-only enforced) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 session log rejects rewrite update throws (append-only enforced) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 session log rejects rewrite delete throws (append-only enforced) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 session log rejects rewrite truncate throws (append-only enforced) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 session log rejects rewrite append after a rejected rewrite still preserves prior entries (no partial mutation) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 wake does not re-execute tools re-issuing the same tool_use_ids after wake does not re-execute (duplicate side-effect count = 0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 wake does not re-execute tools wake re-executes only brand-new tool_use_ids (positive control) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T01 wake does not re-execute tools duplicate tool_use_id within a single session is not re-executed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T02 sandbox denies non-allowlist egress | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T02 正常路径: runVerify('echo hi') exits 0 and captures stdout | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T02 sandbox denies reading ~/.ssh | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T02 no backend => skip+warn | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 denyRead ~/.ssh blocks read | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 denyRead ~/.aws blocks read of aws creds | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 allowRead workspace cwd permits read inside workspace | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 denyRead blocks write-attempt on ssh path too (write implies read) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 narrower allowWrite reopens wider denyWrite | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 wider denyWrite still blocks sibling outside narrower allow | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 exact narrower boundary path is allowed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 narrower allowRead reopens wider denyRead | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 symlink to denied path is resolved and blocked | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 absolute symlink to denied absolute path is resolved and blocked | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 symlink to allowed workspace path is not blocked | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 write limited to worktree cwd subtree | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T03 createWorktree returns a detached worktree on the given baseCommit | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04a subdomain suffix match | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04a exact does not match subdomain | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04a non-listed domain denied with reason | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04a allowed domain resolving to denyOut IP is blocked | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04a non-allowlist domain connection refused | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04a egress log records allowlist hit | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04b egress to non-injectHost never contains real secret | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04b env strip replaces real secret with sentinel | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04b injectHosts not subset of allowedDomains throws | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04b injectHosts subset of allowedDomains passes invariants | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04b non-injectHost egress redacts real secret in headers and body | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04b sigV4Sign produces AWS4 HMAC-SHA256 authorization header | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T04b SigV4 resign on injectHost | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T05 canary exfil to non-injectHost detected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T05 canary to injectHost not counted as leak | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T05 clean run leaks zero canary | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T06 concurrency limit enforced | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T06 orphan list detects leftover worktree+process | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T06 teardown runs even if fn throws | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T06 hard timeout kills sandbox process | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T07 tighten allowed, relax rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T07 relaxing a deny is rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T07 equal profiles are neither tightened nor relaxed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T07 profile dir self-denied | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T07 tampered profile rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T08 allow new domain without signoff rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T08 allow new domain with untrusted signer rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T08 allow new domain with valid signoff accepted | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T08 deny tighten allowed without signoff | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T08 denyOut tighten allowed without signoff | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T09 prompt change relaxing destructive→allow rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T09 breaker accepts non-regressing prompt change | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T09 swap A/B yields consistent verdict | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T09 known-safe/known-destructive/known-exfil classified correctly | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T09 evaluateOnSafetySuite reports perfect F1 on known labels | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T10 run produces reviewable diff | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T10 archive not delete enforced | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T10 tighter stale policy reduces orphan count | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T11 canary leak rejects policy | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T11 new injectHost needs signoff + ⊆ allowedDomains | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T11 sensitive env pattern add auto-allowed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T11 redactRules tighten auto-allowed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T12 execute returns string contract enforced | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T12 capability + security both pass | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T12 replacement without signoff rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T12 impl allowing escape rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T13 empty-response passes not counted | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T13 all non-empty real passes pass audit | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T13 canary payload tampering rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T13 acceptance↑ + C↓ allowed; reverse rejected | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T14 /etc/passwd blocked | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T14 169.254.169.254 blocked | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T14 ~/.ssh read blocked | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T14 all payloads blocked, zero escape | ✅ | ✅ | ✅ | ✅ | ✅ |
| L0S-T14 permissive backend surfaces escaped payload (suite reads backend) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T01 routeOptimizer('prompt') returns a non-null Optimizer instance (stub OK, assert interface shape) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T01 routeOptimizer('weight') returns null (weight channel default off invariant) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T01 routeOptimizer('workflow') throws NotImplemented (V2 placeholder, MVP unsupported) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T01 STATIC_CORE_PATHS mirrors L0C-T11 STATIC_CORE_DIRS (shared constant, not redefined) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T01 runEvolutionLoop entry: static-core writable → throws BreakerError + securityEvents length=1 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T01 runEvolutionLoop entry: assertReadonly invoked with STATIC_CORE_PATHS | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T01 weight channel stays off across repeated calls (no public toggle exists; route table immutable) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T02 generate returns ≤ beamWidth candidates (seed=42 → exactly 3) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T02 selectTopK keeps fitness top-3; ties broken by diversity (content diff) — id order fixed by seed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T02 beamWidth=3 but optimizer LLM produces only 2 candidates → returns 2 (no padding) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T02 FakeEvaluator throwing on a candidate → that candidate skipped, loop does not crash | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T02 heldout fitness passed into selectTopK → throws SelectionSignalViolation (heldout must not feed generate, contract §2) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T02 convergence: seed fixed → 3 consecutive generations, best.resolve_rate monotonically non-decreasing | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T03 FakeLLM returns fixed JSON → mutate produces Mutant with origin='reflective' + parentSha=substrate.sha | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T03 input trajectory with luckyPass=true → throws LuckyPassTrajectoryRejected (defence-in-depth) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T03 empty failures → returns [] (no reflection source) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T03 FakeLLM returns non-JSON → throws MalformedMutation | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T03 mutated content differs from original content (editDistance > 0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T04 improvement → accept (resolve_rate up, token same, cache_hit same, τ=0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T04 regression → reject + regressions=['resolve_rate'] (resolve_rate down 0.05 ≥ τ=0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T04 multi-objective: one dim improves, another regresses → reject (any regression rejects) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T04 token direction flipped (lower=better): candidate.token down → accept; up → reject | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T04 cache_hit direction NOT flipped (higher=better, same as resolve_rate): up → accept; down → reject + regressions=['cache_hit'] | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T04 τ=0.02, regression 0.01 < τ → accept (threshold boundary) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T04 τ unspecified for a dim → default τ=0 (boundary: missing config) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T04 candidate fitness missing a field (raw incomplete) → throws IncompleteFitness | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T05 mutually non-dominating points → all returned | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T05 one point strictly better in all dims → other excluded | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T05 token direction flipped correctly (low token not dominated by high token) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T05 weightedSum call → throws WeightedSumForbidden (invariant, PRD §6.7) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T05 3+ dims all equal points → all kept (boundary: tied non-dominated) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T05 empty input → [] | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T05 source file contains no weightedSum identifier (grep invariant) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T05 fixed-seed FakeEvaluator produces 3 candidates → front size fixed by seed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06a isInteresting: child non-strictly worse than parent (≥ one dim) → true | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06a isInteresting: child strictly worse in all dims → false (not interesting) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06a insert non-strictly-dominated child → archived; rollback(history sha) returns entry | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06a retire(sha) does not reduce size() (never-auto-delete invariant) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06a duplicate sha insert → throws DuplicateArchiveEntry | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06a queryNonDominated consistent with T05 Pareto front (reuse fixture) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06b reseed at period: each island kills worst-half; survivors reseed from best (seed-fixed ids) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06b reseed before period → no-op | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06b reseed does not reduce global size (never-auto-delete: killed → retired, not deleted) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06b MAP-Elites: insert better into occupied bin → old evicted (returned) and moved to retired | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T06b MAP-Elites: insert weaker into occupied bin → evicted=null (no replacement) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T07 new entry → importanceCount=2 (provable via downvote→1) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T07 downvote from 1 → count=0 + shouldRetire=true | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T07 retire does not delete entry (archive size invariant + status retired) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T07 evidenceCount < minEvidence(2) → shouldActivate=false (insufficient evidence) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T07 consecutive downvotes do not underflow (cap 0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T07 upvote increases count (returns new count) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T08 gate both pass → commit returns version='nameV2' + sha | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T08 gate.strictImprovement=false → commit returns null (no retain) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T08 bumpVersion: first bump → nameV2; existing suffix → next V | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T08 vector index latest(): unique newest version (nameV3 over nameV2) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T08 onRegressionSignal resolve_drop → revertExec called with 'git checkout <toSha>' + reverted=true | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T08 PII>0 signal → immediate revert (zero tolerance) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T08 optimizer attempts to mutate rollbackThreshold → breaker reject + securityEvent | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T08 regressing mutant → commit returns null + no new active archive entry | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T09 fromTelemetry: span {pass:true, usage:{output:100}, cache_read:80} → Fitness={resolve_rate:1, token:100, cache_hit:0.8} | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T09 fromTelemetry: span missing usage → throws IncompleteTelemetry | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T09 fromTelemetry: pass=false → resolve_rate=0 (failure path) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T09 runLoop: improver commits + enters archive; regressor rejected (§1 scenario one) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T09 runLoop: breaker scenario — optimizer writes static-core → reject + securityEvent (§1 scenario two) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T09 fitness generalisation error: raw skill pass@k semantics leak → FitnessGeneralizationError | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T10 full-population generate triggers reflective mutation per top-K candidate (mutate calls = K, not 1) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T10 fastNonDominatedSort: 6 points with 2 layers → rank 0 = non-dominated, rank 1 = dominated-by-rank0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T10 full-population first front size ≥ reduced beam front size (same seed, upgrade payoff) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T10 heldout fitness passed into fastNonDominatedSort → SelectionSignalViolation (inherited contract) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T10 weightedSum call → WeightedSumForbidden (invariant inherited from T05) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T11 surrogate.fit + predict: predicted mean correlates with true fitness (Pearson > 0.5, fixed seed) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T11 acquisition: high-variance candidate prioritised (exploration, seed-fixed id) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T11 heldout split samples passed to fit → TrainValLeak (heldout must not feed surrogate) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T11 factorize: 3 instruction × 3 demo → 9 crossed Mutants (origin='reflective', parentSha) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T11 train/val split non-overlapping (train ∩ val = ∅) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T11 workflow/weight substrate → NotImplementedError (prompt-only) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T12 backprop: 2 variables → each gets an independent gradient suggestion (FakeLLM routes by varId) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T12 applyGradients: produced Mutant rewrites both variables (editDistance > 0 each) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T12 luckyPass trajectory → LuckyPassTrajectoryRejected (inherited from T03) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T12 empty-gradient variable stays unchanged (LLM gave no suggestion for it) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T12 weight substrate → NotImplementedError (prompt/skill only) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T12 per-variable isolation: A's gradient does not change B's content | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T13 sampleArchive(k=3, seed fixed) returns 3 high-fitness + high-diversity entries (seed-fixed ids) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T13 proposeAgent: LLM writes a new DSL Mutant (origin='reflective', parentSha) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T13 DSL containing eval() → validate ok=false + violations contains eval flag | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T13 DSL containing network egress (fetch/https) → ok=false | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T13 DSL containing exec/spawn (subprocess) → ok=false | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T13 archived entry can be re-sampled in later generation (growing archive open-ended) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T13 archive.size() monotonically non-decreasing across N generations (keep-all) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T13 cold start (archive empty) → returns empty or zero-shot | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T13 DSL expressiveness: control flow (if/loop) + tool call parses to correct AST node types | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T14 select: UCT picks max( avg + cUCT*sqrt(ln(parentVisits)/visits) ) node (seed-fixed id) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T14 expand: LLM rewrites node wiring → ≥1 child Mutant (origin='reflective', editDistance > 0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T14 rollout: calls sandbox.runVerify (executes workflowScript) + evaluator.score | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T14 backprop: node.visits++ + totalFitness accumulates (experience per node) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T14 heldout fitness passed into select/expand feedback → SelectionSignalViolation (contract §2) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T14 non-workflow substrate → NotImplementedError | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T15 WEIGHT_CHANNEL_DEFAULT === 'off' (default-off invariant, PRD §6.1 N1) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T15 checkOpen: KL > KL_MAX(0.05) → open=false + reasons non-empty | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T15 checkOpen: oraclePassRate < ORACLE_PASS_MIN(0.9) → open=false | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T15 checkOpen: consolidationNonInferior=false → open=false | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T15 checkOpen: humanSigned=false → open=false (human gate) | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T15 checkOpen: all four preconditions satisfied → open=true | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T15 breaker: runtime off→on attempt (no human signature) → BreakerError + securityEvent | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-T15 spec deliverable specs/L3-T15-weight-channel-spec.md exists and pins the four thresholds | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-integration scenario one: regressing variant rejected by strict-improvement and not archived | ✅ | ✅ | ✅ | ✅ | ✅ |
| L3-integration scenario two: optimizer writes static-core path → reject + securityEvent | ✅ | ✅ | ✅ | ✅ | ✅ |
| REAL-T01 · RealLLMPort (mock child_process) spawns pi -p --model <m> and returns stdout | ❌ | ❌ | ❌ | ❌ | ❌ |
| REAL-T01 · RealLLMPort (mock child_process) passes multi-line prompt via stdin pipe (not argv) | ❌ | ❌ | ❌ | ❌ | ❌ |
| REAL-T01 · RealLLMPort (mock child_process) retries on non-zero exit then throws PiHeadlessError (maxRetries=2 → 3 calls) | ❌ | ❌ | ❌ | ❌ | ❌ |
| REAL-T01 · RealLLMPort (mock child_process) kills + throws PiHeadlessTimeout on timeout (no retry) | ❌ | ❌ | ❌ | ❌ | ❌ |
| REAL-T01 · RealLLMPort (mock child_process) strips ANSI escape codes from stdout | ❌ | ❌ | ❌ | ❌ | ❌ |
| REAL-T01 · RealLLMPort (mock child_process) throws PiHeadlessError on ENOENT without retry | ❌ | ❌ | ❌ | ❌ | ❌ |
| REAL-T01 · real pi -p smoke real pi -p roundtrip returns PONG | ❌ | ❌ | ❌ | ❌ | ❌ |
| L2-T01 loadSkill loads compliant skill | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T01 loadSkill rejects missing description | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T01 loadAll first-wins on name collision and warns | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T01 loadSkill rejects invalid name uppercase | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T01 loadSkill rejects name too long | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 view returns file content | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 create creates file and appends index | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 create refuses overwrite | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 str_replace rejects non-unique old_str | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 str_replace replaces unique match | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 create rejects path escape ../ | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 create rejects path escape %2e%2e | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 view rejects operating on /memories root | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 MEMORY.md cap 200 lines drops tail | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 MEMORY.md cap 25KB drops tail | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T02 delete moves to archive not physical delete | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03a writeReflexion persists note and provenance | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03a rejects content with credential path | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03a duplicate write creates new id not overwrite | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03b upvote increments contribution | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03b downvote decrements contribution | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03b shouldRetire true when contribution<=-τ and trials>=N_min | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03b shouldRetire false when trials<N_min | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03b shouldRetire false when contribution>-τ | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03b retire moves to archive not delete | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03b retired note recoverable from archive | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03b bounded cap C=50 evicts lowest contribution on overflow | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T03b CE-T10 selective forgetting signals retire candidate | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04a filters clusters size<2 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04a empty clusters returns empty | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04a redacts credentials in trajectories | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b ADD sets importance=2 status=shadow | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b ADD rejects evidenceCount<2 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b ADD rejects concrete path | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b ADD rejects credential | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b UPVOTE increments importance | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b DOWNVOTE decrements | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b DOWNVOTE to 0 archives not delete | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b activate rejects on held-out regression | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b activate succeeds on held-out improvement | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T04b archived insight recoverable | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T05 addTrajectory persists pass outcome | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T05 addTrajectory rejects fail outcome | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T05 addTrajectory redacts credentials | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T05 retrieveFewShot returns top-k by cosine | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T05 retrieveFewShot empty when no trajectories | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T05 low contribution retires to archive | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T05 retired trajectory recoverable | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T06 createFact reference persists | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T06 createFact user rejects without higher gate | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T06 createFact user accepts with 2 evidence | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T06 createFact user accepts with userConfirmed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T06 viewFact increments accessFreq | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T06 shouldEvict true after ttl | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T06 evict moves to archive | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T06 createFact rejects path escape | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T06 scheduleFreshContextReview enqueues without blocking createFact | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T07 addNote creates links via judge | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T07 link has reason provenance | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T07 judgeLink rejects missing reason | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T07 evolveNote snapshots old K/G/X to archive | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T07 evolved note recoverable | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T07 pruneLinks moves 0-hit note to archival not delete | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T08 replaceBlockValue writes and snapshots | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T08 replaceBlockValue rejects read_only | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T08 replaceBlockValue rejects exceeds limit | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T08 recallSearch returns snapshots | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T08 rollback restores old value | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T08 fresh-context review flags stale block | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09a measureTriggerAccuracy computes confusion | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09a promoteDescription accepts on improvement | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09a promoteDescription rejects on regression | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09a measureTriggerAccuracy empty held-out returns zeros | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09b addLLMAuthoredSkill defaults to staging | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09b promoteToActive accepts with held-out improvement and human sign | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09b promoteToActive rejects regression | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09b promoteToActive rejects without human sign | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09b breakerScan flags eval | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09b breakerScan flags exec | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09b breakerScan flags network | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T09b sandboxVerify blocks reading ~/.ssh | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T10 tick active to stale after 30d | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T10 tick stale to archived after 90d | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T10 tick skips pinned | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T10 tick skips cron-referenced | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T10 tick skips hub-installed | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T10 retireIfLowContribution rejects authoring prior | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T10 bounded cap C=50 evicts lowest | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T10 archived entry recoverable | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T11 commitOnSuccess accepts on exitCode=0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T11 commitOnSuccess rejects on exitCode=1 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T11 commitOnSuccess rejects without verdict | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T11 commit appends version suffix nameV2 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T11 index holds only latest version | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T11 rollback restores previous version | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T11 rollback rebuilds index | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T12 validateParams rejects C=0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T12 validateParams rejects negative C | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T12 validateParams accepts C=50 | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T12 validateParams rejects authoring prior retirement | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T12 collectDrift returns three metrics | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T13 monitor detects stagnation | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T13 monitor detects bloat | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T13 monitor detects erosion | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T13 isHealthy true on all normal | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T13 isHealthy false on overRetiredRate>5% | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T14 route feedback to hot | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T14 route episodic to background | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T14 shouldTriggerBackground on eventCount | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T14 background job idempotent on same key | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T14 hot-path failure falls back to background | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T15 trustGate rejects project skill without trust | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T15 trustGate accepts project skill with trust | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T15 trustGate warns on <100 installs | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T15 stripSecrets removes TOKEN env | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T15 stripSecrets removes SECRET/KEY/AUTH | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T15 stripSecrets preserves non-secret env | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T15 never-auto-install-project enforced | ✅ | ✅ | ✅ | ✅ | ✅ |
| L2-T15 breakerScan flags eval/exec/network | ✅ | ✅ | ✅ | ✅ | ✅ |
| XM-T01 e2e: full cycle produces committed mutant | ✅ | ✅ | ✅ | ✅ | ✅ |
| XM-T01 e2e: regression signal triggers revert and restores baseline | ✅ | ✅ | ✅ | ✅ | ✅ |
| XM-T01 e2e: all-rejected generation commits nothing | ✅ | ✅ | ✅ | ✅ | ✅ |
| XM-T01 g5-report: incomplete evidence throws IncompleteG5Evidence | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T01 parentUuid tree: root parentUuid=null; child 指向 parent | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T01 append-only: 文件已写节点 U 后续写不修改 U 行 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T01 crash recovery: loadSession 返回完整树 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T01 orphaned tool_use_id: tool_result 无配对 tool_use → verifyTree 报 orphans | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T01 subagent boundary: appendSubagentBoundary 创建 agentId 隔离节点 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T02 computeCost: 五子类型按价目表正确核算 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T02 computeCost: cache_read 折扣价 0.3 正确（防 total_tokens 漏折扣） | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T02 computeCost: 子类型为 0 时 cost=0 且不抛错（边界值 0 合法） | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T02 price_table: model 不存在 → PriceNotFoundError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T02 recordTurn: 拒 total_tokens 字段 → TotalTokensRejectedError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T02 attribution: subagent cost 不重复算到 parent | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T02 price_version: cost 落 price_version 字段 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T03 span name = '{operation} {model}' | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T03 required gen_ai.* attrs 齐全 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T03 usage 五子类型作 span attrs | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T03 full messages 作 structured event 非 attr | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T03 50 LLM call 父-子树完整无孤儿 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T03 subagent trace context 传播: conversation.id 一致 + agent.id 隔离 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T03 tool-exec span parentSpanId 正确且不带 gen_ai.* | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T03 缺 gen_ai.operation.name → MissingRequiredAttrError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T04 replay: 确定性 session exit code 复现 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T04 replay: 非确定 action 列入 nondeterministicActions | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T04 replay: setupScript 注入后确定性恢复 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T04 replay: transcript 损坏 → TranscriptCorruptError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T04 measureReproRate: 6/10 → rate 0.6 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T05 load 默认 config 成功 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T05 项目 scope 覆写 → ProjectScopeOverrideRejectedError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T05 PII 字段 full_env_vars → validate 报 piiFields | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T05 telemetry_schema_frozen=true → 改 config 抛 SchemaFrozenError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T05 truncate_bytes < 1024 → validate 报违规 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T05 applyToWriter: capture_thinking_blocks=false 跳过 thinking | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T05 applyToWriter: capture_thinking_blocks=true 保留 thinking | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T06 runaway: 连续 11 次 bash → runaway=true | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T06 runaway: 穿插 read 打断计数 → runaway=false | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T06 budget: 超 per_agent_budget → exceeded=true | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T06 budget: 未超 per_agent_budget → exceeded=false | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T06 agent 运行时改 budget → RewardTamperingError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T06 project scope 覆写 → reject | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T06 runaway: 连续恰好 threshold 次 bash 不触发（边界） | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T07 capture_message_events=true 落 event | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T07 capture_message_events=false 不落 event | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T07 redact: SSN → [REDACTED_SSN] | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T07 redact: API key sk-xxx → [REDACTED_API_KEY] | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T07 assertNoPII: 未脱敏 PII → PIILeakError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T07 project scope 覆写 → reject | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T07 message_sampling_rate=0.5 采样落 event 数 ≈ 50 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T08 clusterFailures: 5 个失败 → 2 cluster 正确分组 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T08 min_cluster_size=2: 单个失败进 outliers | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T08 k=auto: 自动选 k | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T08 embedding 不可用 → EmbeddingUnavailableError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T08 labelCluster: 返回 label_schema 内标签 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T09 select: 10 成功 trajectory → top-5 倾向低 token | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T09 select: 全失败 → 空数组 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T09 score: token 相同 taskType 不同 → 多样性高者得分高 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T09 缺 embedding → MissingEmbeddingError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T09 权重配置生效 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T10 exportEvalDataset: 3 成功 session → 3 records | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T10 judgeTrajectory: 返回 0-1 score + 落 gen_ai.evaluation.score span | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T10 失败 session 不进 dataset | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T10 ATIF record 缺 judgeScore → MissingJudgeScoreError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T10 transcript 损坏 → TranscriptCorruptError + 报告错误数 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T11 add: importance=2, evidenceCount=1, status=active | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T11 downvote 归 0 → archived 非 delete | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T11 evidenceCount<2 → activated=false | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T11 clean canary 反降分 → quarantine | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T11 C=50 满 → 淘汰最低 contribution 进 archive | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T11 delete API → NeverAutoDeleteError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T12 injectMetadata: langfuse.session.id/version/release 落每个 span | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T12 exportSpans: mock OTLP endpoint 接收成功 | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T12 endpoint 不可达 → OtlpExportError + 本地 fallback | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T12 含 PII spans → PIILeakError | ✅ | ✅ | ✅ | ✅ | ✅ |
| TL-T12 缺 apiKey → MissingAuthError | ✅ | ✅ | ✅ | ✅ | ✅ |
| OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) identifies flaky test (pass in some runs, fail in others); stable not flagged | ✅ | ✅ | ✅ | ✅ | ✅ |
| OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) no flake when all 5 runs identical → reports no flake detected | ✅ | ✅ | ✅ | ✅ | ✅ |
| OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) skipped tests are not flagged as flake (skip ≠ flake) | ✅ | ✅ | ✅ | ✅ | ✅ |
| OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) reports pass/fail matrix across runs (run-1..run-N columns) | ✅ | ✅ | ✅ | ✅ | ✅ |
| OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) single failure across 5 runs is still a flake (status varies) | ✅ | ✅ | ✅ | ✅ | ✅ |
| OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) malformed run json → skipped + warn, does not crash (exit 0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given 迁移完成，When 取 StopReason 导出，Then 它是 typebox Union schema 值 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given 迁移完成，When 取 StopDecision 导出，Then 它是 typebox Object schema 值 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given 合法 StopDecision，When Value.Check，Then 通过（exit 0 语义） | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given StopDecision 缺字段 / 类型错 / 多余字段，When Value.Check，Then reject | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given 合法 StopReason 字面量，When Value.Check(StopReason, v)，Then 通过；非法字面量 reject | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given 迁移完成，When 取 MemoryCommand 导出，Then 它是 typebox Union schema 值 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given 六命令各自合法 input，When Value.Check(MemoryCommand, v)，Then 全部通过 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given 非法 command / 缺字段 / 类型错 / 多余字段，When Value.Check，Then reject（与原 frozen 守卫同路径） | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given 迁移后 validateMemoryCommand 行为不变，When 跑原守卫，Then accept/reject 与 Value.Check 同源 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given str_replace 的 old_str 在 content 中出现 0 次或 ≥2 次，When assertStrReplaceUnique，Then reject（恰好 1 次 → 通过） | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T02 · mutate-invariant.sh 突变门（L0C-T02-orphan） Given 锁定 spec GREEN，When mutate-invariant.sh L0C-T02-orphan，Then helper exit 0（注入 fail + 恢复 pass） | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T02 · mutate-invariant.sh 突变门（L0C-T02-orphan） Given helper 跑完，When 比对锁定文件 sha256，Then 与运行前一致（不破坏锁定 = test-lock 未破） | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T02 · mutate-invariant.sh 突变门（L0C-T02-orphan） Given helper 幂等（连续两次），When 跑两次，Then 两次均 exit 0 且无 tmp 残留污染 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T02 · mutate-invariant.sh 突变门（L0C-T02-orphan） Given 未实现的 variant，When mutate-invariant.sh <unknown>，Then exit≠0（variant 表化：未知 variant 拒绝） | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T03 · bwrap 后端真实收紧旗标硬编码（static-core 收紧） Given bwrap 后端启动，When 构造 argv，Then 含 `--unshare-net` 且不含 Docker 旗标 `--cap-drop` | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T03 · bwrap 后端真实收紧旗标硬编码（static-core 收紧） Given 迁移完成，When 取 BWRAP_HARDENED_ARGS 导出，Then 它是 frozen 且只含真实 bwrap 旗标 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T03 · bwrap 后端真实收紧旗标硬编码（static-core 收紧） Given 默认 config（不放宽），When buildBwrapArgs()，Then argv 含 `--unshare-net` | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T03 · bwrap 后端真实收紧旗标硬编码（static-core 收紧） Given config 试图移除 `--unshare-net`（恶意/误改），When buildBwrapArgs({removeHardened:[...]}), Then throw StaticCoreTamperError | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T03 · Linux CI 非 root user 跑 L0S 测试 Given Linux CI workflow，When 检查 .github/workflows/，Then 存在至少一个 workflow 文件 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLN-T03 · Linux CI 非 root user 跑 L0S 测试 Given L0S 测试 job，When grep workflow，Then 以非 root user 执行（useradd + chown + su/runuser） | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gate G1 集成 smoke 沙箱域: 命令执行并返回 Observation（隔离执行可用） | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gate G1 集成 smoke 遥测域: transcript 与 usage 契约导出可用 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gate G1 集成 smoke 跨域契约: session log (L0C) 与 telemetry (TL) 类型域一致 | ✅ | ✅ | ✅ | ✅ | ✅ |
| OPS-T02 · metrics aggregation aggregates lift/retained/rejected/tokens/decision + summary.totalLift | ❌ | ❌ | ❌ | ❌ | ❌ |
| OPS-T02 · metrics aggregation empty reports → runs:[] + summary zero + exit 0 | ❌ | ❌ | ❌ | ❌ | ❌ |
| OPS-T02 · metrics aggregation reject report (no lift) → lift:null + decision:reject + excluded from totalLift | ❌ | ❌ | ❌ | ❌ | ❌ |
| OPS-T02 · metrics aggregation malformed report (no key fields) → skipped + warn, does not crash | ❌ | ❌ | ❌ | ❌ | ❌ |
| OPS-T02 · metrics aggregation emits reports/metrics-trend.md trend table | ❌ | ❌ | ❌ | ❌ | ❌ |
| ADP-T02 · PiHeadlessLLM (real fake-pi binary) spawns pi -p --model <m> and returns stdout | — | — | — | ❌ | ❌ |
| ADP-T02 · PiHeadlessLLM (real fake-pi binary) retries on non-zero exit then throws PiHeadlessError | — | — | — | ❌ | ❌ |
| ADP-T02 · PiHeadlessLLM (real fake-pi binary) kills + throws PiHeadlessTimeout on timeout (no retry) | — | — | — | ❌ | ❌ |
| ADP-T02 · PiAdapter GWT readSubstrate reads piHome prompts | — | — | — | ❌ | ❌ |
| ADP-T02 · PiAdapter GWT writeSubstrate lands in repoRoot staging, active untouched | — | — | — | ❌ | ❌ |
| ADP-T02 · PiAdapter GWT readTrajectories parses TL-T01 shaped JSONL into Trajectory[] | — | — | — | ❌ | ❌ |
| ADP-T02 · PiAdapter GWT readTrajectories skips malformed JSONL lines without throwing | — | — | — | ❌ | ❌ |
| ADP-T02 · PiAdapter GWT deploy bumps version + git commits + prints restart hint | — | — | — | ❌ | ❌ |
| ADP-T02 · PiAdapter GWT rollback git-checkouts to rollbackTo sha | — | — | — | ❌ | ❌ |
| ADP-T02 · PiAdapter GWT readSubstrate unknown piHome prompt throws SubstrateNotFoundError | — | — | — | ❌ | ❌ |
| ADP-T02 · real pi -p smoke real pi -p roundtrip returns non-empty | — | — | — | ❌ | ❌ |
| ADP-T03 · exam-lock isExamLockedPath matches tests/**/*.spec.ts only | — | — | — | ❌ | ❌ |
| ADP-T03 · exam-lock buildExamLockHook emits PreToolUse deny rules for Write/Edit/Bash on tests/ | — | — | — | ❌ | ❌ |
| ADP-T03 · ClaudeCodeAdapter GWT readSubstrate reads CLAUDE.md and SKILL.md | — | — | — | ❌ | ❌ |
| ADP-T03 · ClaudeCodeAdapter GWT writeSubstrate lands in staging, active untouched | — | — | — | ❌ | ❌ |
| ADP-T03 · ClaudeCodeAdapter GWT readTrajectories maps Claude Code JSONL to L3 Trajectory | — | — | — | ❌ | ❌ |
| ADP-T03 · ClaudeCodeAdapter GWT readTrajectories skips non-JSON lines | — | — | — | ❌ | ❌ |
| ADP-T03 · ClaudeCodeAdapter GWT llmPort is passthrough from opts | — | — | — | ❌ | ❌ |
| ADP-T03 · ClaudeCodeAdapter GWT deploy bumps version + git commits | — | — | — | ❌ | ❌ |
| ADP-T03 · ClaudeCodeAdapter GWT rollback restores to rollbackTo sha | — | — | — | ❌ | ❌ |
| ADP-T03 · ClaudeCodeAdapter GWT readSubstrate unknown id throws SubstrateNotFoundError | — | — | — | ❌ | ❌ |
| ADP-T01 · HarnessPort 契约钉子 HarnessPort 契约定义了 7 个必需成员（readSubstrate/writeSubstrate/readTrajectories/deploy/rollback/llmPort） | — | — | — | ✅ | ✅ |
| ADP-T01 · ReferenceAdapter GWT readSubstrate returns content + sha matching L1 fixture | — | — | — | ✅ | ✅ |
| ADP-T01 · ReferenceAdapter GWT writeSubstrate lands in staging without touching active | — | — | — | ✅ | ✅ |
| ADP-T01 · ReferenceAdapter GWT readTrajectories returns failed non-lucky-pass trajectories | — | — | — | ✅ | ✅ |
| ADP-T01 · ReferenceAdapter GWT deploy swaps active with version suffix + records rollbackTo | — | — | — | ✅ | ✅ |
| ADP-T01 · ReferenceAdapter GWT rollback restores active to rollbackTo sha byte-for-byte | — | — | — | ✅ | ✅ |
| ADP-T01 · ReferenceAdapter GWT writeSubstrate to static-core path throws (L3-T01 breaker) | — | — | — | ✅ | ✅ |
| ADP-T01 · ReferenceAdapter GWT readSubstrate unknown id throws SubstrateNotFoundError | — | — | — | ✅ | ✅ |
| ADP-T01 · ReferenceAdapter GWT deploy unknown stagingSha throws UnknownStagingError | — | — | — | ✅ | ✅ |

## flake 用例 (结果跨 run 不一致)

- L0C-T01 pnpm -r build succeeds for all 7 packages  (failed×4, passed×1)

## stable 用例 (结果跨 run 一致)

- ADP-T01 · HarnessPort 契约钉子 HarnessPort 契约定义了 7 个必需成员（readSubstrate/writeSubstrate/readTrajectories/deploy/rollback/llmPort）
- ADP-T01 · ReferenceAdapter GWT deploy swaps active with version suffix + records rollbackTo
- ADP-T01 · ReferenceAdapter GWT deploy unknown stagingSha throws UnknownStagingError
- ADP-T01 · ReferenceAdapter GWT readSubstrate returns content + sha matching L1 fixture
- ADP-T01 · ReferenceAdapter GWT readSubstrate unknown id throws SubstrateNotFoundError
- ADP-T01 · ReferenceAdapter GWT readTrajectories returns failed non-lucky-pass trajectories
- ADP-T01 · ReferenceAdapter GWT rollback restores active to rollbackTo sha byte-for-byte
- ADP-T01 · ReferenceAdapter GWT writeSubstrate lands in staging without touching active
- ADP-T01 · ReferenceAdapter GWT writeSubstrate to static-core path throws (L3-T01 breaker)
- ADP-T02 · PiAdapter GWT deploy bumps version + git commits + prints restart hint
- ADP-T02 · PiAdapter GWT readSubstrate reads piHome prompts
- ADP-T02 · PiAdapter GWT readSubstrate unknown piHome prompt throws SubstrateNotFoundError
- ADP-T02 · PiAdapter GWT readTrajectories parses TL-T01 shaped JSONL into Trajectory[]
- ADP-T02 · PiAdapter GWT readTrajectories skips malformed JSONL lines without throwing
- ADP-T02 · PiAdapter GWT rollback git-checkouts to rollbackTo sha
- ADP-T02 · PiAdapter GWT writeSubstrate lands in repoRoot staging, active untouched
- ADP-T02 · PiHeadlessLLM (real fake-pi binary) kills + throws PiHeadlessTimeout on timeout (no retry)
- ADP-T02 · PiHeadlessLLM (real fake-pi binary) retries on non-zero exit then throws PiHeadlessError
- ADP-T02 · PiHeadlessLLM (real fake-pi binary) spawns pi -p --model <m> and returns stdout
- ADP-T02 · real pi -p smoke real pi -p roundtrip returns non-empty
- ADP-T03 · ClaudeCodeAdapter GWT deploy bumps version + git commits
- ADP-T03 · ClaudeCodeAdapter GWT llmPort is passthrough from opts
- ADP-T03 · ClaudeCodeAdapter GWT readSubstrate reads CLAUDE.md and SKILL.md
- ADP-T03 · ClaudeCodeAdapter GWT readSubstrate unknown id throws SubstrateNotFoundError
- ADP-T03 · ClaudeCodeAdapter GWT readTrajectories maps Claude Code JSONL to L3 Trajectory
- ADP-T03 · ClaudeCodeAdapter GWT readTrajectories skips non-JSON lines
- ADP-T03 · ClaudeCodeAdapter GWT rollback restores to rollbackTo sha
- ADP-T03 · ClaudeCodeAdapter GWT writeSubstrate lands in staging, active untouched
- ADP-T03 · exam-lock buildExamLockHook emits PreToolUse deny rules for Write/Edit/Bash on tests/
- ADP-T03 · exam-lock isExamLockedPath matches tests/**/*.spec.ts only
- CE-T01a should keep agentVisible=false invariant
- CE-T01a should load >=30 decontaminated tasks
- CE-T01a should reject task whose repo structure appears in trainSet
- CE-T01b should add coverage tests and reject >=19.71% false positives
- CE-T01b should discard mutation case tainted by prompt injection
- CE-T01b should reject plausible-but-incorrect patch after strengthening
- CE-T01c should FAIL when agent visible
- CE-T01c should PASS when all T/O valid and coverage>=0.9
- CE-T01c should report BUDGET when coverage<0.9
- CE-T02 should never produce prose-only verdict on timeout
- CE-T02 should return exitCode 0 after FAIL-to-PASS fix
- CE-T02 should throw on cross-run stdout merge
- CE-T03 filterAndTag tags each entry with luckyPass and substrateSha
- CE-T03 should flag blind retry loop lucky pass
- CE-T03 should handle missing toolCalls gracefully
- CE-T03 should pass solid trajectory
- CE-T04 should throw on same model family
- CE-T04 should throw when nlSummary provided
- CE-T04 should use different model family and cap iterations at 5
- CE-T05 should calibrate accuracy against L0 verdicts
- CE-T05 should drop same-family judge from pool
- CE-T05 should mark inconsistent when sigma > gap
- CE-T05 should swap A/B and report sigma
- CE-T06 should auto-revert on resolveRate drop
- CE-T06 should promote when no degradation
- CE-T06 should reject runtime mutation of revert thresholds
- CE-T07 should abort on prose-only evidence
- CE-T07 should abort when no verifications
- CE-T07 should pass when exit-code evidence exists
- CE-T08 should report chi2/p/ci and scaffoldSha for n=30
- CE-T08 should report unresolvedBudget when n<30 and coverage<0.9
- CE-T08 should throw on incomplete pairs
- CE-T09 should flag no discrimination when delta below threshold
- CE-T09 should report positive delta with discrimination
- CE-T09 should warn when mag<brute
- CE-T10 should flag weak selective forgetting
- CE-T10 should report four competencies and saturation gap
- CE-T10 should throw when memory tool unavailable
- CE-T11 should expand to detect 5pp with coverage>=0.9
- CE-T11 should flag needsMoreTasks when underpowered
- CE-T11 should reject un-decontaminated new tasks
- CE-T12 should isolate variant that drops on clean canary
- CE-T12 should pass normal-improving variant
- CE-T12 should throw when clean canary unavailable
- CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given StopDecision 缺字段 / 类型错 / 多余字段，When Value.Check，Then reject
- CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given 合法 StopDecision，When Value.Check，Then 通过（exit 0 语义）
- CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given 合法 StopReason 字面量，When Value.Check(StopReason, v)，Then 通过；非法字面量 reject
- CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given 迁移完成，When 取 StopDecision 导出，Then 它是 typebox Object schema 值
- CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox Given 迁移完成，When 取 StopReason 导出，Then 它是 typebox Union schema 值
- CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given str_replace 的 old_str 在 content 中出现 0 次或 ≥2 次，When assertStrReplaceUnique，Then reject（恰好 1 次 → 通过）
- CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given 六命令各自合法 input，When Value.Check(MemoryCommand, v)，Then 全部通过
- CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given 迁移后 validateMemoryCommand 行为不变，When 跑原守卫，Then accept/reject 与 Value.Check 同源
- CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given 迁移完成，When 取 MemoryCommand 导出，Then 它是 typebox Union schema 值
- CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox Given 非法 command / 缺字段 / 类型错 / 多余字段，When Value.Check，Then reject（与原 frozen 守卫同路径）
- CLN-T02 · mutate-invariant.sh 突变门（L0C-T02-orphan） Given helper 幂等（连续两次），When 跑两次，Then 两次均 exit 0 且无 tmp 残留污染
- CLN-T02 · mutate-invariant.sh 突变门（L0C-T02-orphan） Given helper 跑完，When 比对锁定文件 sha256，Then 与运行前一致（不破坏锁定 = test-lock 未破）
- CLN-T02 · mutate-invariant.sh 突变门（L0C-T02-orphan） Given 未实现的 variant，When mutate-invariant.sh <unknown>，Then exit≠0（variant 表化：未知 variant 拒绝）
- CLN-T02 · mutate-invariant.sh 突变门（L0C-T02-orphan） Given 锁定 spec GREEN，When mutate-invariant.sh L0C-T02-orphan，Then helper exit 0（注入 fail + 恢复 pass）
- CLN-T03 · Linux CI 非 root user 跑 L0S 测试 Given L0S 测试 job，When grep workflow，Then 以非 root user 执行（useradd + chown + su/runuser）
- CLN-T03 · Linux CI 非 root user 跑 L0S 测试 Given Linux CI workflow，When 检查 .github/workflows/，Then 存在至少一个 workflow 文件
- CLN-T03 · bwrap 后端真实收紧旗标硬编码（static-core 收紧） Given bwrap 后端启动，When 构造 argv，Then 含 `--unshare-net` 且不含 Docker 旗标 `--cap-drop`
- CLN-T03 · bwrap 后端真实收紧旗标硬编码（static-core 收紧） Given config 试图移除 `--unshare-net`（恶意/误改），When buildBwrapArgs({removeHardened:[...]}), Then throw StaticCoreTamperError
- CLN-T03 · bwrap 后端真实收紧旗标硬编码（static-core 收紧） Given 迁移完成，When 取 BWRAP_HARDENED_ARGS 导出，Then 它是 frozen 且只含真实 bwrap 旗标
- CLN-T03 · bwrap 后端真实收紧旗标硬编码（static-core 收紧） Given 默认 config（不放宽），When buildBwrapArgs()，Then argv 含 `--unshare-net`
- Gate G1 集成 smoke 沙箱域: 命令执行并返回 Observation（隔离执行可用）
- Gate G1 集成 smoke 跨域契约: session log (L0C) 与 telemetry (TL) 类型域一致
- Gate G1 集成 smoke 遥测域: transcript 与 usage 契约导出可用
- L0C-T01 directory tree matches WBS §2 seven package names exactly
- L0C-T01 exports L0_CORE_VERSION === 0.1.0
- L0C-T01 monorepo has 7 packages
- L0C-T01 pnpm install produces lockfile with no peer warnings
- L0C-T01 tsconfig strict enabled
- L0C-T01 verify.sh dispatches TASK-ID
- L0C-T01 vitest exits 0 with passWithNoTests
- L0C-T02 flushes pending only at turn_end
- L0C-T02 normalizeContent accepts valid string content in tool_result
- L0C-T02 pairs tool_use_id round-trip
- L0C-T02 rejects mismatched tool_use_id with 400
- L0C-T02 rejects null content in tool_result
- L0C-T02 rejects null element inside tool_result content array
- L0C-T02 rejects orphan tool_result with 400
- L0C-T02 rejects out-of-order tool_result before its tool_use
- L0C-T02 turn_end requires id-matched tool_results
- L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler accepts valid output and passes it through
- L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler accepts valid output with incomplete=true and empty nextSteps
- L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back on null input
- L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back when incomplete is not a boolean
- L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back when nextSteps is not an array
- L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back when summary is missing
- L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 handler falls back when summary is not a string
- L0C-T03 applyMaxTurnsHandler — max_turns_handler 合成契约 max_turns handler falls back on invalid schema (missing incomplete field)
- L0C-T03 evaluateStop — 优先级判定（spec GREEN: end_turn → abort → unrecoverable_error → max_turns） abort takes priority over max_turns
- L0C-T03 evaluateStop — 优先级判定（spec GREEN: end_turn → abort → unrecoverable_error → max_turns） unrecoverable_error takes priority over max_turns
- L0C-T03 evaluateStop — 四层停止检测 abort layer triggers when abortSignal.aborted===true
- L0C-T03 evaluateStop — 四层停止检测 end_turn layer triggers on end_turn stop reason
- L0C-T03 evaluateStop — 四层停止检测 max_turns layer triggers when turnIndex exceeds maxTurns
- L0C-T03 evaluateStop — 四层停止检测 max_turns layer triggers when turnIndex reaches maxTurns (boundary: equal)
- L0C-T03 evaluateStop — 四层停止检测 unrecoverable_error layer triggers on retryExhausted + error
- L0C-T04 classifies 429 retryable, 400 not
- L0C-T04 dispose aborts even if hook throws
- L0C-T04 overflow guard single-shot lock
- L0C-T04 reset only on non-error non-length stop
- L0C-T04 resets retry counter on success
- L0C-T05 assertCutNotOrphan — 切点不得产生孤儿 tool_result cut at compaction entry throws: compaction 不是合法切点
- L0C-T05 assertCutNotOrphan — 切点不得产生孤儿 tool_result cut at tool_result throws orphan: 切点落在 tool_result 处 → throw
- L0C-T05 assertCutNotOrphan — 切点不得产生孤儿 tool_result cut at user/assistant boundary does not throw: 合法切点通过
- L0C-T05 assertStablePrefix — cache prefix exact-prefix 不变量 cache prefix change emits violation: oldHash !== newHash → emit CachePrefixViolation 事件（不 throw，10x 成本告警不变量）
- L0C-T05 assertStablePrefix — cache prefix exact-prefix 不变量 cache prefix unchanged passes: oldHash === newHash 不 emit violation
- L0C-T05 assertStablePrefix — cache prefix exact-prefix 不变量 cache prefix violation handler 可取消订阅（unsubscribe 后不再收到事件）
- L0C-T05 assertStablePrefixUntouched — compaction 切点不得落在 stable prefix 区域 cut after stable prefix passes: cutIndex >= prefixLen → 通过
- L0C-T05 assertStablePrefixUntouched — compaction 切点不得落在 stable prefix 区域 cut inside stable prefix throws: cutIndex < prefixLen → throw
- L0C-T05 constants DEFAULT_KEEP_RECENT === 20000 (L1 config 默认值锚点)
- L0C-T05 constants DEFAULT_RESERVE === 16384 (L1 config 默认值锚点)
- L0C-T05 constants STABLE_PREFIX_UNTOUCHABLE is true (prefix 不可被 compaction 触碰)
- L0C-T05 findValidCutPoints — 切点必须落在 user/assistant 消息边界 findValidCutPoints respects [start, end) slice: 只返回该范围内的合法切点
- L0C-T05 findValidCutPoints — 切点必须落在 user/assistant 消息边界 valid cut points exclude compaction entries: compaction entry 不可作切点
- L0C-T05 findValidCutPoints — 切点必须落在 user/assistant 消息边界 valid cut points exclude tool_result: [user, assistant(tool_use), tool_result, user] → [0,1,3]
- L0C-T06 assertCanonicalPath canonical path rejects URL-encoded traversal `%2e%2e`
- L0C-T06 assertCanonicalPath canonical path rejects operating on the `/memories` root itself
- L0C-T06 assertCanonicalPath canonical path rejects path entirely outside the memory root
- L0C-T06 assertCanonicalPath canonical path rejects traversal `../` (越界)
- L0C-T06 assertCanonicalPath passes for a legal nested memory path
- L0C-T06 assertCanonicalPath passes for a single-segment memory path
- L0C-T06 assertCreateNoOverwrite create rejects overwrite (exists=true) — 拒覆写
- L0C-T06 assertCreateNoOverwrite passes when target does not exist (exists=false)
- L0C-T06 assertStrReplaceUnique passes when old_str appears exactly once in content
- L0C-T06 assertStrReplaceUnique rejects when old_str does not occur at all (nothing to replace)
- L0C-T06 assertStrReplaceUnique str_replace rejects non-unique old_str (appears 2 times) — 不静默改错处
- L0C-T06 progressive disclosure L1 metadata containing any other extra field is rejected
- L0C-T06 progressive disclosure L1 metadata containing extra `body` field is rejected (防 Level 2 内容泄漏进 Level 1 常驻区)
- L0C-T06 progressive disclosure L1 metadata only allows name+description (assertLevel1Only passes)
- L0C-T06 progressive disclosure PROGRESSIVE_LEVELS exposes the 3 ordered levels L1->L2->L3
- L0C-T06 validateMemoryCommand — six commands rejects create missing required `content`
- L0C-T06 validateMemoryCommand — six commands rejects extra fields via strict schema (view command with stray `content`)
- L0C-T06 validateMemoryCommand — six commands rejects insert missing required `insert_line`/`content`
- L0C-T06 validateMemoryCommand — six commands rejects non-object input
- L0C-T06 validateMemoryCommand — six commands rejects rename missing required `new_path`
- L0C-T06 validateMemoryCommand — six commands rejects str_replace missing required `old_str`/`new_str`
- L0C-T06 validateMemoryCommand — six commands rejects unknown command
- L0C-T06 validateMemoryCommand — six commands valid `view /memories/foo` input returns {ok:true, command:'view'}
- L0C-T06 validateMemoryCommand — six commands validates six commands (view/create/str_replace/insert/delete/rename each one valid case)
- L0C-T06 validateMemoryCommand — six commands view with optional path omitted is still valid (path is Optional)
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 rejects version mismatch deserializeRunState accepts the current version unchanged
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 rejects version mismatch deserializeRunState throws on malformed JSON
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 rejects version mismatch deserializeRunState throws when version does not match (schema drift guard)
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 resume does not resend terminal tool calls assertNoResentToolCalls passes when terminal tool calls are NOT re-executed (execution count = 0)
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 resume does not resend terminal tool calls assertNoResentToolCalls throws when a terminal tool_use is in the executed set (hard constraint)
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 resume does not resend terminal tool calls resume keeps execution count of terminal tool calls at 0 (hard constraint invariant)
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 round-trips unsent_tool_call_ids round-trips unsent_tool_call_ids through serialize/deserialize
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 terminal requires persisted first markTerminalAfterPersist marks terminal=true only after persisted=true
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 terminal requires persisted first markTerminalAfterPersist throws on unknown toolUseId
- L0C-T07a: RunState schema + turn items 持久化先于 terminal 标记 terminal requires persisted first markTerminalAfterPersist throws when persisted=false (must persist first)
- L0C-T07b SessionLog append-only contract append makes has return true
- L0C-T07b SessionLog append-only contract append-only rejects rewrite
- L0C-T07b SessionLog append-only contract parentUuid branch traceable
- L0C-T07b WriteDeltaJournal journal rejects conflicting key
- L0C-T07b WriteDeltaJournal journal replays in completion order
- L0C-T07b wake rehydration wake rehydrates equivalent state
- L0C-T08 STATIC_CORE_FIELD_REGISTRY registers the protected static-core fields including unsent_tool_call_ids_for_interrupted_state
- L0C-T08 STATIC_CORE_FIELD_REGISTRY registry is readonly (frozen) — 删 registry 项本身也属 violation 基础
- L0C-T08 acceptance_threshold tightening (0.8 → 0.9) is NOT a violation (调严放行)
- L0C-T08 acceptance_threshold_widened: diff changing acceptance_threshold 0.8 → 0.6 (放宽) → violations=['acceptance_threshold_widened']
- L0C-T08 aggregates multiple violation kinds in a single diff
- L0C-T08 allows a diff that only adds new non-protected lines
- L0C-T08 allows legitimate prompt edit (改 prompt 文案不改字段/阈值方向)
- L0C-T08 deny_to_allow: diff changing `bash: deny` → `bash: allow` → violations=['deny_to_allow']
- L0C-T08 deny_to_allow: diff changing `write: deny` → `write: allow` → violations=['deny_to_allow']
- L0C-T08 every violation kind is a valid DangerousDiffKind literal
- L0C-T08 installPreCommitHook installPreCommitHook is idempotent (re-install does not throw)
- L0C-T08 installPreCommitHook installPreCommitHook writes executable hook to .git/hooks/pre-commit
- L0C-T08 installPreCommitHook installed hook file content references the pre-commit check (not empty)
- L0C-T08 resource_control_model_realloc: diff changing resources control-model false → true → violations=['resource_control_model_realloc']
- L0C-T08 returns a well-formed PreCommitVerdict for a clean diff
- L0C-T08 safety_segment_deleted: diff deleting a `<safety>` line → allow=false, violations=['safety_segment_deleted']
- L0C-T08 static_core_field_removed: deleting a non-registered field is NOT flagged
- L0C-T08 static_core_field_removed: diff deleting `unsent_tool_call_ids` field definition (field in registry) → violations=['static_core_field_removed']
- L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） mid_turn flush 被拒（防孤儿 tool_use_id）
- L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） mid_turn 插入点被拒：assistant 含 tool_use 且 tool_result 未到达 → isLegalInsertionPoint('mid_turn')===false
- L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） turn_end flush 成功（destructive 清空，不抛）
- L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） turn_end 插入点合法：全部 tool_result 已到达 → isLegalInsertionPoint('turn_end')===true
- L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） 完整 transcript 中任一非 turn_end 点插入均被拒（端到端不变量）
- L0C-T09a turn 边界（context-only 消息唯一合法插入点 = turn_end） 纯文本 assistant（无 tool_use）= turn_end：合法插入点
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-0 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-1 — 孤儿 → throw OrphanToolResultError(400)
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-10 — 孤儿 → throw OrphanToolResultError(400)
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-11 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-12 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-13 — 孤儿 → throw OrphanToolResultError(400)
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-14 — 孤儿 → throw OrphanToolResultError(400)
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-15 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-16 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-17 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-18 — 孤儿 → throw OrphanToolResultError(400)
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-19 — 孤儿 → throw OrphanToolResultError(400)
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-2 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-3 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-4 — 孤儿 → throw OrphanToolResultError(400)
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-5 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-6 — 孤儿 → throw OrphanToolResultError(400)
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-7 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-8 — 合法 → 通过
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） transcript t-42-9 — 孤儿 → throw OrphanToolResultError(400)
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） 双例都覆盖：20 条中既有孤儿又有合法（fixture 完备性）
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） 重复 tool_result 同 id 视为 mismatch → throw 400
- L0C-T09a 孤儿 tool_result 400（assertToolUsePaired 双例覆盖） 重复 tool_use id 视为 mismatch → throw 400
- L0C-T09b C>0 下限（Ratchet bounded cap） C=-5 → assertCBound throw（负值非法）
- L0C-T09b C>0 下限（Ratchet bounded cap） C=0 → assertCBound throw（关掉有界容量 = 库崩塌）
- L0C-T09b C>0 下限（Ratchet bounded cap） C=1 → assertCBound 通过（下限边界）
- L0C-T09b C>0 下限（Ratchet bounded cap） C=50 → assertCBound 通过（有界容量）
- L0C-T09b C>0 下限（Ratchet bounded cap） assertCBound 已由 L0C 导出
- L0C-T09b authoring prior 存在 + 不可退役 assertAuthoringPriorExists 已由 L0C 导出
- L0C-T09b authoring prior 存在 + 不可退役 authoring prior 被标记为 retireable=true → throw（不可退役）
- L0C-T09b authoring prior 存在 + 不可退役 library 不含 authoring prior → throw（移除损 43% gain）
- L0C-T09b authoring prior 存在 + 不可退役 library 含 authoring prior 且不可退役 → assertAuthoringPriorExists 通过
- L0C-T09b never-auto-delete（archive 非 delete） archive 路径存在 → assertArchiveNotDeleted 通过（保留即恢复可能）
- L0C-T09b never-auto-delete（archive 非 delete） archive 路径被物理删除 → assertArchiveNotDeleted throw（不可逆）
- L0C-T09b never-auto-delete（archive 非 delete） assertArchiveNotDeleted 已由 L0C 导出
- L0C-T09b unsent_tool_call_ids 跟踪（与 T07a 互补） round-trip 不丢失 unsent_tool_call_ids（中断恢复跟踪字段）
- L0C-T09b unsent_tool_call_ids 跟踪（与 T07a 互补） 多元素 unsent_tool_call_ids round-trip 保序
- L0C-T09b unsent_tool_call_ids 跟踪（与 T07a 互补） 空 unsent_tool_call_ids 也能 round-trip（无未回填时不丢失空集）
- L0C-T09b 切点=消息边界（findValidCutPoints 只返回 user/assistant） 100 条随机 entries → 所有返回 index 处 type ∈ {user, assistant}
- L0C-T09b 切点=消息边界（findValidCutPoints 只返回 user/assistant） compaction 条目永不可为切点
- L0C-T09b 切点=消息边界（findValidCutPoints 只返回 user/assistant） 切点不含 tool_result（防孤儿 tool_result）
- L0C-T10 BREAKER_CLAUSES 已由 L0C 导出且为数组
- L0C-T10 BREAKER_CLAUSES 覆盖全部五类 DangerousDiffKind（杜绝命名漂移）
- L0C-T10 allows legitimate diff
- L0C-T10 evaluate 已由 L0C 导出为 function
- L0C-T10 fail-closed when sessionLog throws
- L0C-T10 flags unsent tracking removal as critical static_core_field_removed
- L0C-T10 ordinary static_core_field_removed 也是 critical（默认映射）
- L0C-T10 rejects acceptance_threshold_widened (warn)
- L0C-T10 rejects deny_to_allow and logs security event
- L0C-T10 rejects resource_control_model_realloc (critical)
- L0C-T10 rejects safety_segment_deleted and logs security event (critical)
- L0C-T10 rejects self-modification of BREAKER_CLAUSES
- L0C-T11 STATIC_CORE_DIRS registers the three protected static-core subtrees
- L0C-T11 assertWritable EPERM on canary content write
- L0C-T11 assertWritable EPERM on canary verifier write
- L0C-T11 assertWritable EPERM on static-core write
- L0C-T11 assertWritable allows L1 write
- L0C-T11 assertWritable rejects prefix-collision attack
- L0C-T11 assertWritable resolves traversal
- L0C-T11 assertWritable traversal into static-core still blocked after resolve
- L0C-T11 enforceReadOnly blocks wrapped writePath targeting a static-core path with EPERM
- L0C-T11 enforceReadOnly passes through wrapped writePath for an L1 path
- L0C-T11 isStaticCorePath returns false for a prefix-collision sibling (l0-core-evil)
- L0C-T11 isStaticCorePath returns false for an L1 evolvable substrate path
- L0C-T11 isStaticCorePath returns true for a file inside packages/l0-core
- L0C-T11 isStaticCorePath returns true for a file inside the canary content subtree
- L0C-T11 isStaticCorePath returns true for a file inside the canary verifier subtree
- L0C-T11 isStaticCorePath returns true for the l0-core package root itself
- L0C-T12 0 of 20 redteam cases succeed (static-core compromise = 0)
- L0C-T12 fixture contains exactly 20 redteam cases
- L0C-T12 fixture covers all 10 categories × 2 cases each
- L0C-T12 fixture ids are unique
- L0C-T12 redteam RT-01 (safety_segment_deleted) → rejected by at least one guard layer
- L0C-T12 redteam RT-01 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-02 (safety_segment_deleted) → rejected by at least one guard layer
- L0C-T12 redteam RT-02 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-03 (deny_to_allow) → rejected by at least one guard layer
- L0C-T12 redteam RT-03 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-04 (deny_to_allow) → rejected by at least one guard layer
- L0C-T12 redteam RT-04 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-05 (acceptance_threshold_widened) → rejected by at least one guard layer
- L0C-T12 redteam RT-05 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-06 (acceptance_threshold_widened) → rejected by at least one guard layer
- L0C-T12 redteam RT-06 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-07 (static_core_field_removed) → rejected by at least one guard layer
- L0C-T12 redteam RT-07 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-08 (static_core_field_removed) → rejected by at least one guard layer
- L0C-T12 redteam RT-08 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-09 (resource_control_model_realloc) → rejected by at least one guard layer
- L0C-T12 redteam RT-09 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-10 (resource_control_model_realloc) → rejected by at least one guard layer
- L0C-T12 redteam RT-10 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-11 (breaker_self_modification) → rejected by at least one guard layer
- L0C-T12 redteam RT-11 → expected layer (breaker) rejects
- L0C-T12 redteam RT-12 (breaker_self_modification) → rejected by at least one guard layer
- L0C-T12 redteam RT-12 → expected layer (breaker) rejects
- L0C-T12 redteam RT-13 (read_only_write) → rejected by at least one guard layer
- L0C-T12 redteam RT-13 → expected layer (read-only) rejects
- L0C-T12 redteam RT-14 (read_only_write) → rejected by at least one guard layer
- L0C-T12 redteam RT-14 → expected layer (read-only) rejects
- L0C-T12 redteam RT-15 (read_only_canary) → rejected by at least one guard layer
- L0C-T12 redteam RT-15 → expected layer (read-only) rejects
- L0C-T12 redteam RT-16 (read_only_canary) → rejected by at least one guard layer
- L0C-T12 redteam RT-16 → expected layer (read-only) rejects
- L0C-T12 redteam RT-17 (read_only_verifier) → rejected by at least one guard layer
- L0C-T12 redteam RT-17 → expected layer (read-only) rejects
- L0C-T12 redteam RT-18 (read_only_verifier) → rejected by at least one guard layer
- L0C-T12 redteam RT-18 → expected layer (read-only) rejects
- L0C-T12 redteam RT-19 (static_core_field_removed) → rejected by at least one guard layer
- L0C-T12 redteam RT-19 → expected layer (pre-commit) rejects
- L0C-T12 redteam RT-20 (static_core_field_removed) → rejected by at least one guard layer
- L0C-T12 redteam RT-20 → expected layer (pre-commit) rejects
- L0C-T12 redteam report format: succeeded count / total → 0/20
- L0C-T12 三层守卫函数均已由 L0C 导出
- L0C-T12 夹带攻击：合法 prompt 改写里夹删 <safety> 行 → 被 safety_segment_deleted 检出
- L0C-T12 夹带攻击：合法 threshold edit 里夹 deny→allow → 被 deny_to_allow 检出
- L0S-T01 brain never holds real credential Observation.content does not contain the real secret after execute(printenv TOKEN)
- L0S-T01 brain never holds real credential brain process.env never contains the real secret
- L0S-T01 brain never holds real credential env passed to hands runner does not contain the real secret
- L0S-T01 brain never holds real credential hands runner is only invoked through brain.execute (not via getEvents/wake)
- L0S-T01 brain never holds real credential returns Observation.error="hands_unavailable" when hands runner crashes
- L0S-T01 session log rejects rewrite append adds entries and read returns them in insertion order
- L0S-T01 session log rejects rewrite append after a rejected rewrite still preserves prior entries (no partial mutation)
- L0S-T01 session log rejects rewrite delete throws (append-only enforced)
- L0S-T01 session log rejects rewrite rewrite throws (append-only enforced)
- L0S-T01 session log rejects rewrite truncate throws (append-only enforced)
- L0S-T01 session log rejects rewrite update throws (append-only enforced)
- L0S-T01 wake does not re-execute tools duplicate tool_use_id within a single session is not re-executed
- L0S-T01 wake does not re-execute tools re-issuing the same tool_use_ids after wake does not re-execute (duplicate side-effect count = 0)
- L0S-T01 wake does not re-execute tools wake re-executes only brand-new tool_use_ids (positive control)
- L0S-T02 no backend => skip+warn
- L0S-T02 sandbox denies non-allowlist egress
- L0S-T02 sandbox denies reading ~/.ssh
- L0S-T02 正常路径: runVerify('echo hi') exits 0 and captures stdout
- L0S-T03 absolute symlink to denied absolute path is resolved and blocked
- L0S-T03 allowRead workspace cwd permits read inside workspace
- L0S-T03 createWorktree returns a detached worktree on the given baseCommit
- L0S-T03 denyRead blocks write-attempt on ssh path too (write implies read)
- L0S-T03 denyRead ~/.aws blocks read of aws creds
- L0S-T03 denyRead ~/.ssh blocks read
- L0S-T03 exact narrower boundary path is allowed
- L0S-T03 narrower allowRead reopens wider denyRead
- L0S-T03 narrower allowWrite reopens wider denyWrite
- L0S-T03 symlink to allowed workspace path is not blocked
- L0S-T03 symlink to denied path is resolved and blocked
- L0S-T03 wider denyWrite still blocks sibling outside narrower allow
- L0S-T03 write limited to worktree cwd subtree
- L0S-T04a allowed domain resolving to denyOut IP is blocked
- L0S-T04a egress log records allowlist hit
- L0S-T04a exact does not match subdomain
- L0S-T04a non-allowlist domain connection refused
- L0S-T04a non-listed domain denied with reason
- L0S-T04a subdomain suffix match
- L0S-T04b SigV4 resign on injectHost
- L0S-T04b egress to non-injectHost never contains real secret
- L0S-T04b env strip replaces real secret with sentinel
- L0S-T04b injectHosts not subset of allowedDomains throws
- L0S-T04b injectHosts subset of allowedDomains passes invariants
- L0S-T04b non-injectHost egress redacts real secret in headers and body
- L0S-T04b sigV4Sign produces AWS4 HMAC-SHA256 authorization header
- L0S-T05 canary exfil to non-injectHost detected
- L0S-T05 canary to injectHost not counted as leak
- L0S-T05 clean run leaks zero canary
- L0S-T06 concurrency limit enforced
- L0S-T06 hard timeout kills sandbox process
- L0S-T06 orphan list detects leftover worktree+process
- L0S-T06 teardown runs even if fn throws
- L0S-T07 equal profiles are neither tightened nor relaxed
- L0S-T07 profile dir self-denied
- L0S-T07 relaxing a deny is rejected
- L0S-T07 tampered profile rejected
- L0S-T07 tighten allowed, relax rejected
- L0S-T08 allow new domain with untrusted signer rejected
- L0S-T08 allow new domain with valid signoff accepted
- L0S-T08 allow new domain without signoff rejected
- L0S-T08 deny tighten allowed without signoff
- L0S-T08 denyOut tighten allowed without signoff
- L0S-T09 breaker accepts non-regressing prompt change
- L0S-T09 evaluateOnSafetySuite reports perfect F1 on known labels
- L0S-T09 known-safe/known-destructive/known-exfil classified correctly
- L0S-T09 prompt change relaxing destructive→allow rejected
- L0S-T09 swap A/B yields consistent verdict
- L0S-T10 archive not delete enforced
- L0S-T10 run produces reviewable diff
- L0S-T10 tighter stale policy reduces orphan count
- L0S-T11 canary leak rejects policy
- L0S-T11 new injectHost needs signoff + ⊆ allowedDomains
- L0S-T11 redactRules tighten auto-allowed
- L0S-T11 sensitive env pattern add auto-allowed
- L0S-T12 capability + security both pass
- L0S-T12 execute returns string contract enforced
- L0S-T12 impl allowing escape rejected
- L0S-T12 replacement without signoff rejected
- L0S-T13 acceptance↑ + C↓ allowed; reverse rejected
- L0S-T13 all non-empty real passes pass audit
- L0S-T13 canary payload tampering rejected
- L0S-T13 empty-response passes not counted
- L0S-T14 /etc/passwd blocked
- L0S-T14 169.254.169.254 blocked
- L0S-T14 all payloads blocked, zero escape
- L0S-T14 permissive backend surfaces escaped payload (suite reads backend)
- L0S-T14 ~/.ssh read blocked
- L1-T01 ScopeGuard rejects project scope override of policy.yaml
- L1-T01 loadActive returns ConfigSet matching lock versionSha
- L1-T01 loadActive throws ShaMismatchError when file tampered
- L1-T01 pinSha propagates to loadActive versionSha
- L1-T01 pinSha updates authoritative repo.lock.json.versionSha
- L1-T01 reload atomically swaps only when all sha match
- L1-T02 collectRecallSignal does not block on telemetry write failure
- L1-T02 collectRecallSignal increments reread count
- L1-T02 load returns baseline compaction substrate
- L1-T02 load throws MissingSubstrateError when file absent
- L1-T02 recall count 0 still emits signal
- L1-T03 PhaseSubstrate.load throws and keeps old snapshot on tamper
- L1-T03 PhaseSubstrate.load verifies all three phase files
- L1-T03 SignatureVerifier accepts matching safety segment
- L1-T03 SignatureVerifier throws SignatureTamperError on one-byte change
- L1-T03 SignatureVerifier throws when safety segment deleted
- L1-T03 collectCacheHit ignores warm-up session
- L1-T03 load throws MissingSignatureManifestError when manifest absent
- L1-T04a generateCandidates drops candidate that deletes safety segment
- L1-T04a generateCandidates returns empty on mutator failure
- L1-T04a generateCandidates returns empty on no failure trajectories
- L1-T04a generateCandidates returns up to 3 candidates with parentSha
- L1-T04a generateCandidates runs mutator in sandbox with distinct session
- L1-T04b commitOnSuccess writes active + staging v2
- L1-T04b paretoFront returns non-dominated set
- L1-T04b paretoFront throws NoWeightedSumError on weighted single-number score
- L1-T04b rollback is idempotent on unchanged file
- L1-T04b rollback restores sha to pre-commit HEAD
- L1-T04b strictImprovementGate accepts all-improve candidate
- L1-T04b strictImprovementGate rejects cache degrade >= tau
- L1-T05a generatePhaseCandidates rejects candidate deleting safety
- L1-T05a generatePhaseCandidates rejects candidate mutating static identity segment
- L1-T05a generatePhaseCandidates returns candidates only for requested phase
- L1-T05a generatePhaseCandidates returns empty on no failures
- L1-T05b commitOnSuccess writes active + staging v2 + warmUpSessionId
- L1-T05b rollback restores phase active sha
- L1-T05b select passes candidate with cacheHit null (warm-up not done)
- L1-T05b select passes candidate with steady cache loss < tauCache
- L1-T05b select rejects candidate with resolve degrade >= tau
- L1-T05b select rejects candidate with steady cache loss > tauCache (divergence)
- L1-T06 collectSelectionSignal writes selection ∧ resolve joint signal
- L1-T06 load does not throw when non-shape property field changed
- L1-T06 load flags cross-tool disparagement in description
- L1-T06 load returns ToolDoc with immutable name
- L1-T06 load throws SchemaShapeLockedError when required field changed
- L1-T06 load throws SchemaShapeLockedError when types field changed
- L1-T07 commitOnSuccess rejects shape mutation
- L1-T07 generateToolCandidates flags disparagement and excludes from staging
- L1-T07 generateToolCandidates patches only description not name/schema
- L1-T07 select passes candidate with selection∧resolve improve + token soft loss
- L1-T07 select rejects candidate with resolve degrade (cheat selection)
- L1-T08 Pareto select: token↓ + success持平 + discovery持平 → 入选
- L1-T08 assertDeferNotHidingCritical allows defer bash with preserved discovery
- L1-T08 assertDeferNotHidingCritical throws when bash deferred and discovery drops
- L1-T08 evolve defers low-freq high-cost tool
- L1-T08 evolve rejects candidate removing critical tool from active subset
- L1-T09 Pareto rejects candidate with cacheHit degrade (over-truncation)
- L1-T09 assertCutBoundaryRespected throws on tool_result cut
- L1-T09 evolve inserts CacheControl when cache hit low
- L1-T09 fallback chain = drop oldest tool_results only
- L1-T09 load returns ordered processor chain
- L1-T10 Pareto: token↓ + success持平 + reread↓ → 入选
- L1-T10 assertDestructiveHumanGated throws on bash auto-evolved
- L1-T10 assertErrorOutputNotHead throws on error class + head
- L1-T10 assertLimits throws when maxBytes < 1KB
- L1-T10 assertLimits throws when timeout < 1s
- L1-T10 evolve enlarges maxBytes for high-reread tool
- L1-T11 approved + decontaminated → commit writes CLAUDE.md + staging suffix
- L1-T11 assertDecontaminated throws on canary reverse-degrade
- L1-T11 assertHumanApproval throws on unapproved patch
- L1-T11 generateCandidates produces pending-approval patches
- L1-T11 patch reversing scope order (user overrides project) rejected
- L1-T12a assertBreaker allows ask→deny (tightening)
- L1-T12a assertBreaker throws on bash deny→allow
- L1-T12a assertBreaker throws on write deny→allow
- L1-T12a assertSilenceNotApprove throws when silence treated as approve
- L1-T12a assertSilenceNotApprove treats exit0+no-stdout as fall-through
- L1-T12a load returns ordered rule set
- L1-T12b agent runtime write to hooks/policy.yaml → EPERM
- L1-T12b generateHookCandidates passes breaker precheck
- L1-T12b select passes candidate with attack↓ ∧ false-deny↓
- L1-T12b select rejects candidate trading safety for utility (attack↑)
- L1-T12b select rejects candidate trading utility for safety (false-deny↑)
- L1-T13 assertBreaker throws on loosening unsent_tool_call_ids tracking
- L1-T13 assertDuplicateSideEffectZero passes when count == 0
- L1-T13 assertDuplicateSideEffectZero throws when count > 0
- L1-T13 evolve narrows pause scope when false-pause high
- L1-T13 select rejects candidate with false-pause↓ but duplicate>0
- L1-T14 assertRequiredFieldsIntact passes when all required fields present
- L1-T14 assertRequiredFieldsIntact throws when acceptance field missing
- L1-T14 evolve patches wording but keeps required field names
- L1-T14 evolve throws when mutator shares session with orchestrator
- L1-T14 load returns template + scaling
- L1-T14 strict-improvement: acceptance↑ ∧ reDispatch↓ → 入选
- L1-T15 assertForkFullHistory throws when fork copies partial
- L1-T15 assertFreshNoParentHistory throws when fresh loads parent history
- L1-T15 evolve improves acceptanceInBudget ∧ redoRate
- L1-T15 evolve summarized template adds field with redoRate↓
- L1-T15 route returns fresh for review-type task
- L1-T16 assertLuaSandboxed throws on io.open
- L1-T16 assertLuaSandboxed throws on os.execute
- L1-T16 assertPartitionDisjoint throws on overlap
- L1-T16 evolve changes overwrite→dedup_by_id on parallel-write signal
- L1-T16 strict-improvement: consistency↑ ∧ disjoint↑ → 入选
- L1-T17 assertAuthFieldHumanGated passes on signed change
- L1-T17 assertAuthFieldHumanGated throws on unsigned auth field change
- L1-T17 assertOnHandoffInvariant throws when on_handoff executes after transfer
- L1-T17 evolve adds non-auth field with misroute↓ allowed
- L1-T17 evolve improves misroute ∧ authFailure
- L1-T18 assertCheckpointOnly throws on mid-stream injection
- L1-T18 assertKillPauseHumanGated passes on signed widen
- L1-T18 assertKillPauseHumanGated throws on unsigned KILL widen
- L1-T18 evolve adds HINT permission (non-KILL/PAUSE) allowed
- L1-T18 evolve improves adoption ∧ falseReject
- L1-T19 assertCheckpointAtSuperStep throws on node-internal checkpoint
- L1-T19 assertIdempotencyZero passes when count == 0
- L1-T19 assertIdempotencyZero throws when count > 0
- L1-T19 evolve adjusts action on misclassified failure
- L1-T19 strict-improvement: acceptance↑ ∧ idempotency==0 → 入选
- L1-T20 Pareto: acceptance↑ ∧ tokenCost not significantly↑ → 入选
- L1-T20 assertDebateSparse throws on full topology
- L1-T20 assertVoteIndependent throws on shared solver state
- L1-T20 evolve rejects max_rounds increase with no martingale gain
- L1-T20 martingaleAblation reports voteGain ≥ debateGain
- L1-T20 route returns vote for reasoning task
- L1-T21 assertAudienceUserNotInjectedToModel throws on audience:[user] injected to model
- L1-T21 assertDestructivePromptHumanGated passes on signed prompt
- L1-T21 assertDestructivePromptHumanGated throws on unsigned execute prompt
- L1-T21 evolvePromptTemplate improves userTaskSuccess
- L1-T21 evolveRanker Pareto: success↑ ∧ token↓ ∧ reference↑ → 入选
- L1-T21 rank returns resources sorted by weights
- L2-T01 loadAll first-wins on name collision and warns
- L2-T01 loadSkill loads compliant skill
- L2-T01 loadSkill rejects invalid name uppercase
- L2-T01 loadSkill rejects missing description
- L2-T01 loadSkill rejects name too long
- L2-T02 MEMORY.md cap 200 lines drops tail
- L2-T02 MEMORY.md cap 25KB drops tail
- L2-T02 create creates file and appends index
- L2-T02 create refuses overwrite
- L2-T02 create rejects path escape %2e%2e
- L2-T02 create rejects path escape ../
- L2-T02 delete moves to archive not physical delete
- L2-T02 str_replace rejects non-unique old_str
- L2-T02 str_replace replaces unique match
- L2-T02 view rejects operating on /memories root
- L2-T02 view returns file content
- L2-T03a duplicate write creates new id not overwrite
- L2-T03a rejects content with credential path
- L2-T03a writeReflexion persists note and provenance
- L2-T03b CE-T10 selective forgetting signals retire candidate
- L2-T03b bounded cap C=50 evicts lowest contribution on overflow
- L2-T03b downvote decrements contribution
- L2-T03b retire moves to archive not delete
- L2-T03b retired note recoverable from archive
- L2-T03b shouldRetire false when contribution>-τ
- L2-T03b shouldRetire false when trials<N_min
- L2-T03b shouldRetire true when contribution<=-τ and trials>=N_min
- L2-T03b upvote increments contribution
- L2-T04a empty clusters returns empty
- L2-T04a filters clusters size<2
- L2-T04a redacts credentials in trajectories
- L2-T04b ADD rejects concrete path
- L2-T04b ADD rejects credential
- L2-T04b ADD rejects evidenceCount<2
- L2-T04b ADD sets importance=2 status=shadow
- L2-T04b DOWNVOTE decrements
- L2-T04b DOWNVOTE to 0 archives not delete
- L2-T04b UPVOTE increments importance
- L2-T04b activate rejects on held-out regression
- L2-T04b activate succeeds on held-out improvement
- L2-T04b archived insight recoverable
- L2-T05 addTrajectory persists pass outcome
- L2-T05 addTrajectory redacts credentials
- L2-T05 addTrajectory rejects fail outcome
- L2-T05 low contribution retires to archive
- L2-T05 retired trajectory recoverable
- L2-T05 retrieveFewShot empty when no trajectories
- L2-T05 retrieveFewShot returns top-k by cosine
- L2-T06 createFact reference persists
- L2-T06 createFact rejects path escape
- L2-T06 createFact user accepts with 2 evidence
- L2-T06 createFact user accepts with userConfirmed
- L2-T06 createFact user rejects without higher gate
- L2-T06 evict moves to archive
- L2-T06 scheduleFreshContextReview enqueues without blocking createFact
- L2-T06 shouldEvict true after ttl
- L2-T06 viewFact increments accessFreq
- L2-T07 addNote creates links via judge
- L2-T07 evolveNote snapshots old K/G/X to archive
- L2-T07 evolved note recoverable
- L2-T07 judgeLink rejects missing reason
- L2-T07 link has reason provenance
- L2-T07 pruneLinks moves 0-hit note to archival not delete
- L2-T08 fresh-context review flags stale block
- L2-T08 recallSearch returns snapshots
- L2-T08 replaceBlockValue rejects exceeds limit
- L2-T08 replaceBlockValue rejects read_only
- L2-T08 replaceBlockValue writes and snapshots
- L2-T08 rollback restores old value
- L2-T09a measureTriggerAccuracy computes confusion
- L2-T09a measureTriggerAccuracy empty held-out returns zeros
- L2-T09a promoteDescription accepts on improvement
- L2-T09a promoteDescription rejects on regression
- L2-T09b addLLMAuthoredSkill defaults to staging
- L2-T09b breakerScan flags eval
- L2-T09b breakerScan flags exec
- L2-T09b breakerScan flags network
- L2-T09b promoteToActive accepts with held-out improvement and human sign
- L2-T09b promoteToActive rejects regression
- L2-T09b promoteToActive rejects without human sign
- L2-T09b sandboxVerify blocks reading ~/.ssh
- L2-T10 archived entry recoverable
- L2-T10 bounded cap C=50 evicts lowest
- L2-T10 retireIfLowContribution rejects authoring prior
- L2-T10 tick active to stale after 30d
- L2-T10 tick skips cron-referenced
- L2-T10 tick skips hub-installed
- L2-T10 tick skips pinned
- L2-T10 tick stale to archived after 90d
- L2-T11 commit appends version suffix nameV2
- L2-T11 commitOnSuccess accepts on exitCode=0
- L2-T11 commitOnSuccess rejects on exitCode=1
- L2-T11 commitOnSuccess rejects without verdict
- L2-T11 index holds only latest version
- L2-T11 rollback rebuilds index
- L2-T11 rollback restores previous version
- L2-T12 collectDrift returns three metrics
- L2-T12 validateParams accepts C=50
- L2-T12 validateParams rejects C=0
- L2-T12 validateParams rejects authoring prior retirement
- L2-T12 validateParams rejects negative C
- L2-T13 isHealthy false on overRetiredRate>5%
- L2-T13 isHealthy true on all normal
- L2-T13 monitor detects bloat
- L2-T13 monitor detects erosion
- L2-T13 monitor detects stagnation
- L2-T14 background job idempotent on same key
- L2-T14 hot-path failure falls back to background
- L2-T14 route episodic to background
- L2-T14 route feedback to hot
- L2-T14 shouldTriggerBackground on eventCount
- L2-T15 breakerScan flags eval/exec/network
- L2-T15 never-auto-install-project enforced
- L2-T15 stripSecrets preserves non-secret env
- L2-T15 stripSecrets removes SECRET/KEY/AUTH
- L2-T15 stripSecrets removes TOKEN env
- L2-T15 trustGate accepts project skill with trust
- L2-T15 trustGate rejects project skill without trust
- L2-T15 trustGate warns on <100 installs
- L3-T01 STATIC_CORE_PATHS mirrors L0C-T11 STATIC_CORE_DIRS (shared constant, not redefined)
- L3-T01 routeOptimizer('prompt') returns a non-null Optimizer instance (stub OK, assert interface shape)
- L3-T01 routeOptimizer('weight') returns null (weight channel default off invariant)
- L3-T01 routeOptimizer('workflow') throws NotImplemented (V2 placeholder, MVP unsupported)
- L3-T01 runEvolutionLoop entry: assertReadonly invoked with STATIC_CORE_PATHS
- L3-T01 runEvolutionLoop entry: static-core writable → throws BreakerError + securityEvents length=1
- L3-T01 weight channel stays off across repeated calls (no public toggle exists; route table immutable)
- L3-T02 FakeEvaluator throwing on a candidate → that candidate skipped, loop does not crash
- L3-T02 beamWidth=3 but optimizer LLM produces only 2 candidates → returns 2 (no padding)
- L3-T02 convergence: seed fixed → 3 consecutive generations, best.resolve_rate monotonically non-decreasing
- L3-T02 generate returns ≤ beamWidth candidates (seed=42 → exactly 3)
- L3-T02 heldout fitness passed into selectTopK → throws SelectionSignalViolation (heldout must not feed generate, contract §2)
- L3-T02 selectTopK keeps fitness top-3; ties broken by diversity (content diff) — id order fixed by seed
- L3-T03 FakeLLM returns fixed JSON → mutate produces Mutant with origin='reflective' + parentSha=substrate.sha
- L3-T03 FakeLLM returns non-JSON → throws MalformedMutation
- L3-T03 empty failures → returns [] (no reflection source)
- L3-T03 input trajectory with luckyPass=true → throws LuckyPassTrajectoryRejected (defence-in-depth)
- L3-T03 mutated content differs from original content (editDistance > 0)
- L3-T04 cache_hit direction NOT flipped (higher=better, same as resolve_rate): up → accept; down → reject + regressions=['cache_hit']
- L3-T04 candidate fitness missing a field (raw incomplete) → throws IncompleteFitness
- L3-T04 improvement → accept (resolve_rate up, token same, cache_hit same, τ=0)
- L3-T04 multi-objective: one dim improves, another regresses → reject (any regression rejects)
- L3-T04 regression → reject + regressions=['resolve_rate'] (resolve_rate down 0.05 ≥ τ=0)
- L3-T04 token direction flipped (lower=better): candidate.token down → accept; up → reject
- L3-T04 τ unspecified for a dim → default τ=0 (boundary: missing config)
- L3-T04 τ=0.02, regression 0.01 < τ → accept (threshold boundary)
- L3-T05 3+ dims all equal points → all kept (boundary: tied non-dominated)
- L3-T05 empty input → []
- L3-T05 fixed-seed FakeEvaluator produces 3 candidates → front size fixed by seed
- L3-T05 mutually non-dominating points → all returned
- L3-T05 one point strictly better in all dims → other excluded
- L3-T05 source file contains no weightedSum identifier (grep invariant)
- L3-T05 token direction flipped correctly (low token not dominated by high token)
- L3-T05 weightedSum call → throws WeightedSumForbidden (invariant, PRD §6.7)
- L3-T06a duplicate sha insert → throws DuplicateArchiveEntry
- L3-T06a insert non-strictly-dominated child → archived; rollback(history sha) returns entry
- L3-T06a isInteresting: child non-strictly worse than parent (≥ one dim) → true
- L3-T06a isInteresting: child strictly worse in all dims → false (not interesting)
- L3-T06a queryNonDominated consistent with T05 Pareto front (reuse fixture)
- L3-T06a retire(sha) does not reduce size() (never-auto-delete invariant)
- L3-T06b MAP-Elites: insert better into occupied bin → old evicted (returned) and moved to retired
- L3-T06b MAP-Elites: insert weaker into occupied bin → evicted=null (no replacement)
- L3-T06b reseed at period: each island kills worst-half; survivors reseed from best (seed-fixed ids)
- L3-T06b reseed before period → no-op
- L3-T06b reseed does not reduce global size (never-auto-delete: killed → retired, not deleted)
- L3-T07 consecutive downvotes do not underflow (cap 0)
- L3-T07 downvote from 1 → count=0 + shouldRetire=true
- L3-T07 evidenceCount < minEvidence(2) → shouldActivate=false (insufficient evidence)
- L3-T07 new entry → importanceCount=2 (provable via downvote→1)
- L3-T07 retire does not delete entry (archive size invariant + status retired)
- L3-T07 upvote increases count (returns new count)
- L3-T08 PII>0 signal → immediate revert (zero tolerance)
- L3-T08 bumpVersion: first bump → nameV2; existing suffix → next V
- L3-T08 gate both pass → commit returns version='nameV2' + sha
- L3-T08 gate.strictImprovement=false → commit returns null (no retain)
- L3-T08 onRegressionSignal resolve_drop → revertExec called with 'git checkout <toSha>' + reverted=true
- L3-T08 optimizer attempts to mutate rollbackThreshold → breaker reject + securityEvent
- L3-T08 regressing mutant → commit returns null + no new active archive entry
- L3-T08 vector index latest(): unique newest version (nameV3 over nameV2)
- L3-T09 fitness generalisation error: raw skill pass@k semantics leak → FitnessGeneralizationError
- L3-T09 fromTelemetry: pass=false → resolve_rate=0 (failure path)
- L3-T09 fromTelemetry: span missing usage → throws IncompleteTelemetry
- L3-T09 fromTelemetry: span {pass:true, usage:{output:100}, cache_read:80} → Fitness={resolve_rate:1, token:100, cache_hit:0.8}
- L3-T09 runLoop: breaker scenario — optimizer writes static-core → reject + securityEvent (§1 scenario two)
- L3-T09 runLoop: improver commits + enters archive; regressor rejected (§1 scenario one)
- L3-T10 fastNonDominatedSort: 6 points with 2 layers → rank 0 = non-dominated, rank 1 = dominated-by-rank0
- L3-T10 full-population first front size ≥ reduced beam front size (same seed, upgrade payoff)
- L3-T10 full-population generate triggers reflective mutation per top-K candidate (mutate calls = K, not 1)
- L3-T10 heldout fitness passed into fastNonDominatedSort → SelectionSignalViolation (inherited contract)
- L3-T10 weightedSum call → WeightedSumForbidden (invariant inherited from T05)
- L3-T11 acquisition: high-variance candidate prioritised (exploration, seed-fixed id)
- L3-T11 factorize: 3 instruction × 3 demo → 9 crossed Mutants (origin='reflective', parentSha)
- L3-T11 heldout split samples passed to fit → TrainValLeak (heldout must not feed surrogate)
- L3-T11 surrogate.fit + predict: predicted mean correlates with true fitness (Pearson > 0.5, fixed seed)
- L3-T11 train/val split non-overlapping (train ∩ val = ∅)
- L3-T11 workflow/weight substrate → NotImplementedError (prompt-only)
- L3-T12 applyGradients: produced Mutant rewrites both variables (editDistance > 0 each)
- L3-T12 backprop: 2 variables → each gets an independent gradient suggestion (FakeLLM routes by varId)
- L3-T12 empty-gradient variable stays unchanged (LLM gave no suggestion for it)
- L3-T12 luckyPass trajectory → LuckyPassTrajectoryRejected (inherited from T03)
- L3-T12 per-variable isolation: A's gradient does not change B's content
- L3-T12 weight substrate → NotImplementedError (prompt/skill only)
- L3-T13 DSL containing eval() → validate ok=false + violations contains eval flag
- L3-T13 DSL containing exec/spawn (subprocess) → ok=false
- L3-T13 DSL containing network egress (fetch/https) → ok=false
- L3-T13 DSL expressiveness: control flow (if/loop) + tool call parses to correct AST node types
- L3-T13 archive.size() monotonically non-decreasing across N generations (keep-all)
- L3-T13 archived entry can be re-sampled in later generation (growing archive open-ended)
- L3-T13 cold start (archive empty) → returns empty or zero-shot
- L3-T13 proposeAgent: LLM writes a new DSL Mutant (origin='reflective', parentSha)
- L3-T13 sampleArchive(k=3, seed fixed) returns 3 high-fitness + high-diversity entries (seed-fixed ids)
- L3-T14 backprop: node.visits++ + totalFitness accumulates (experience per node)
- L3-T14 expand: LLM rewrites node wiring → ≥1 child Mutant (origin='reflective', editDistance > 0)
- L3-T14 heldout fitness passed into select/expand feedback → SelectionSignalViolation (contract §2)
- L3-T14 non-workflow substrate → NotImplementedError
- L3-T14 rollout: calls sandbox.runVerify (executes workflowScript) + evaluator.score
- L3-T14 select: UCT picks max( avg + cUCT*sqrt(ln(parentVisits)/visits) ) node (seed-fixed id)
- L3-T15 WEIGHT_CHANNEL_DEFAULT === 'off' (default-off invariant, PRD §6.1 N1)
- L3-T15 breaker: runtime off→on attempt (no human signature) → BreakerError + securityEvent
- L3-T15 checkOpen: KL > KL_MAX(0.05) → open=false + reasons non-empty
- L3-T15 checkOpen: all four preconditions satisfied → open=true
- L3-T15 checkOpen: consolidationNonInferior=false → open=false
- L3-T15 checkOpen: humanSigned=false → open=false (human gate)
- L3-T15 checkOpen: oraclePassRate < ORACLE_PASS_MIN(0.9) → open=false
- L3-T15 spec deliverable specs/L3-T15-weight-channel-spec.md exists and pins the four thresholds
- L3-integration scenario one: regressing variant rejected by strict-improvement and not archived
- L3-integration scenario two: optimizer writes static-core path → reject + securityEvent
- OPS-T02 · metrics aggregation aggregates lift/retained/rejected/tokens/decision + summary.totalLift
- OPS-T02 · metrics aggregation emits reports/metrics-trend.md trend table
- OPS-T02 · metrics aggregation empty reports → runs:[] + summary zero + exit 0
- OPS-T02 · metrics aggregation malformed report (no key fields) → skipped + warn, does not crash
- OPS-T02 · metrics aggregation reject report (no lift) → lift:null + decision:reject + excluded from totalLift
- OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) identifies flaky test (pass in some runs, fail in others); stable not flagged
- OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) malformed run json → skipped + warn, does not crash (exit 0)
- OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) no flake when all 5 runs identical → reports no flake detected
- OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) reports pass/fail matrix across runs (run-1..run-N columns)
- OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) single failure across 5 runs is still a flake (status varies)
- OPS-T03 · run-suite-5x.mjs flake diff (fixture-driven) skipped tests are not flagged as flake (skip ≠ flake)
- REAL-T01 · RealLLMPort (mock child_process) kills + throws PiHeadlessTimeout on timeout (no retry)
- REAL-T01 · RealLLMPort (mock child_process) passes multi-line prompt via stdin pipe (not argv)
- REAL-T01 · RealLLMPort (mock child_process) retries on non-zero exit then throws PiHeadlessError (maxRetries=2 → 3 calls)
- REAL-T01 · RealLLMPort (mock child_process) spawns pi -p --model <m> and returns stdout
- REAL-T01 · RealLLMPort (mock child_process) strips ANSI escape codes from stdout
- REAL-T01 · RealLLMPort (mock child_process) throws PiHeadlessError on ENOENT without retry
- REAL-T01 · real pi -p smoke real pi -p roundtrip returns PONG
- SEC-T01 · assertFreshEvidence 接线 drops forged eperm evidence before judging
- SEC-T01 · assertFreshEvidence 接线 filterForgedEperm is wired into assertFreshEvidence entry (single responsibility)
- SEC-T01 · crossCheckEperm consistent when epermHits empty
- SEC-T01 · crossCheckEperm consistent when epermHits non-empty and exitCode non-zero
- SEC-T01 · crossCheckEperm forged-suspect when epermHits non-empty but exitCode=0
- SEC-T01 · filterForgedEperm all-consistent runs → kept unchanged, dropped empty
- SEC-T01 · filterForgedEperm drops forged-suspect runs and emits warnings
- TL-T01 append-only: 文件已写节点 U 后续写不修改 U 行
- TL-T01 crash recovery: loadSession 返回完整树
- TL-T01 orphaned tool_use_id: tool_result 无配对 tool_use → verifyTree 报 orphans
- TL-T01 parentUuid tree: root parentUuid=null; child 指向 parent
- TL-T01 subagent boundary: appendSubagentBoundary 创建 agentId 隔离节点
- TL-T02 attribution: subagent cost 不重复算到 parent
- TL-T02 computeCost: cache_read 折扣价 0.3 正确（防 total_tokens 漏折扣）
- TL-T02 computeCost: 五子类型按价目表正确核算
- TL-T02 computeCost: 子类型为 0 时 cost=0 且不抛错（边界值 0 合法）
- TL-T02 price_table: model 不存在 → PriceNotFoundError
- TL-T02 price_version: cost 落 price_version 字段
- TL-T02 recordTurn: 拒 total_tokens 字段 → TotalTokensRejectedError
- TL-T03 50 LLM call 父-子树完整无孤儿
- TL-T03 full messages 作 structured event 非 attr
- TL-T03 required gen_ai.* attrs 齐全
- TL-T03 span name = '{operation} {model}'
- TL-T03 subagent trace context 传播: conversation.id 一致 + agent.id 隔离
- TL-T03 tool-exec span parentSpanId 正确且不带 gen_ai.*
- TL-T03 usage 五子类型作 span attrs
- TL-T03 缺 gen_ai.operation.name → MissingRequiredAttrError
- TL-T04 measureReproRate: 6/10 → rate 0.6
- TL-T04 replay: setupScript 注入后确定性恢复
- TL-T04 replay: transcript 损坏 → TranscriptCorruptError
- TL-T04 replay: 确定性 session exit code 复现
- TL-T04 replay: 非确定 action 列入 nondeterministicActions
- TL-T05 PII 字段 full_env_vars → validate 报 piiFields
- TL-T05 applyToWriter: capture_thinking_blocks=false 跳过 thinking
- TL-T05 applyToWriter: capture_thinking_blocks=true 保留 thinking
- TL-T05 load 默认 config 成功
- TL-T05 telemetry_schema_frozen=true → 改 config 抛 SchemaFrozenError
- TL-T05 truncate_bytes < 1024 → validate 报违规
- TL-T05 项目 scope 覆写 → ProjectScopeOverrideRejectedError
- TL-T06 agent 运行时改 budget → RewardTamperingError
- TL-T06 budget: 未超 per_agent_budget → exceeded=false
- TL-T06 budget: 超 per_agent_budget → exceeded=true
- TL-T06 project scope 覆写 → reject
- TL-T06 runaway: 穿插 read 打断计数 → runaway=false
- TL-T06 runaway: 连续 11 次 bash → runaway=true
- TL-T06 runaway: 连续恰好 threshold 次 bash 不触发（边界）
- TL-T07 assertNoPII: 未脱敏 PII → PIILeakError
- TL-T07 capture_message_events=false 不落 event
- TL-T07 capture_message_events=true 落 event
- TL-T07 message_sampling_rate=0.5 采样落 event 数 ≈ 50
- TL-T07 project scope 覆写 → reject
- TL-T07 redact: API key sk-xxx → [REDACTED_API_KEY]
- TL-T07 redact: SSN → [REDACTED_SSN]
- TL-T08 clusterFailures: 5 个失败 → 2 cluster 正确分组
- TL-T08 embedding 不可用 → EmbeddingUnavailableError
- TL-T08 k=auto: 自动选 k
- TL-T08 labelCluster: 返回 label_schema 内标签
- TL-T08 min_cluster_size=2: 单个失败进 outliers
- TL-T09 score: token 相同 taskType 不同 → 多样性高者得分高
- TL-T09 select: 10 成功 trajectory → top-5 倾向低 token
- TL-T09 select: 全失败 → 空数组
- TL-T09 权重配置生效
- TL-T09 缺 embedding → MissingEmbeddingError
- TL-T10 ATIF record 缺 judgeScore → MissingJudgeScoreError
- TL-T10 exportEvalDataset: 3 成功 session → 3 records
- TL-T10 judgeTrajectory: 返回 0-1 score + 落 gen_ai.evaluation.score span
- TL-T10 transcript 损坏 → TranscriptCorruptError + 报告错误数
- TL-T10 失败 session 不进 dataset
- TL-T11 C=50 满 → 淘汰最低 contribution 进 archive
- TL-T11 add: importance=2, evidenceCount=1, status=active
- TL-T11 clean canary 反降分 → quarantine
- TL-T11 delete API → NeverAutoDeleteError
- TL-T11 downvote 归 0 → archived 非 delete
- TL-T11 evidenceCount<2 → activated=false
- TL-T12 endpoint 不可达 → OtlpExportError + 本地 fallback
- TL-T12 exportSpans: mock OTLP endpoint 接收成功
- TL-T12 injectMetadata: langfuse.session.id/version/release 落每个 span
- TL-T12 含 PII spans → PIILeakError
- TL-T12 缺 apiKey → MissingAuthError
- XM-T01 e2e: all-rejected generation commits nothing
- XM-T01 e2e: full cycle produces committed mutant
- XM-T01 e2e: regression signal triggers revert and restores baseline
- XM-T01 g5-report: incomplete evidence throws IncompleteG5Evidence

---

## flake 定位分析（人工补充）

### 5 次连续运行矩阵概要

- 5 次连续运行（`node scripts/run-suite-5x.mjs --run --runs 5`）的 pass/fail 矩阵见上文。
- 运行期间 adapt 波次兄弟任务（ADP-T02/T03、SEC-T01 等）的 WIP 在共享工作树中陆续落地，导致 run-1..run-3 与 run-4..run-5 的用例总数不同（844 → 874）。diff 按 fullName 聚合，仅 `L0C-T01 pnpm -r build succeeds for all 7 packages` 一例结果跨 run 不一致（failed×4, passed×1）→ 唯一 flake。

### 抖动用例清单

| 用例 | run-1 | run-2 | run-3 | run-4 | run-5 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| L0C-T01 pnpm -r build succeeds for all 7 packages | ❌ | ❌ | ❌ | ❌ | ✅ | flake |

### 根因分析

- 该用例（`tests/L0C/T01-scaffold.spec.ts:162`）执行 `pnpm -r run build`（7 包 tsc，timeout 180s），且同文件上一用例执行 `pnpm install --frozen-lockfile=false` 会写 `node_modules`。
- 全套件下 vitest 并行跑多文件，`pnpm -r build` 与并发子进程争抢 CPU/IO，且 `pnpm install` 对 `node_modules/.pnpm` 的写操作可能与并发 pnpm 调用竞态，导致 180s timeout 或瞬时 tsc 失败 → 4/5 次 fail。
- 单独串行跑 `pnpm -r run build`（3 次）全 exit 0，证实为资源竞争型 flake，非逻辑错误。

### 修复措施

- 该 flake 位于 **TEST-LOCK §2.1 锁定文件** `tests/L0C/T01-scaffold.spec.ts`（sha256 `139000a5…`）。implementer 对 `tests/**/*.spec.ts` 只读，**不可**改断言/加 skipIf/放宽 timeout（TEST-LOCK §1.2 → `test-lock-violation` 直接 reject）。
- 合法修复路径 = 申诉通道：implementer 提交申诉单（task OPS-T03 + 文件 `tests/L0C/T01-scaffold.spec.ts` + 本报告失败证据 + 理由"资源竞争型 flake，建议加 `it.skipIf(process.env.CI_FULL_SUITE)` 或串行隔离"），由 test-author 修订 + 重新计算 sha256 + 更新 TEST-LOCK.md §2.1 + 重跑 RED 门。
- 本任务范围内不强行修（遵守 TEST-LOCK 锁定规则）；flake 影响 = 恰 1 个 green 抖动，被收紧后的容差 2 覆盖（baseline-2 ≤ 实际 greens ≤ baseline，不红）。

### 容差收紧

- `.github/workflows/ci.yml` 第 ~141 行 `BASELINE - 5` → `BASELINE - 2`（修 flake 评估后：唯一 flake 仅 ±1 green，容差 2 足以吸收且仍能挡 ≥2 的批量回归）。
- 旧容差 `BASELINE - 5` 已移除（grep 不到）。
- GREENS.baseline 值同步更新为当前全套件稳定 greens（含本任务 OPS-T03 spec 6 用例转绿）。

### 结论

- 5 次运行检测到 1 个 flake（`L0C-T01 pnpm -r build`），属资源竞争型，位于锁定测试文件，须走申诉通道修复。
- 容差已从 5 收紧到 2；flake ±1 green 在容差内，CI 不会误红。
