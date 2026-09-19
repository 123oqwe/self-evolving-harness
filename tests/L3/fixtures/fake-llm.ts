// L3 test fixture — FakeLLM.
//
// Spec: execution/L3-engine/TASKS.md §L3-T03 (LLMPort), reused T11/T12/T13/T14.
// Scripted `complete(prompt)` responses: either a static reply table keyed by
// prompt-substring, a function, or a default string. Captures all prompts for
// assertion (e.g. per-variable routing in T12 TextGrad).

export interface FakeLLMOptions {
  /** prompt-substring → reply. First match wins. */
  replies?: Record<string, string>;
  /** Programmatic reply based on the prompt. */
  responder?: (prompt: string) => string;
  /** Default reply when no match. */
  defaultReply?: string;
}

export class FakeLLM {
  public readonly calls: string[] = [];
  private readonly replies: Record<string, string>;
  private readonly responder?: (prompt: string) => string;
  private readonly defaultReply: string;

  constructor(opts: FakeLLMOptions = {}) {
    this.replies = opts.replies ?? {};
    this.responder = opts.responder;
    this.defaultReply = opts.defaultReply ?? "";
  }

  async complete(prompt: string): Promise<string> {
    this.calls.push(prompt);
    if (this.responder) return this.responder(prompt);
    for (const [needle, reply] of Object.entries(this.replies)) {
      if (prompt.includes(needle)) return reply;
    }
    return this.defaultReply;
  }
}
