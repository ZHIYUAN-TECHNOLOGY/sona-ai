import type { AppealLetter, Code } from "@sona-ai/domain/claim";
import { planFor, type Language, type PlanRecord } from "@sona-ai/domain/discharge";
import type { Claim } from "@sona-ai/domain/evidence";
import { DRAFT_MAX } from "@sona-ai/domain/messages";
import { huddle } from "@sona-ai/domain/ward";

import { LANGUAGE_NAME, chatModels, jsonIn } from "./chat-models";
import { partialEvidence } from "./evidence-stream";
import { stubModels, type EvidenceAnswer, type EvidenceInput, type EvidencePart, type Models, type Origin } from "./models";
import { deltas } from "./sse";
import { piiModels } from "./pii-model";
import { scribeModels } from "./scribe-model";
import { chatLook, visionModels } from "./vision-models";

/**
 * Sona's models on the Baseten boxes (packages/infra/baseten, docs/handoff.md#baseten-boxes): Gemma in box ①,
 * speech in box ②, MedGemma in box ③, Laya on its CPU box (./ask-model). Boxes scale to zero and take minutes
 * to wake, so a box not known to be up gets a quick health check first; a cold one is woken and not waited for:
 * the stub answers at once, labelled fixture with `waking`, the minutes until the model should be ready. A call
 * that fails or times out also wakes its box and answers from the stub, so a failure is never shown as a model
 * reading. Methods not listed here stay on the stub.
 */
export const BOXES = { brain: "q9p7zn63", voice: "qvmgk79q", xray: "wdlp8jm3", laya: "qe2dp10q", pii: "w6py8mgq" } as const;
export type Box = keyof typeof BOXES;

/**
 * Minutes from cold to answering, rounded up so "about N min" errs long (docs/handoff.md#baseten-boxes): the GPU
 * boxes took 9–16 on 30 Sep, then brain ~10, voice ~30 and xray ~12 on 1 Oct; Laya 31 s, the PII box ~1.5 min.
 */
export const COLD_START_MIN: Record<Box, number> = { brain: 12, voice: 30, xray: 15, laya: 1, pii: 2 };
/** A box that answered is trusted for 4 minutes, inside the 5 idle minutes before it scales to zero. */
const READY_MS = 4 * 60_000;
/** What this isolate knows about each box (epoch ms): up until `readyUntil`; starting since `wakingSince`. */
export const boxState = new Map<Box, { readyUntil: number; wakingSince?: number; checkedAt?: number }>();
/** While a box is starting, its health is checked at most this often; every other call gets its stub at once. */
const RECHECK_MS = 60_000;

/** The box answered: up for the next 4 minutes, and no longer starting. */
export function answered(box: Box) {
  boxState.set(box, { readyUntil: Date.now() + READY_MS });
}
/** The box was found cold. A wake older than its cold start plus the 5 idle minutes has lapsed (it woke and slept again), so the count restarts. */
export function starting(box: Box) {
  const now = Date.now(), { wakingSince: since, checkedAt } = boxState.get(box) ?? {};
  boxState.set(box, { readyUntil: 0, checkedAt, wakingSince: since !== undefined && now - since < (COLD_START_MIN[box] + 5) * 60_000 ? since : now });
}
/** `{ waking }` in whole minutes (at least 1) while the box is starting; nothing when it is not known to be. */
export function wakingOf(box: Box): { waking?: number } {
  const since = boxState.get(box)?.wakingSince;
  return since === undefined ? {} : { waking: Math.max(1, Math.ceil(COLD_START_MIN[box] - (Date.now() - since) / 60_000)) };
}

// The names each box serves its model under (vLLM --served-model-name), also recorded as provenance.
export const BRAIN_MODEL = "gemma-4-26b-a4b";
export const ASR_MODEL = "sona-asr";
export const XRAY_MODEL = "medgemma-1.5-4b";
export const VOICE_MODEL = "sona-voxcpm2-malaysian";

/** Same shape as packages/retrieval's Reranker (that package imports this one, so it is not imported back). */
export type Reranker = (query: string, passages: string[]) => Promise<number[]>;

export type Baseten = { apiKey: string; fetcher?: typeof fetch; timeoutMs?: number };

const BRIEFING = `You brief a hospital doctor before they see a patient. Use ONLY the record below; never add a diagnosis, test result or number it does not state.
Answer with JSON only: {"lines": ["<one short sentence>", ...]}: 2 to 4 lines, most important first: why they came, what in the history or medicines matters today, any allergy, and anything missing from the record.`;

