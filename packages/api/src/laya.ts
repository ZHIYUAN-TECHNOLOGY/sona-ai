/**
 * The UI-composition evaluator (docs/delivery-plan.md, UI generation): json-render's
 * `experimental_composeSpec` asks which offered card answers a request, and Sona's fine-tuned Laya
 * picks one (tools/laya-eval: 92% on the held-out Manglish baseline, about 40 ms). Laya runs on our own
 * box behind laya-serve, which speaks TypeSafe Jev's /v1/systemone protocol, so no prompt goes to
 * Vercel's hosted Jev. Pass the result as `evaluate`. Server only: the key never reaches the phone.
 * Not wired into the Agent yet.
 */

/** `Experimental_CompositionEvaluator` from @json-render/core 0.21.0 (pinned), restated so this package needs no json-render dependency. */
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type Evaluation = { answers: Record<string, { choice: string; confidence?: number }>; usage?: { inputTokens?: number } };
export type Evaluator = (request: { state: Record<string, unknown>; questions: Record<string, ChoiceQuestion>; signal: AbortSignal }) => Promise<Evaluation>;

type LayaReply = { answers?: Record<string, { choice?: unknown; answer_confidence?: unknown }>; usage?: { input_tokens?: number } };

export function layaEvaluator({ url, apiKey, fetcher = fetch }: { url: string; apiKey?: string; fetcher?: typeof fetch }): Evaluator {
  return async ({ state, questions, signal }) => {
    const res = await fetcher(`${url.replace(/\/$/, "")}/v1/systemone`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      // Pins the fine-tuned checkpoint; left out, laya-serve may route English text to its stock model.
      body: JSON.stringify({ model: "multilingual", state, questions }),
    });
    if (!res.ok) throw new Error(`Laya answered ${res.status}`);
    const reply = (await res.json()) as LayaReply;
    const answers: Evaluation["answers"] = {};
    for (const [id, question] of Object.entries(questions)) {
      const answer = reply.answers?.[id];
      // The composer rejects an unoffered key too; failing here names the question.
      if (typeof answer?.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice)) throw new Error(`Laya gave no offered choice for "${id}"`);
      // answer_confidence is Laya's calibrated confidence in its pick.
      answers[id] = typeof answer.answer_confidence === "number" ? { choice: answer.choice, confidence: answer.answer_confidence } : { choice: answer.choice };
    }
    return { answers, usage: { inputTokens: reply.usage?.input_tokens } };
  };
}
