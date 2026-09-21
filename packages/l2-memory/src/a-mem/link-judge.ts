// L2-T07 · A-Mem link-judge（异模型 fresh-context 判链，async 接口）。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T07。
//
// link-judge 决定 new note 与 candidate note 之间是否建链，输出
// `{ link: boolean; reason: string }`。规范要点：
//   - **异模型 + fresh-context**（复用 bigpowers request-review 语义，
//     03-skills.md §1.1）——禁同模型自评建链（防 reward hack / 自吹）。
//   - **position-swap debias**（teamB LLM-judge STYLE/verbosity bias）：
//     newNote/candidate 位置对调各判一次，取两者均 link=true 才建链。
//   - **reason provenance required**——link=true 须附非空 reason，否则
//     reject "link reason provenance required"（错误路径）。
//
// 本接口为 async（供集成阶段 / async 测试路径 await 调用）。
// addNote（同步接口）走同步双路（见 note-store.ts 文件头说明），不依赖
// 本 async judgeLink 的同步返回。

import type { Note, LinkJudgeOutput, LinkJudgeLLM } from "./note-store.js";
import type { MemCtx } from "../memory-tool/commands.js";

/**
 * 从 ctx 取 link-judge LLM。
 *
 * ERRATA L2-06 裁决：无 ctx 签名的函数加可选 ctx 作第二/三参。本接口
 * spec 签名为 `judgeLink(newNote, candidate): Promise<LinkJudgeOutput>`，
 * impl 加 ctx 为**可选第三参**（与 ERRATA 一致）。ctx 缺省或未注入 LLM 时
 * 返回保守 mock（link=false），不污染 active 库。
 */
function judgeLLMOf(ctx?: MemCtx): LinkJudgeLLM {
  const ctxAny = (ctx ?? {}) as MemCtx & { linkJudgeLLM?: LinkJudgeLLM };
  if (typeof ctxAny.linkJudgeLLM === "function") return ctxAny.linkJudgeLLM;
  // 默认保守 mock：不建链，带 reason 说明（未注入 LLM 时不污染 active 库）。
  return (() => ({ link: false, reason: "no link-judge LLM injected" })) as LinkJudgeLLM;
}

/** 守门：link=true 须有非空 reason，否则 reject（provenance required）。 */
function requireReason(out: { link?: boolean; reason?: string }): void {
  if (out.link) {
    if (!out.reason || String(out.reason).trim().length === 0) {
      throw new Error("link reason provenance required");
    }
  }
}

/**
 * 判定 newNote 与 candidate 之间是否建链（异模型 + position-swap debias）。
 *
 * spec 签名 `judgeLink(newNote, candidate): Promise<LinkJudgeOutput>`；
 * impl 加 ctx 为**可选第三参**（ERRATA L2-06）。ctx 缺省 → 保守不建链。
 *
 * 错误路径：link=true 但 LLM 未输出 reason → reject
 * "link reason provenance required"。
 *
 * @param newNote   新入库 note。
 * @param candidate 候选近邻 note。
 * @param ctx       memory 上下文（可选；取 linkJudgeLLM）。
 */
export async function judgeLink(
  newNote: Note,
  candidate: Note,
  ctx?: MemCtx,
): Promise<LinkJudgeOutput> {
  const llm = judgeLLMOf(ctx);

  // 第一次判（newNote → candidate）。
  const first = await llm(newNote, candidate);
  requireReason(first);
  if (!first.link) {
    return { link: false, reason: first.reason ?? "" };
  }

  // position-swap debias：第二次对调位置再判，防 STYLE/verbosity bias。
  const swapped = await llm(candidate, newNote);
  requireReason(swapped);
  if (!swapped.link) {
    return { link: false, reason: "debias: position-swap disagreed" };
  }

  // 两次都 link=true → 建链，reason 取第一次（一致语义）。
  return { link: true, reason: String(first.reason) };
}