const EVIDENCE = `You answer a doctor's clinical question, from the numbered sources first.
Answer with JSON only: {"bottomLine": "<one sentence>", "claims": [{"text": "<one or two sentences>", "cites": [<source numbers>], "topic": "evidence" | "dose" | "harms", "quotes": [{"n": <source number>, "text": "<sentence copied from that source>"}]}], "followUps": ["<question>", ...], "general": "<only when there are no claims>"}
Rules:
- bottomLine: the direct answer to the question in one short sentence, drawn only from your claims.
- 2 to 4 claims, each supported by and citing at least one numbered source. Never state a dose, number or finding that a cited source does not contain.
- cites: the numbers in square brackets before the sources the claim rests on, as integers (never a PMID).
- topic: "dose" for doses and durations, "harms" for side effects and risks, otherwise "evidence".
- quotes: for each source a claim cites, copy the one sentence from that source that supports it, word for word.
- Say how strong each claim is in words from the source's design (a guideline recommends, a randomised trial found, a review concluded).
- If the sources do not answer the question, return no claims and answer in "general" from general medical knowledge, in one to three short sentences. You have not seen this patient's record: never state a fact about them.
- Up to 3 short follow-up questions these sources could answer.`;

const XRAY = `If this is not a chest radiograph, say so in one sentence. Otherwise list the findings a radiologist would report, most important first, in at most 4 short sentences.
Answer with JSON only: {"findings": ["<sentence>", ...]}`;

/*
 * The drafting methods below follow one rule: AI proposes, rules verify, a person decides. Each prompt holds
 * only the record or inputs given; the JSON back is validated, then checked by plain code (citations exist,
 * numbers come from the facts, medicines match the take-home list...). Anything that fails is replaced by
 * the stub's own rule or authored answer, labelled fixture, never shown unchecked.
 */
const REASONING = `You help a hospital doctor think before examining a patient. Use ONLY the record and sources below.
List 2 to 4 possibilities worth considering for the doctor's question: unranked, never stated as a diagnosis, never a treatment.
For each, one sentence on what in the record points to it, citing the id of every source it rests on.
Never state a finding, test result or number the record does not contain.
Answer with JSON only: {"possibilities": [{"title": "<2-5 words>", "why": "<one sentence>", "sources": ["<source id>"]}]}`;

const HUDDLE = `You write the three-line brief a charge nurse reads aloud at the ward huddle. FACTS are the ward's own count and are exact.
Write exactly 3 short spoken lines: where the ward stands, which bed to start with and what holds it, and who owns the blockers (or how many have no owner).
Use only numbers and beds that appear in FACTS, exactly as written; never add, round or combine a number.
Answer with JSON only: {"lines": ["<line>", "<line>", "<line>"]}`;

const REPLY = `You draft a short reply from a hospital care team to their patient's message, for a nurse to check before sending.
Rules:
- Write only in LANGUAGE: plain, kind, at most 3 short sentences and under 280 characters. Greet the patient by first name.
- Answer what they asked. For their own medicines and next visit, use their plan below and quote a medicine line exactly as written; anything else from general knowledge.
- Never promise a time or say when someone will call or reply: the care team decides that.
- If the label is urgent, tell them to call 999 or go to the nearest emergency department now.
Answer with JSON only: {"text": "<reply>"}`;

const CODING = `You code a hospital admission note for the insurer in WHO ICD-10. Pick codes ONLY from the candidates; never write any other code.
Code only what a note sentence states the patient has: skip anything negated, ruled out, only suspected, or in the family history.
One Principal code (the main reason for admission), other diagnoses Secondary, a procedure Procedure. Cite the id of the one sentence that states each,
and copy the exact words in it that name the condition. Choose the candidate whose meaning matches those words most exactly: a named condition, not a general one.
Answer with JSON only: {"codes": [{"code": "<candidate code>", "kind": "Principal" | "Secondary" | "Procedure", "evidence": "<sentence id>", "stated": "<the exact words>"}]}`;

const APPEAL = `You draft a hospital's appeal to an insurer that denied a final guarantee letter, for the doctor to check and edit before sending.
Use ONLY the note sentences and codes below. Calm and factual; answer the denial reason.
Answer with JSON only: {"opening": "<1-2 sentences naming the patient and the denial>", "points": [{"claim": "<one sentence>", "evidence": "<sentence id>"}], "closing": "<1-2 sentences asking for the denial to be withdrawn>"}
Rules:
- 2 to 4 points, each supported by and citing the one note sentence it rests on.
- Mention only the codes listed. Never add a number, date, test, finding or treatment that a sentence or code does not state.
- Quote only words the note sentences or the denial contain.`;

const DISCHARGE = `You draft a hospital discharge from the patient's record, for the doctor to check before signing.
Use ONLY the record below. Never add a diagnosis, result, dose, duration or number it does not state.
The take-home medicines are fixed: list exactly their names in "medicines", and name no other medicine in "plan" or "leaflet".
Answer with JSON only: {"diagnosis": "<one line>", "course": "<one or two lines>", "plan": "<one line>", "full": "<a short paragraph for the notes>", "leaflet": "<3 short sentences for the patient in LANGUAGE at a reading age of about 12: what they had, how to take their medicines, when to come back straight away>", "medicines": ["<take-home medicine name>"]}`;

