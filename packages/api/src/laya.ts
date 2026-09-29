/**
 * Laya, Sona's fine-tuned decision model (tools/laya-eval), served on our own box by laya-serve over
 * TypeSafe Jev's /v1/systemone protocol, so no prompt goes to Vercel's hosted Jev. Server only: the key
 * never reaches the phone. Not wired into the Agent yet.
 *
 * `pickCard` is how the fixed pages use it: one "which card?" question (v2: 92% on the held-out Manglish
 * baseline, about 40 ms), and the app builds the screen around the card (composeClinicalSpec: missing
 * context first for an incomplete history, then the card, then its source). Inside json-render's
 * `experimental_composeSpec`, which asks per-card use/omit questions instead, three fine-tunes stayed
 * at 84-86% whole screens, so the composer is left for free layouts; `layaEvaluator` still plugs into it.
 */

/**
 * The cards and medicines exactly as Laya was trained on them: change a description and the model
 * sees a question it never learned. tools/laya-eval reads these; its check fails if the medicine
 * labels drift from the app's catalogue.
 */
export const CARDS = {
  briefing: "Summary of the patient's background, history, allergies and medicines",
  reasoning: "Differential diagnosis and clinical reasoning",
  xray: "Chest X-ray reading",
  medication: "Review current medicines for interactions or problems",
  prescription: "Write or draft a prescription",
  followup: "Follow-up visit, safety-netting or a task",
  note: "Write the consultation note",
  evidence: "Studies, guidelines or severity score behind a decision",
} as const;
export const MEDICINES = {
  "salbutamol-inhaler": "Salbutamol metered-dose inhaler",
  "cetirizine-tablet": "Cetirizine tablet",
  "paracetamol-tablet": "Paracetamol 500 mg tablet",
} as const;
export type Card = keyof typeof CARDS;
export type Medicine = keyof typeof MEDICINES;

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

const PICK_QUESTIONS = {
  capability: { type: "choice", instructions: "Which clinical result answers this request?", criteria: { ...CARDS, "not-covered": "None of the above" } },
  medicine: { type: "choice", instructions: "Which catalogue medicine does the request name?", criteria: { ...MEDICINES, none: "No specific medicine named" } },
} satisfies Record<string, ChoiceQuestion>;

/**
 * Which card answers the clinician's request, and the catalogue medicine it names. `card: null` means
 * no card covers it (discharge, referral, coding and the like): the app says so rather than showing a
 * near miss. `patient` is the visit label (e.g. "Respiratory review"), as in training.
 */
export async function pickCard(evaluate: Evaluator, input: { request: string; patient: string; signal?: AbortSignal }) {
  const { answers } = await evaluate({ state: { request: input.request, patient: input.patient }, questions: PICK_QUESTIONS, signal: input.signal ?? AbortSignal.timeout(5000) });
  const card = answers.capability!.choice;
  const medicine = answers.medicine!.choice;
  return {
    card: card === "not-covered" ? null : (card as Card),
    medicine: medicine === "none" ? null : (medicine as Medicine),
    confidence: answers.capability!.confidence,
  };
}
