import { chatModels, jsonIn } from "./chat-models";
import { stubModels, type Models } from "./models";

/**
 * Sona's models on the Baseten boxes (packages/infra/baseten, docs/handoff.md#baseten-boxes): Gemma in box ①,
 * speech in box ②, MedGemma in box ③. Boxes scale to zero and take minutes to wake, so every call has a
 * timeout; a call that fails or times out wakes its box for next time and answers from the stub, which says
 * "fixture", so a failure is never shown as a model reading. Methods not listed here stay on the stub.
 */
export const BOXES = { brain: "q9p7zn63", voice: "qvmgk79q", xray: "wdlp8jm3" } as const;
type Box = keyof typeof BOXES;

// The names each box serves its model under (vLLM --served-model-name), also recorded as provenance.
export const BRAIN_MODEL = "gemma-4-26b-a4b";
export const ASR_MODEL = "sona-asr";
export const XRAY_MODEL = "medgemma-1.5-4b";

/** Same shape as packages/retrieval's Reranker (that package imports this one, so it is not imported back). */
export type Reranker = (query: string, passages: string[]) => Promise<number[]>;

export type Baseten = { apiKey: string; fetcher?: typeof fetch; timeoutMs?: number };

const BRIEFING = `You brief a hospital doctor before they see a patient. Use ONLY the record below; never add a diagnosis, test result or number it does not state.
Answer with JSON only: {"lines": ["<one short sentence>", ...]}: 2 to 4 lines, most important first: why they came, what in the history or medicines matters today, any allergy, and anything missing from the record.`;

const EVIDENCE = `You answer a doctor's clinical question from the numbered sources only.
Answer with JSON only: {"claims": [{"text": "<one or two sentences>", "cites": [<source numbers>]}], "followUps": ["<question>", ...]}
Rules:
- 2 to 4 claims, each supported by and citing at least one numbered source. Never state a dose, number or finding that a cited source does not contain.
- Say how strong each claim is in words from the source's design (a guideline recommends, a randomised trial found, a review concluded).
- If the sources do not answer the question, return no claims.
- Up to 3 short follow-up questions these sources could answer.`;

const XRAY = `If this is not a chest radiograph, say so in one sentence. Otherwise list the findings a radiologist would report, most important first, in at most 4 short sentences.
Answer with JSON only: {"findings": ["<sentence>", ...]}`;

const strings = (value: unknown, max: number) =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === "string" && s.trim() !== "").map(s => s.trim().slice(0, 300)).slice(0, max) : [];

function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function boxes({ apiKey, fetcher = fetch, timeoutMs = 30_000 }: Baseten) {
  const base = (box: Box) => `https://model-${BOXES[box]}.api.baseten.co/environments/production`;
  const headers = { Authorization: `Api-Key ${apiKey}` };
  /** Starts a sleeping box without waiting for it (a wake answers at once). */
  const wake = (box: Box) => fetcher(`${base(box)}/wake`, { method: "POST", headers, signal: AbortSignal.timeout(5000) }).then(() => {}, () => {});
  async function call(box: Box, route: string, body: BodyInit, contentType?: string, ms = timeoutMs): Promise<any> {
    try {
      const res = await fetcher(`${base(box)}/sync${route}`, {
        method: "POST", body, headers: contentType ? { ...headers, "Content-Type": contentType } : headers, signal: AbortSignal.timeout(ms),
      });
      if (!res.ok) throw new Error(`Baseten ${box} answered ${res.status}`);
      return await res.json();
    } catch (error) {
      await wake(box);
      throw error;
    }
  }
  /** One OpenAI-style chat turn; `content` may carry an image. Returns the JSON in the reply. */
  async function chat(box: "brain" | "xray", model: string, system: string | null, content: unknown, maxTokens = 400) {
    const messages = [...system ? [{ role: "system", content: system }] : [], { role: "user", content }];
    const out = await call(box, "/v1/chat/completions", JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens }), "application/json");
    return out?.choices?.[0]?.message?.content as string | undefined;
  }
  return { call, chat };
}