const strings = (value: unknown, max: number) =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === "string" && s.trim() !== "").map(s => s.trim().slice(0, 300)).slice(0, max) : [];
const text = (value: unknown, max = 600) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** The numbers a text states, English number words included ("five" is 5). ponytail: Malay and Chinese number words are not read, digits are. */
const numbersIn = (s: string) =>
  s.toLowerCase().replace(new RegExp(`\\b(${NUMBER_WORDS.join("|")})\\b`, "g"), w => String(NUMBER_WORDS.indexOf(w))).match(/\d+(?:[.:]\d+)?/g) ?? [];
/** Every number the texts state is one the facts state: a model may reword the facts, never add to them. */
function onlyNumbersFrom(facts: string, ...texts: string[]) {
  const known = new Set(numbersIn(facts));
  return texts.every(t => numbersIn(t).every(n => known.has(n)));
}
/** ponytail: tells Chinese from not-Chinese only; Malay and English both pass either way. */
const inLanguage = (s: string, language: Language) => /[㐀-鿿]/.test(s) === (language === "zh");
const unique = <T>(values: T[]) => [...new Set(values)];

// A possibility worded as a ranking or a verdict is dropped: the card says "unranked, not a diagnosis".
const VERDICT = /\b(most likely|likeliest|leading|probable|definite(ly)?|confirms|confirmed|diagnosed|the diagnosis|certainly)\b/i;

// ponytail: a word list, not a reader: it misses a paraphrase, so the nurse's check before sending stays.
const PROMISED_TIME = /\b(today|tonight|tomorrow|this (morning|afternoon|evening)|within|in (an?|\d+) (minutes?|hours?)|by \d|\d+ ?[ap]\.?m\b)|hari ini|malam ini|esok|dalam masa|sejam|今天|今晚|明天|小时内|分钟内/i;
export const EMERGENCY = /999|emergency|kecemasan|急诊/i;

/**
 * A draft a nurse checks before sending: in the patient's language, short, urgent ones sent to 999, and no promise of
 * when the team will act. What it may talk about is not limited (the user lifted every content limit on 1 Oct).
 */
function safeReply(reply: string, input: Parameters<Models["draftReply"]>[0]) {
  return reply.length <= DRAFT_MAX && inLanguage(reply, input.language) && (input.label !== "urgent" || EMERGENCY.test(reply)) && !PROMISED_TIME.test(reply);
}

/**
 * The clinician's own name for a condition whose WHO label uses other words ("pyelonephritis" is N10, "Acute
 * tubulo-interstitial nephritis"; 5 Oct, real Gemma): the model's copied words are in the sentence, not negated, and
 * no candidate's label says those words itself (then the label check decides, so "pneumonia" cannot pass as "Lobar pneumonia").
 * The doctor reviews every code against its sentence before the letter goes.
 */
function namedIn(sentence: string, stated: unknown, candidates: { label: string }[]) {
  const words = typeof stated === "string" ? stated.trim().toLowerCase() : "";
  const at = words.length >= 4 ? sentence.toLowerCase().indexOf(words) : -1;
  return at >= 0 && !NOT_STATED.test(sentence.toLowerCase().slice(0, at).split(/[.;]/).pop()!) && !candidates.some(c => statedIn(words, c.label));
}

// Label words too general to show which code a sentence means ("Pneumonia, unspecified organism" is stated by "pneumonia").
const FILLER = new Set(["unspecified", "other", "organism", "status", "personal", "history", "routine", "without", "with", "agents", "substances", "biological", "medicaments", "drugs", "acute", "type"]);
// Negation, or someone else's condition (family history), earlier in the same clause.
const NOT_STATED = /\b(no|not|without|denies|denied|negative for|ruled out|free of|mother|father|family|sibling|tiada|tidak|bukan|tanpa|ibu|bapa|keluarga)\b|无|否认|排除|未见|母亲|父亲|家族/i;
/**
 * The sentence states the code's condition for this patient: every telling word of the label (its stem) is in
 * it ("Dengue fever" is not stated by "fever"), none with a negation or a relative before it in its clause.
 * ponytail: word stems and a negation window; OpenMed's extraction with negation replaces it (docs/delivery-plan.md).
 */
function statedIn(sentence: string, label: string) {
  const lower = sentence.toLowerCase();
  const words = label.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4 && !FILLER.has(w));
  return words.length > 0 && words.every(w => {
    const at = lower.search(new RegExp(`\\b${w.slice(0, Math.max(4, w.length - 2))}`));
    return at >= 0 && !NOT_STATED.test(lower.slice(0, at).split(/[.;]/).pop()!);
  });
}

/**
 * The sentence a model cites: Gemma writes "[diagnosis] Community-acquired…" as often as the bare id "diagnosis", and
 * on a note with one long section it quotes the words instead (5 Oct, real Gemma); a quote counts only when exactly one
 * sentence holds it.
 */
