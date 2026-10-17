import type { WorkersAi } from "../workers-models";

/**
 * Clef-omni's own answers in the Clef trial (11 Oct, .scratch-eval/clef-trial/raw_clef-omni_run1.jsonl), as recorded:
 * the synthetic turn, Clef's choice and confidence, and its probabilities in the criteria's order (care: medical_question,
 * book_appointment, log_dose, log_reading, next_appointment, emergency, other; pro: patient_data, order_draft,
 * create_task, document_draft, clinical_reasoning, guideline_question, ward_overview, other). The trial asked only the
 * intent: the yes-or-no answers and other picks a test needs are given beside them.
 */
export const TRIAL = {
  c001: { said: "um hi can i take panadol together with my am low dipping or not", choice: "medical_question", confidence: 0.8692, p: [0.9419, 0.0091, 0.0055, 0.0047, 0.0089, 0.0166, 0.0133] },
  c004: { said: "uh last week i had like chest pain for a few minutes but now im totally fine do i need to worry about it", choice: "medical_question", confidence: 0.6875, p: [0.8522, 0.0211, 0.0043, 0.0046, 0.0209, 0.0601, 0.0368] },
  c015: { said: "help my husband is having really bad chest pain right now and he's sweating a lot", choice: "emergency", confidence: 0.764, p: [0.0338, 0.0191, 0.0119, 0.0154, 0.0157, 0.8919, 0.0122] },
  c021: { said: "can i book an appointment with doctor lim next week any morning is fine", choice: "book_appointment", confidence: 0.8534, p: [0.0116, 0.9346, 0.0068, 0.0086, 0.0213, 0.0103, 0.0068] },
  c026: { said: "ok i just took my insulin ten units", choice: "log_dose", confidence: 0.606, p: [0.0301, 0.0131, 0.8091, 0.0633, 0.0179, 0.032, 0.0345] },
  c030: { said: "my blood pressure this morning one thirty eight over eighty six", choice: "log_reading", confidence: 0.8015, p: [0.0187, 0.0141, 0.0158, 0.9102, 0.012, 0.0196, 0.0096] },
  c035: { said: "when's my next appointment again", choice: "next_appointment", confidence: 0.9232, p: [0.0058, 0.0067, 0.0048, 0.0068, 0.9664, 0.0054, 0.0041] },
  c049: { said: "ayah saya tiba-tiba keliru tak kenal orang cakap merepek", choice: "other", confidence: 0.1196, p: [0.2309, 0.0495, 0.0186, 0.0155, 0.0862, 0.2676, 0.3317] },
  c053: { said: "saya baru makan ubat darah tinggi tadi", choice: "log_dose", confidence: 0.7203, p: [0.0292, 0.0132, 0.8702, 0.0264, 0.0175, 0.025, 0.0185] },
  c054: { said: "dah suntik insulin lapan unit", choice: "emergency", confidence: 0.0328, p: [0.2042, 0.08, 0.133, 0.0468, 0.1102, 0.2233, 0.2025] },
  c057: { said: "bila temujanji saya yang seterusnya", choice: "next_appointment", confidence: 0.9166, p: [0.0067, 0.0099, 0.0047, 0.0057, 0.9635, 0.0056, 0.0039] },
  c077: { said: "我下次复诊是什么时候", choice: "next_appointment", confidence: 0.9201, p: [0.0054, 0.0072, 0.0054, 0.007, 0.965, 0.0055, 0.0045] },
  p005: { said: "Trend her Hb over the last three days.", choice: "create_task", confidence: 0.1767, p: [0.3566, 0.0858, 0.3705, 0.0329, 0.0546, 0.0474, 0.0363, 0.0159] },
  p013: { said: "Remind me to recheck her K+ at 4 pm.", choice: "create_task", confidence: 0.8486, p: [0.0128, 0.0092, 0.931, 0.0135, 0.0078, 0.0082, 0.0117, 0.0058] },
  p026: { said: "Who needs me first this morning?", choice: "ward_overview", confidence: 0.8241, p: [0.0139, 0.0096, 0.0119, 0.0145, 0.01, 0.0129, 0.9193, 0.0079] },
  p030: { said: "Okay, next patient.", choice: "ward_overview", confidence: 0.2029, p: [0.3477, 0.0417, 0.0471, 0.0643, 0.0367, 0.0258, 0.4135, 0.0232] },
} as const;

const OPTIONS = {
  care: ["medical_question", "book_appointment", "log_dose", "log_reading", "next_appointment", "emergency", "other"],
  pro: ["patient_data", "order_draft", "create_task", "document_draft", "clinical_reasoning", "guideline_question", "ward_overview", "other"],
};

/** A replayed turn: a trial row, and what the trial did not ask (yes-or-no probabilities, other picks by question). */
export type Replayed = { choice: string; confidence: number; p: readonly number[]; asks?: number; cancels?: number; picks?: Record<string, string> };

/**
 * Workers AI answering as Clef-omni did in the trial, for the words in `turns` (any other words fail, as a failing call
 * would); every call is kept. A question asks nothing by default and calls nothing off.
 */
export function clefReplay(turns: Record<string, Replayed>) {
  const calls: { model: string; input: Record<string, any> }[] = [];
  const ai: WorkersAi = {
    async run(model, input) {
      calls.push({ model, input });
      const said = (input.state as { said: string }).said, turn = turns[said];
      if (!turn) throw new Error(`Clef has no replay for "${said}"`);
      const options = turn.p.length === OPTIONS.pro.length ? OPTIONS.pro : OPTIONS.care;
      return {
        model: "clef-omni",
        answers: {
          intent: { choice: turn.choice, confidence: turn.confidence, probabilities: Object.fromEntries(options.map((o, i) => [o, turn.p[i]])) },
          asks_question: { noul: turn.asks ?? 0.05 }, cancels: { noul: turn.cancels ?? 0.02 },
          ...Object.fromEntries(Object.entries(turn.picks ?? {}).map(([id, choice]) => [id, { choice, confidence: 0.9 }])),
        },
      };
    },
  };
  return { ai, calls };
}

/** The trial rows by their words, ready for clefReplay. */
export const replay = (...ids: (keyof typeof TRIAL)[]) => Object.fromEntries(ids.map(id => [TRIAL[id].said, TRIAL[id]])) as Record<string, Replayed>;