export function basetenModels(options: Baseten, fallback: Models = stubModels): Models {
  const { call, chat } = boxes(options);
  const brain = async (system: string, user: string, maxTokens?: number) => jsonIn(await chat("brain", BRAIN_MODEL, system, user, maxTokens));

  return {
    ...fallback,
    ...chatModels(brain, BRAIN_MODEL, fallback),

    async transcribe(input) {
      try {
        const form = new FormData();
        form.append("model", ASR_MODEL);
        form.append("file", new Blob([input.audio], { type: "audio/wav" }), "speech.wav");
        // No language: Manglish switches language mid-sentence, and the fine-tuned model detects it.
        const out = await call("voice", "/v1/audio/transcriptions", form);
        return { text: String(out?.text ?? "").trim(), source: "model", model: ASR_MODEL };
      } catch { return fallback.transcribe(input); }
    },

    async briefing(input) {
      try {
        const { age, sex, complaint, history, family, social, allergies, medicines, vitals, incomplete } = input.patient;
        const read = await brain(BRIEFING, JSON.stringify({ age, sex, complaint, history, family, social, allergies, medicines, vitals, recordIncomplete: incomplete }));
        const lines = strings(read?.lines, 4);
        if (lines.length) {
          // Safety floor: a recorded allergy is always in the brief, whatever the model left out.
          const allergy = allergies?.split(" — ")[0];
          if (allergy && !lines.join(" ").toLowerCase().includes(allergy.toLowerCase())) lines.push(`Allergy recorded: ${allergy}.`);
          return { lines, source: "model", model: BRAIN_MODEL };
        }
      } catch { /* the stub below answers, labelled fixture */ }
      return fallback.briefing(input);
    },

    async synthesiseEvidence(input) {
      try {
        const sources = input.sources.map(s => `[${s.n}] (${s.design}${s.year ? `, ${s.year}` : ""}) ${s.title}\n${s.text}`).join("\n\n");
        const thread = input.thread.map(t => `Earlier question: ${t.question}\nEarlier answer: ${t.answer}`).join("\n");
        const read = await brain(EVIDENCE, `${thread ? `${thread}\n\n` : ""}Question: ${input.question}\n\nSources:\n${sources}`, 900);
        if (read && Array.isArray(read.claims)) {
          // The route drops claims citing nothing or a number outside the sources (sourcedClaims).
          const claims = read.claims.flatMap(c => typeof c?.text === "string" && Array.isArray(c.cites)
            ? [{ text: c.text.trim(), cites: c.cites.filter((n: unknown): n is number => Number.isInteger(n)) }] : []);
          return { claims, followUps: strings(read.followUps, 3), source: "model", model: BRAIN_MODEL };
        }
      } catch { /* falls back below */ }
      return fallback.synthesiseEvidence(input);
    },

    async xrayRead(input) {
      try {
        const reply = await chat("xray", XRAY_MODEL, null, [
          { type: "image_url", image_url: { url: `data:${input.contentType};base64,${base64(input.image)}` } },
          { type: "text", text: XRAY },
        ]);
        // MedGemma sometimes answers in plain sentences; keep them rather than lose the read.
        const findings = strings(jsonIn(reply)?.findings, 4);
        const read = findings.length ? findings : reply?.trim() ? [reply.trim().slice(0, 600)] : [];
        if (read.length) return { findings: read, validated: false, source: "model", model: XRAY_MODEL };
      } catch { /* falls back below */ }
      return fallback.xrayRead(input);
    },
  };
}

/**
 * bge-reranker-v2-m3 in box ②. When the box is asleep or slow, the hybrid order stands (scores fall in
 * rank order) so a search never fails on it, and the box is woken for the next one.
 */
export function basetenReranker(options: Baseten): Reranker {
  const { call } = boxes(options);
  return async (query, passages) => {
    try {
      const out = await call("voice", "/v1/rerank", JSON.stringify({ query, passages }), "application/json", 8000);
      if (Array.isArray(out?.scores) && out.scores.length === passages.length) return out.scores as number[];
    } catch { /* keeps the hybrid order below */ }
    return passages.map((_, i) => -i);
  };
}