export function citedSentence<T extends { id: string; text?: string }>(raw: unknown, sentences: T[]) {
  const cited = String(raw ?? "").trim();
  const id = cited.match(/^\[([^\]]+)\]/)?.[1] ?? cited.split(/\s/)[0]!.replace(/[[\]:,.]/g, "");
  const named = sentences.find(s => s.id === id || s.id === cited);
  if (named || cited.length < 12) return named;
  const quoted = sentences.filter(s => s.text?.includes(cited));
  return quoted.length === 1 ? quoted[0] : undefined;
}

const CODE_LIKE = /\b[A-Z]\d{2}(?:\.\d{1,2})?\b|\b\d{2}\.\d{2}\b/g;
/** An appeal that says only what it was given: every point cites a real sentence, and its codes, quotes and numbers are the note's. */
function faithfulAppeal(letter: AppealLetter, input: Parameters<Models["draftAppeal"]>[0]) {
  const all = [letter.opening, ...letter.points.map(p => p.claim), letter.closing].join(" ");
  const given = [input.denialReason, ...input.sentences.map(s => s.text), ...input.codes.map(c => `${c.code} ${c.label}`)].join(" ");
  const codes = new Set(input.codes.map(c => c.code));
  const quotes = [...all.matchAll(/[“"]([^”"]{4,})[”"]/g)].map(m => m[1]!.toLowerCase());
  return letter.points.every(p => p.claim && input.sentences.some(s => s.id === p.evidenceSentenceId))
    && (all.match(CODE_LIKE) ?? []).every(c => codes.has(c))
    && quotes.every(q => given.toLowerCase().includes(q))
    && onlyNumbersFrom(given, all);
}

function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function boxes({ apiKey, fetcher = fetch, timeoutMs = 30_000 }: Baseten) {
  const base = (box: Box) => `https://model-${BOXES[box]}.api.baseten.co/environments/production`;
  const headers = { Authorization: `Api-Key ${apiKey}` };
  /** Starts a sleeping box without waiting for it (a wake answers at once). */
  const wake = (box: Box) => fetcher(`${base(box)}/wake`, { method: "POST", headers, signal: AbortSignal.timeout(5000) }).then(() => {}, () => {});
  /** Up if it answered in the last 4 minutes, or its health route says 200 within 2.5 s (a cold box holds a request open). */
  async function up(box: Box) {
    const state = boxState.get(box);
    if ((state?.readyUntil ?? 0) > Date.now()) return true;
    // Starting and checked within the minute: still starting, without holding this caller for another health check.
    if (state?.wakingSince !== undefined && Date.now() - (state.checkedAt ?? 0) < RECHECK_MS) return false;
    const ok = await fetcher(`${base(box)}/sync/health`, { headers, signal: AbortSignal.timeout(2500) }).then(res => res.status === 200, () => false);
    if (ok) answered(box);
    else boxState.set(box, { ...(boxState.get(box) ?? { readyUntil: 0 }), checkedAt: Date.now() });
    return ok;
  }
  /** No longer known to be up: the next call checks its health first. */
  const down = (box: Box) => { boxState.delete(box); return wake(box); };
  /**
   * One request, answered as it arrives. `signal` lets the caller hang up (a patient interrupting Sona Care's live
   * voice): that is not the box failing, so the box is not marked down for it.
   */
  async function send(box: Box, route: string, body: BodyInit, contentType?: string, ms = timeoutMs, signal?: AbortSignal): Promise<Response> {
    // A cold box is not waited for (a request held open through a wake gets reset anyway): the caller's stub answers now.
    if (!await up(box)) {
      starting(box);
      await wake(box);
      throw new Error(`Baseten ${box} is starting`);
    }
    try {
      const res = await fetcher(`${base(box)}/sync${route}`, {
        method: "POST", body, headers: contentType ? { ...headers, "Content-Type": contentType } : headers,
        signal: signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms),
      });
      if (!res.ok) throw new Error(`Baseten ${box} answered ${res.status}`);
      return res;
    } catch (error) {
      if (!signal?.aborted) await down(box);
      throw error;
    }
  }
  async function call(box: Box, route: string, body: BodyInit, contentType?: string, ms = timeoutMs): Promise<any> {
    const res = await send(box, route, body, contentType, ms);
    try {
      // The voice box answers /v1/tts with audio bytes (MP3); every other route answers JSON.
      const out = res.headers.get("content-type")?.startsWith("audio/") ? new Uint8Array(await res.arrayBuffer()) : await res.json();
      answered(box);
      return out;
    } catch (error) {
      await down(box);
      throw error;
    }
  }
  /** One OpenAI-style chat turn; `content` may carry an image. Returns the JSON in the reply. */
  async function chat(box: "brain" | "xray", model: string, system: string | null, content: unknown, maxTokens = 400) {
    const messages = [...system ? [{ role: "system", content: system }] : [], { role: "user", content }];
    const out = await call(box, "/v1/chat/completions", JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens }), "application/json");
    return out?.choices?.[0]?.message?.content as string | undefined;
  }
  return { call, chat, wake, send, up };
}

export function basetenModels(options: Baseten, fallback: Models = stubModels): Models {
  const { call, chat, send } = boxes(options);
  const brain = async (system: string, user: string, maxTokens?: number) => jsonIn(await chat("brain", BRAIN_MODEL, system, user, maxTokens));

  const hosted: Partial<Models> = {
    ...chatModels(brain, BRAIN_MODEL, fallback),
    ...scribeModels(call, BRAIN_MODEL, fallback),
    // The photo, film and handwriting readers: MedGemma in box ③ (box ①'s Gemma takes no images).
    ...visionModels(chatLook(body => call("xray", "/v1/chat/completions", body, "application/json"), XRAY_MODEL), XRAY_MODEL, fallback),
    ...piiModels((route, body) => call("pii", route, body, "application/json"), fallback),

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

    // The settings the round-4 listening test was rated on are the gateway's defaults, so only the text goes.
    async speak(input) {
      try {
        const audio = await call("voice", "/v1/tts", JSON.stringify({ text: input.text }), "application/json");
        if (audio instanceof Uint8Array && audio.length > 44) return { audio: base64(audio), source: "model", model: VOICE_MODEL };
      } catch { /* the phone's voice reads it */ }
      return fallback.speak(input);
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
        const asked = evidenceQuestion(input);
        const out = await call("brain", "/v1/chat/completions", JSON.stringify(evidenceChat(asked.content)), "application/json", EVIDENCE_MS);
        const choice = out?.choices?.[0];
        const read = evidenceRead(choice?.message?.content, asked.shown, choice?.finish_reason === "length");
        if (read) return { ...read, source: "model", model: BRAIN_MODEL };
      } catch { /* falls back below */ }
      return fallback.synthesiseEvidence(input);
    },

    // Each possibility must cite a record source it was given; an uncited or verdict-worded one is dropped.
    async reasoning(input) {
      try {
        const { age, sex, complaint, history, allergies, medicines, vitals } = input.patient;
        const sources = (input.patient.sources ?? []).filter(s => s.kind === "record" || s.kind === "transcript");
        const facts = `Record: ${JSON.stringify({ age, sex, complaint, history, allergies, medicines, vitals })}\n\nSources:\n${sources.map(s => `[${s.id}] ${s.title}: ${s.excerpt}`).join("\n")}\n\nQuestion: ${input.question}`;
        const read = await brain(REASONING, facts, 600);
        const ids = new Set(sources.map(s => s.id));
        const kept = (Array.isArray(read?.possibilities) ? read.possibilities : []).flatMap(p => {
          const title = text(p?.title, 60)?.replace(/:/g, ""), why = text(p?.why, 300);
          const cites: string[] = Array.isArray(p?.sources) ? unique(p.sources.filter((id: unknown): id is string => typeof id === "string" && ids.has(id))) : [];
          return title && why && cites.length && !VERDICT.test(`${title} ${why}`) && onlyNumbersFrom(facts, title, why) ? [{ title, why, cites }] : [];
        }).slice(0, 4);
        // One possibility per line, "Title: why" (the app lists them); the cited sources once each.
        if (kept.length) return { answer: kept.map(p => `${p.title}: ${p.why}`).join("\n"), sourceIds: unique(kept.flatMap(p => p.cites)), source: "model", model: BRAIN_MODEL };
      } catch { /* falls back below */ }
      return fallback.reasoning(input);
    },

    // Gemma words the brief; every number in it must be one the rule counted.
    async huddleBrief(input) {
      try {
        const facts = huddle(input.beds, input.owners);
        const blockers = input.beds.filter(b => b.status === "fit").flatMap(b => b.blockers.map(x => ({ blocker: x.label, owner: input.owners[x.id] ?? "none" })));
        const read = await brain(HUDDLE, `FACTS:\n${facts.join("\n")}\n\nBlockers and owners: ${JSON.stringify(blockers)}`);
        const lines = strings(read?.lines, 3);
        if (lines.length === 3 && onlyNumbersFrom(facts.join(" "), ...lines)) return { lines, source: "model", model: BRAIN_MODEL };
      } catch { /* the rule's lines below */ }
      return fallback.huddleBrief(input);
    },

    async draftReply(input) {
      try {
        const plan = [...input.plan?.medicines.map(m => `${m.name}: ${m.line}`) ?? [], ...input.plan?.nextVisit ? [`Next visit: ${input.plan.nextVisit}`] : []].join("\n");
        const read = await brain(REPLY.replace("LANGUAGE", LANGUAGE_NAME[input.language]),
          `Label: ${input.label}\nFirst name: ${input.patientFirstName}\nPlan:\n${plan || "(none)"}\n\nPatient's message: """${input.text}"""`);
        const reply = typeof read?.text === "string" ? read.text.trim() : "";
        if (reply && safeReply(reply, input)) return { text: reply, source: "model", model: BRAIN_MODEL };
      } catch { /* the template below */ }
      return fallback.draftReply(input);
    },

    // Candidates: the rules' codes plus the route's WHO table hits. A code outside them, citing no sentence, or negated there is dropped.
    async suggestCodes(input) {
      try {
        const ruled = (await fallback.suggestCodes({ sentences: input.sentences })).codes;
        const candidates = new Map<string, { code: string; label: string; kind?: Code["kind"] }>([...input.candidates ?? [], ...ruled].map(c => [c.code, c] as const));
        const read = await brain(CODING, `Note sentences:\n${input.sentences.map(s => `[${s.id}] ${s.text}`).join("\n")}\n\nCandidates:\n${[...candidates.values()].map(c => `${c.code} ${c.label}${c.kind === "Procedure" ? " (procedure)" : ""}`).join("\n")}`);
        const codes: Code[] = [];
        for (const c of Array.isArray(read?.codes) ? read.codes : []) {
          // Gemma numbers the sentences as often as it names them ("3" for "assessment"): then the words it copied find the sentence.
          const candidate = candidates.get(c?.code), sentence = citedSentence(c?.evidence, input.sentences) ?? citedSentence(c?.stated, input.sentences);
          if (!candidate || !sentence || codes.some(x => x.code === candidate.code)) continue;
          if (!statedIn(sentence.text, candidate.label) && !namedIn(sentence.text, c?.stated, [...candidates.values()])) continue;
          // Only a rule's procedure is a procedure; one Principal at most.
          const kind = candidate.kind === "Procedure" ? "Procedure" : c.kind === "Principal" && !codes.some(x => x.kind === "Principal") ? "Principal" : "Secondary";
          codes.push({ code: candidate.code, label: candidate.label, kind, evidence: sentence.id });
        }
        if (codes.length) return { codes, source: "model", model: BRAIN_MODEL };
      } catch { /* the rules below */ }
      return fallback.suggestCodes(input);
    },

    async draftAppeal(input) {
      try {
        const codes = input.codes.map(c => `${c.code} ${c.label} (${c.kind}, sentence ${c.evidence})`).join("\n");
        const read = await brain(APPEAL, `Patient: ${input.patient.name}\nDenial (${input.denialCode}): ${input.denialReason}\n\nCodes:\n${codes}\n\nNote sentences:\n${input.sentences.map(s => `[${s.id}] ${s.text}`).join("\n")}`, 800);
        const opening = text(read?.opening), closing = text(read?.closing);
        const points = (Array.isArray(read?.points) ? read.points : []).map(p => ({ claim: text(p?.claim, 400) ?? "", evidenceSentenceId: citedSentence(p?.evidence, input.sentences)?.id ?? String(p?.evidence ?? "") }));
        if (opening && closing && points.length && points.length <= 4) {
          const letter = { opening, points, closing };
          if (faithfulAppeal(letter, input)) return { letter, source: "model", model: BRAIN_MODEL };
        }
      } catch { /* the rules below */ }
      return fallback.draftAppeal(input);
    },

    // The take-home list is the plan's (reconciled by rules), so the model words it and never changes it.
    async draftDischarge(input) {
      try {
        const patient: PlanRecord & typeof input.patient = input.patient;
        const plan = planFor(patient);
        const takeHome = plan.meds.filter(m => m.change !== "stopped"), stopped = plan.meds.filter(m => m.change === "stopped");
        const { age, sex, complaint, history, allergies, medicines, vitals } = patient;
        const record = JSON.stringify({ age, sex, complaint, history, allergies, medicinesBeforeAdmission: medicines, vitals, ward: patient.ward?.sbar,
          takeHome: takeHome.map(m => `${m.name}: ${m.detail}`), stopped: stopped.map(m => `${m.name}: ${m.detail}`) });
        const read = await brain(DISCHARGE.replace("LANGUAGE", LANGUAGE_NAME[input.language]), `Record: ${record}`, 1000);
        const lines = { diagnosis: text(read?.diagnosis, 200), course: text(read?.course, 300), plan: text(read?.plan, 200) };
        const full = text(read?.full, 1200), leaflet = text(read?.leaflet);
        const listed = new Set(strings(read?.medicines, 20).map(m => m.toLowerCase()));
        const told = `${lines.plan} ${leaflet}`.toLowerCase();
        if (lines.diagnosis && lines.course && lines.plan && full && leaflet
          && listed.size === takeHome.length && takeHome.every(m => listed.has(m.name.toLowerCase()))
          && !stopped.some(m => told.includes(m.name.toLowerCase()))
          && inLanguage(leaflet, input.language)
          && onlyNumbersFrom(record, lines.diagnosis, lines.course, lines.plan, full, leaflet)) {
          return { summary: full, leaflet, lines: { diagnosis: lines.diagnosis, course: lines.course, plan: lines.plan }, source: "model", model: BRAIN_MODEL };
        }
      } catch { /* the plan below */ }
      return fallback.draftDischarge(input);
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

  // A stub answer from a hosted method whose box is starting says when to expect the model. Box ② hears and speaks, box ③
  // sees, the PII box de-identifies, box ① writes the rest; the stub-only methods are not hosted, so nothing is starting for them.
  const withWaking = Object.entries(hosted).map(([method, run]) => {
    const box: Box = method === "transcribe" || method === "speak" ? "voice"
      : ["xrayRead", "readMedicinePhoto", "incidentalFindings", "readHandwrittenNote"].includes(method) ? "xray"
      : method === "deidentify" ? "pii" : "brain";
    return [method, async (input: never) => {
      const answer = await (run as (input: never) => Promise<Origin>)(input);
      return answer.source === "fixture" ? { ...answer, ...wakingOf(box) } : answer;
    }] as const;
  });
  const wrapped: Models = { ...fallback, ...Object.fromEntries(withWaking) };

  /**
   * The evidence answer as Gemma writes it: the bottom line, then each claim as it closes, then the whole answer read and
   * checked as `synthesiseEvidence` reads it. Outside the waking wrapper (it streams); a box that is starting or fails
   * gives the whole answer from `synthesiseEvidence` instead, which says when the box will be up.
   */
  async function* streamEvidence(input: EvidenceInput): AsyncGenerator<EvidencePart, Awaited<ReturnType<Models["synthesiseEvidence"]>>> {
    try {
      const asked = evidenceQuestion(input);
      const res = await send("brain", "/v1/chat/completions", JSON.stringify({ ...evidenceChat(asked.content), stream: true }), "application/json", EVIDENCE_MS);
      let written = "", bottom = false, sent = 0, cut = false;
      for await (const delta of deltas(res.body!, reason => { answered("brain"); cut = reason === "length"; })) {
        written += delta;
        const part = partialEvidence(written);
        if (!bottom && part.bottomLine?.trim()) { bottom = true; yield { bottomLine: part.bottomLine.trim().slice(0, 240) }; }
        for (const claim of evidenceOf({ claims: part.claims.slice(sent) }, asked.shown).claims) yield { claim };
        sent = part.claims.length;
      }
      // Read as the whole call reads it, with the stream's finish reason (./sse): an answer cut at the length limit is
      // marked cut short even if its JSON happened to close; one that never closed keeps the claims that did, also marked;
      // none closed, and it is asked whole.
      const read = evidenceRead(written, asked.shown, cut);
      if (read) return { ...read, source: "model", model: BRAIN_MODEL };
    } catch { /* the whole answer below */ }
    return await wrapped.synthesiseEvidence(input);
  }
  return { ...wrapped, streamEvidence };
}

/**
 * The evidence prompt's size. Gemma's box reads 16,384 tokens in all (vLLM --max-model-len, packages/infra/baseten/brain
 * and aws/brain), the answer included. The answer gets 2,000: four claims of two sentences, each with a copied sentence
 * from up to three sources, run to about 1,800 (900 cut answers off mid-claim). The rest, less 384 for the chat
 * template, is the prompt, counted at 3 characters a token.
 * ponytail: characters stand in for tokens (no tokenizer in the Worker). English abstracts run nearer 4 a token, so
 * this errs short; a Chinese library passage is nearer 1, and a prompt full of them would be refused by the box
 * (said as the model not answering). Count with the model's tokenizer if the library goes multilingual.
 */
const CONTEXT_TOKENS = 16_384, EVIDENCE_MAX_TOKENS = 2000, CHARS_PER_TOKEN = 3;
const PROMPT_CHARS = (CONTEXT_TOKENS - EVIDENCE_MAX_TOKENS - 384) * CHARS_PER_TOKEN;
/** 2,000 tokens can take longer to write than the 30 s other calls get. */
const EVIDENCE_MS = 60_000;
const evidenceChat = (content: string) => ({ model: BRAIN_MODEL, messages: [{ role: "system", content: EVIDENCE }, { role: "user", content }], temperature: 0.1, max_tokens: EVIDENCE_MAX_TOKENS });

type EvidenceSource = EvidenceInput["sources"][number];

/** The start of `text` that fits in `max` characters without ending mid-sentence; "" when not even its first sentence fits. */
function wholeSentences(text: string, max: number) {
  if (text.length <= max) return text;
  // ponytail: a full stop before a space ends a sentence, so "vs. placebo" can end one early; nothing is cut inside a number.
  const end = [...text.slice(0, Math.max(0, max + 1)).matchAll(/[.!?](?=\s)/g)].at(-1);
  return end ? text.slice(0, end.index + 1) : "";
}

/**
 * The question, the thread so far and the numbered sources, as the evidence prompt reads them, and the sources that are
 * in it. Sources come ranked (PubMed's best evidence first, then the library's passages), so each goes in whole while
 * there is room; the first that does not fit is cut at a sentence end and the ones after it are left out (`shown` has
 * neither, so a claim cannot cite what the model never read).
 */
function evidenceQuestion(input: EvidenceInput) {
  const thread = input.thread.map(t => `Earlier question: ${t.question}\nEarlier answer: ${t.answer}`).join("\n");
  const head = `${thread ? `${thread}\n\n` : ""}Question: ${input.question}\n\nSources:\n`;
  let room = PROMPT_CHARS - EVIDENCE.length - head.length;
  const shown: EvidenceSource[] = [], blocks: string[] = [];
  for (const s of input.sources as EvidenceSource[]) {
    const title = `[${s.n}] (${[s.design, s.year, s.from, s.pmid && `PMID ${s.pmid}`].filter(Boolean).join(", ")}) ${s.title}\n`;
    const text = wholeSentences(s.text, room - title.length - 2);
    if (!text && s.text) break;
    blocks.push(title + text); shown.push(s); room -= title.length + text.length + 2;
  }
  return { content: head + blocks.join("\n\n"), shown };
}

/**
 * The sources a citation names, however Gemma wrote it: 1, "1", "[1, 2]", "[1][2]", "(1)", "Source 2", or a study's PMID
 * in place of its number. Only numbers of sources that were in the prompt come back: anything else names nothing.
 */
function citedSources(raw: unknown, sources: { n: number; pmid?: string }[]): number[] {
  const numbers = [raw].flat(3).flatMap(c => (typeof c === "number" ? [c] : typeof c === "string" ? (c.match(/\d+/g) ?? []).map(Number) : []));
  return [...new Set(numbers.flatMap(n => { const s = sources.find(s => s.n === n) ?? sources.find(s => s.pmid === String(n)); return s ? [s.n] : []; }))];
}
// Citations written into a claim's own sentence: "[1]", "[1, 2]", "[PMID 25608756]" anywhere (never "[95% CI 1.2 to 3]"), "(1)" only at its end.
const INLINE_CITES = /\s*\[\s*(?:(?:PMID|source)?:?\s*\d+\s*[,;]?\s*)+\]|\s*\(\s*(?:\d{1,2}\s*[,;]?\s*)+\)(?=[\s.]*$)/gi;

/**
 * Gemma's evidence JSON as an answer: claims with text and cites, up to 3 follow-ups, the general answer and the bottom
 * line. A claim's citations are read from its `cites` however they are written, and from its own sentence (then taken
 * out of it, since the card shows them as pills); a claim left citing no source that was in the prompt is dropped here,
 * never shown uncited. The route checks again (sourcedClaims), and keeps only quotes the cited source says (quotedClaims).
 */
function evidenceOf(read: Record<string, unknown>, shown: EvidenceSource[]): EvidenceAnswer {
  const claims = (Array.isArray(read.claims) ? read.claims : []).flatMap((c: { text?: unknown; cites?: unknown; topic?: unknown; quotes?: unknown }) => {
    if (typeof c?.text !== "string") return [];
    const cites = citedSources([c.cites, c.text.match(INLINE_CITES) ?? []], shown);
    const quotes = Array.isArray(c.quotes) ? c.quotes.flatMap((q: { n?: unknown; text?: unknown }) => { const [n] = citedSources(q?.n, shown); return n && typeof q?.text === "string" ? [{ n, text: q.text }] : []; }) : undefined;
    return cites.length ? [{ text: c.text.replace(INLINE_CITES, "").trim(), cites, topic: c.topic as Claim["topic"], quotes }] : [];
  });
  return { claims, followUps: strings(read.followUps, 3), general: text(read.general), bottomLine: text(read.bottomLine, 240) };
}

/**
 * What Gemma wrote, as an answer; undefined when it is no answer at all. An answer whose JSON closed is read whole. One
 * that did not (it hit the length limit, `cut`, or the reply broke off) is never read as complete: the claims that
 * closed before the cut are kept, each still whole and cited, and the answer says it was cut short; with none, it is no answer.
 */
function evidenceRead(written: unknown, shown: EvidenceSource[], cut = false): EvidenceAnswer | undefined {
  const read = jsonIn(written);
  if (read && (Array.isArray(read.claims) || typeof read.general === "string")) return { ...evidenceOf(read, shown), ...cut && { cutShort: true } };
  const part = partialEvidence(typeof written === "string" ? written : "");
  const kept = evidenceOf({ claims: part.claims, bottomLine: part.bottomLine }, shown);
  return kept.claims.length ? { ...kept, cutShort: true } : undefined;
}

/**
 * bge-reranker-v2-m3 in box ②. When the box is asleep or slow it throws, and the box is woken for the next search:
 * the search keeps its hybrid order and says the ranking did not run (packages/retrieval), where returning stand-in
 * scores passed that order off as ranked.
 */
export function basetenReranker(options: Baseten): Reranker {
  const { call } = boxes(options);
  return async (query, passages) => {
    const out = await call("voice", "/v1/rerank", JSON.stringify({ query, passages }), "application/json", 8000);
    if (Array.isArray(out?.scores) && out.scores.length === passages.length) return out.scores as number[];
    throw new Error("The reranker gave no scores");
  };
}
