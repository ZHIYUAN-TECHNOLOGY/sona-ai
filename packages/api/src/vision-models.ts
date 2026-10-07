import { readBoxes, type DetectedFinding } from "@sona-ai/domain/findings";
import type { HandwrittenNote, MedicineChange, ScanMedicine, ScanSections, ScanTask } from "@sona-ai/domain/scan";

import { jsonIn } from "./chat-models";
import type { Models } from "./models";

/**
 * The image readers (wave 3): a medicine photo, findings beyond the question on a chest film, a handwritten note.
 * MedGemma 1.5 reads the pixels (box ③); Gemma 4's box is text-only (vLLM --limit-mm-per-prompt.image 0), so it
 * cannot. Same rule as every model answer: AI proposes, rules verify, a person decides. Each reply is parsed and
 * checked by plain code against what the model itself read off the image; anything that fails falls back to the
 * stub's authored answer, labelled fixture. None of these is a validated read.
 */

/** A token the model wrote, how sure it was, and the tokens it nearly wrote instead. */
export type Token = { text: string; p: number; rivals: { text: string; p: number }[] };
/**
 * One look at an image (or at text alone). `prefill` starts the answer, which also makes MedGemma answer at once
 * instead of thinking aloud for 10 s; `text` includes it. `logprobs` returns the tokens with their rivals.
 */
export type Look = (ask: { image?: { bytes: Uint8Array; contentType: string }; prompt: string; prefill?: string; maxTokens: number; logprobs?: boolean }) => Promise<{ text: string; tokens?: Token[] }>;

// ponytail: the same chunked encoder as baseten-models and messages; importing it from there would be a cycle.
function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A `Look` over an OpenAI-style chat completions route (vLLM): `post` sends the JSON body and returns the reply. */
export function chatLook(post: (body: string) => Promise<any>, model: string): Look {
  return async ({ image, prompt, prefill, maxTokens, logprobs }) => {
    const content = image ? [{ type: "image_url", image_url: { url: `data:${image.contentType};base64,${base64(image.bytes)}` } }, { type: "text", text: prompt }] : prompt;
    const out = await post(JSON.stringify({
      model, temperature: 0, max_tokens: maxTokens,
      messages: [{ role: "user", content }, ...prefill ? [{ role: "assistant", content: prefill }] : []],
      // vLLM carries on from the prefill instead of opening a new turn.
      ...prefill ? { continue_final_message: true, add_generation_prompt: false } : {},
      ...logprobs ? { logprobs: true, top_logprobs: 3 } : {},
    }));
    const choice = out?.choices?.[0];
    const tokens = Array.isArray(choice?.logprobs?.content) ? (choice.logprobs.content as { token: string; logprob: number; top_logprobs?: { token: string; logprob: number }[] }[]).map(t => ({
      text: t.token, p: Math.exp(t.logprob), rivals: (t.top_logprobs ?? []).filter(r => r.token !== t.token).map(r => ({ text: r.token, p: Math.exp(r.logprob) })),
    })) : undefined;
    return { text: `${prefill ?? ""}${choice?.message?.content ?? ""}`, tokens };
  };
}

/** The answer after MedGemma's thinking (`<unused94>thought … <unused95>`); none when it never stopped thinking (it can loop). */
const afterThought = (reply: string) => reply.includes("<unused94>") && !reply.includes("<unused95>") ? "" : reply.split("<unused95>").pop()!;
const words = (s: string) => s.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? [];
const digitsIn = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];
/** Every number in `said` is one the model read off the image (`read`): a reading may reword, never add a number. */
const numbersFrom = (read: string, said: string) => { const known = new Set(digitsIn(read)); return digitsIn(said).every(n => known.has(n)); };
const str = (v: unknown, max: number) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/*
 * Medicines, as both readers return them. A name is 1 to 4 words of letters (a digit only inside a word, as in
 * "B12"), never a sentence; a dose is a number with its unit. ponytail: shape checks, not a formulary; the patient
 * and the care team (or the doctor) check every reading against the photo, and a formulary lookup replaces these.
 */
const DOSE = /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|micrograms?|g|ml|units?|iu|%)(?![a-z])(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*(ml|dose|puffs?|tablets?)(?![a-z]))?/i;
const FORM = /\b(film-coated|tablets?|capsules?|caplets?|oral|solution|suspension|syrup|for|use)\b/gi;
const NOT_A_NAME = /\b(the|a|an|this|that|is|are|was|take|taken|no|not|none|unknown|unclear|unreadable|medicine|medication|photo|image|cannot|unable|please|patient|clinic|review|ward|bed|bloods|follow)\b/i;
/** "AMLODIPINE 5 mg tablets" → "Amlodipine": the name without its strength or form, all-capitals print in title case. */
function medicineName(raw: string) {
  const name = raw.replace(new RegExp(DOSE.source, "gi"), " ").replace(FORM, " ").replace(/[^\p{L}\d\s/-]/gu, " ").replace(/\s+/g, " ").trim()
    .split(" ").map(w => w.length > 3 && w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w).join(" ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}
// The ingredient (first word) has at least 4 letters: "TCA" in a note is "to come again", not a medicine.
const looksLikeMedicine = (name: string) => /^\p{L}[\p{L}\d/-]*(?: [\p{L}\d/-]+){0,3}$/u.test(name) && (name.split(" ")[0]!.match(/\p{L}/gu) ?? []).length >= 4 && !NOT_A_NAME.test(name);
/** "500mg" → "500 mg" ("1%" stays), or nothing when it is not a number with a unit. */
function doseIn(raw: string) {
  const m = raw.trim().match(new RegExp(`^${DOSE.source}`, "i"));
  return m ? `${m[1]}${m[2] === "%" ? "" : " "}${m[2]!.toLowerCase()}${m[4] ? `/${m[3] ?? ""}${m[3] ? " " : ""}${m[4].toLowerCase()}` : ""}` : undefined;
}
// Words that say how often, each on its own ("three times a day" holds "times" and "day").
const FREQUENCY = /\b(once|twice|times|daily|day|every|hours?|hourly|morning|night|nightly|evening|bedtime|weekly|week|needed|required|od|bd|bid|tds|tid|qid|qds|prn|nocte|mane)\b/i;

/**
 * One medicine from a photo's reading, only as printed: the name's words and the dose's number must be among the
 * words it read off the photo, and a frequency only when the photo states one (boxes rarely do; a label does).
 */
function medicineIn(reply: string): { name: string; dose?: string; frequency?: string } | undefined {
  const read = jsonIn(reply);
  const printed = str(read?.printed, 600), seen = new Set(words(printed));
  const name = medicineName(str(read?.name, 60));
  if (!looksLikeMedicine(name) || !words(name).every(w => seen.has(w))) return undefined;
  const dose = doseIn(str(read?.dose, 40)), how = str(read?.frequency, 60);
  const frequency = how && FREQUENCY.test(how) && words(how).some(w => FREQUENCY.test(w) && seen.has(w)) ? how : undefined;
  return { name, ...dose && numbersFrom(printed, dose) ? { dose } : {}, ...frequency ? { frequency } : {} };
}

const MEDICINE_PHOTO = `This photo should show one medicine: a box, a blister strip, a pharmacy label or a letter. Read it exactly as printed.
Answer with JSON only: {"printed": "<all the words you can read on it>", "name": "<the medicine's name as printed: the generic name if shown, else the brand>", "dose": "<the strength with its unit, e.g. 10 mg>", "frequency": "<how often to take it, only if the photo says so>"}
Leave a field "" when the photo does not show it. If there is no medicine on the photo, answer {"printed": "", "name": ""}.`;

// MedGemma classifies a film well and places boxes less well, so it says what is there first, then where each one is.
const FINDINGS = `You are reading a frontal chest X-ray for findings beyond the question it was taken for.
Remember "left" is the patient's left side, where the heart is, on the right side of the image.
Answer with JSON only: {"cardiomegaly": true | false, "effusion": "none" | "left" | "right" | "both", "nodule": "none" | "<where: right or left, upper, middle or lower zone>", "nodule_mm": <estimated size in mm, or 0>}
Say a finding is present only if you can see it on this image.`;
// MedGemma 1.5's own localisation prompt (Google's anatomy localisation notebook): boxes as [y0, x0, y1, x1] in thousandths.
const LOCATE = (what: string) => `Instructions:
The following user query will require outputting bounding boxes. The format of bounding boxes coordinates is [y0, x0, y1, x1] where (y0, x0) must be top-left corner and (y1, x1) the bottom-right corner. This implies that x0 < x1 and y0 < y1. Always normalize the x and y coordinates the range [0, 1000], meaning that a bounding box starting at 15% of the image width would be associated with an x coordinate of 150. You MUST output a single parseable json list of objects enclosed into \`\`\`json...\`\`\` brackets, for instance \`\`\`json[{"box_2d": [800, 3, 840, 471], "label": "car"}, {"box_2d": [400, 22, 600, 73], "label": "dog"}]\`\`\` is a valid output. Now answer to the user query.

Remember "left" refers to the patient's left side where the heart is and on the right side of the image.

Query: Where is ${what}? Output the final answer in the format "Final Answer: X". where X is a JSON list of objects. The object needs a "box_2d" and "label" key. Answer:`;
const ZONE = /^(right|left) (upper|middle|mid|lower) zone$/i;

const DOCUMENT_PAGE = `This is one page of a printed hospital document: a guideline, a leaflet or a reference. Transcribe every word printed on it exactly as written, in the language it is written in (English, Malay, Chinese or mixed). Never translate, summarise or add anything.
Keep each heading on its own line starting with "## ". Mark a word you cannot read as [?].
If the page has no text, answer exactly: NO TEXT`;
const NOTE_READ = `This is a photo of a handwritten hospital note: a ward-round note, a drug chart or a referral letter.
Transcribe only the handwriting, line by line, exactly as written: keep abbreviations, numbers, symbols and line breaks. Leave out printed headings.
Answer with the transcription only.`;
// Sorting the transcription is a second, text-only turn: the record is built from exactly the words read, so each can be checked against them.
const NOTE_SORT = `You sort a transcribed handwritten hospital note (a ward-round note, drug chart or referral letter) into the record, for the doctor to review.
Use ONLY the note's own words: copy them exactly, keeping abbreviations. Never add a word, number, dose, medicine or task the note does not contain.
Answer with JSON only:
{"sections": {"history": "<what the patient reports and the background>", "examination": "<observations and examination>", "assessment": "<the impression or diagnosis>", "plan": "<the plan>"},
 "medicines": [{"name": "<medicine>", "dose": "<dose as written, e.g. 500mg>", "frequency": "<as written, e.g. BD>", "change": "new" | "changed" | "stopped" | "continue"}],
 "tasks": [{"title": "<a test or job to do>", "due": "<when, as written>", "owner": "<who, if written>"}],
 "followUp": "<when to review the patient, e.g. 2/52, or empty>"}
- A section the note does not cover is "".
- medicines: every medicine the note starts, changes, stops or continues. "new" if started, "changed" if the dose, route or frequency changes, "stopped" if stopped, "continue" if kept as it is.
- tasks: tests and jobs for the team (e.g. bloods, scans, referrals); not medicines and not the follow-up review.

Note:
`;

const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\d]/gu, "");
/**
 * Does the model doubt this token? Only when a rival it gave at least 10% (3% if either holds a digit: doses hang on
 * them, and "4mg" read for 40mg had its "0" at 7%) is a different word: not the same one in other case, spacing or
 * punctuation, nor a longer or shorter piece of it ("Sp" for "SPO"). A chosen space or line break is doubted only by
 * a digit (a number it nearly read there). ponytail: thresholds tuned on three synthetic notes; retune on real ones.
 */
function doubted(t: Token) {
  const chosen = plain(t.text);
  return t.rivals.some(r => {
    const rival = plain(r.text);
    if (!rival || rival === chosen) return false;
    const digit = /\d/.test(chosen) || /\d/.test(rival);
    if (r.p < (digit ? 0.03 : 0.1)) return false;
    return chosen ? !rival.startsWith(chosen) && !chosen.startsWith(rival) : digit;
  });
}

/**
 * The transcription and its runs (HandwrittenNote.lines): every word holding a doubted token is a run of its own
 * marked low, so the doctor checks it against the photo. Thinking and control tokens are left out.
 */
export function readingOf(tokens: Token[]) {
  // A reply cut off while still thinking has no transcription at all.
  const end = tokens.findIndex(t => t.text.includes("<unused95>"));
  const thinking = end < 0 && tokens.some(t => t.text.includes("<unused94>"));
  const kept = thinking ? [] : tokens.slice(end + 1).filter(t => !/^<[\w-]+>$/.test(t.text.trim()) || !t.text.trim());
  let text = "", pending = false;
  const doubtedAt: number[] = []; // character offsets inside a doubted word
  for (const t of kept) {
    const start = text.length;
    text += t.text;
    const lead = t.text.length - t.text.trimStart().length;
    if (!t.text.trim()) { pending ||= doubted(t); continue; } // a doubted gap belongs to the next word
    if (pending || doubted(t)) doubtedAt.push(start + lead);
    pending = false;
  }
  const trimmed = text.trim(), shift = text.indexOf(trimmed);
  const unsure = [...trimmed.matchAll(/\S+/g)].flatMap(m => {
    const from = shift + m.index!, to = from + m[0].length;
    if (!doubtedAt.some(at => at >= from && at < to)) return [];
    // The word without punctuation around it ("base." is "base"), so the app can find it in the sections too.
    const word = m[0].replace(/^[^\p{L}\d]+|[^\p{L}\d%]+$/gu, "");
    return word ? [{ at: m.index! + m[0].indexOf(word), word }] : [];
  });
  const lines: HandwrittenNote["lines"] = [];
  let at = 0;
  for (const u of unsure) {
    if (u.at > at) lines.push({ text: trimmed.slice(at, u.at), confidence: "high" });
    lines.push({ text: u.word, confidence: "low" });
    at = u.at + u.word.length;
  }
  if (at < trimmed.length) lines.push({ text: trimmed.slice(at), confidence: "high" });
  return { text: trimmed, lines, unsure: unsure.map(u => u.word) };
}

const CHANGES: MedicineChange[] = ["new", "changed", "stopped", "continue"];
const SECTION_KEYS = ["history", "examination", "assessment", "plan"] as const;
/** "2/52" → "2 weeks" (clinic shorthand: /7 days, /52 weeks, /12 months); "in 3 months" → "3 months". */
const interval = (s: string) => s.replace(/^in\s+/i, "").replace(/^(\d+)\s*\/\s*(7|52|12)$/, (_, n: string, d: string) => `${n} ${{ "7": "days", "52": "weeks", "12": "months" }[d]}`);

/**
 * The sorted note, keeping only what the transcription holds: a section adding a number (or mostly words) it
 * lacks is left out, a medicine must be named in it, and a dose or task must use its numbers. A medicine is low
 * confidence when it touches a word the model doubted or lost a field to these checks.
 */
export function sortedNote(read: string, unsure: string[], sorted: Record<string, unknown>): Omit<HandwrittenNote, "text" | "lines"> {
  const known = new Set(words(read));
  const fromNote = (s: string) => { const ws = words(s); return numbersFrom(read, s) && ws.filter(w => known.has(w)).length >= ws.length * 0.7; };
  const raw = (sorted.sections ?? {}) as Record<string, unknown>;
  const sections = Object.fromEntries(SECTION_KEYS.map(k => { const s = str(raw[k], 600); return [k, s && fromNote(s) ? s : ""]; })) as ScanSections;
  const doubt = unsure.map(plain).filter(w => w.length >= 2);
  const medicines = (Array.isArray(sorted.medicines) ? sorted.medicines : []).flatMap((m): ScanMedicine[] => {
    const name = medicineName(str(m?.name, 60));
    if (!looksLikeMedicine(name) || !known.has(words(name)[0]!)) return [];
    const said = str(m?.dose, 40), dose = said ? doseIn(said) : undefined;
    const keptDose = dose && numbersFrom(read, dose) ? dose : undefined;
    const how = str(m?.frequency, 40), frequency = how && words(how).every(w => known.has(w)) ? how : undefined;
    const lost = (said && !keptDose) || (how && !frequency);
    const all = plain([name, keptDose, frequency].join(" "));
    const low = lost || doubt.some(w => all.includes(w) || w.includes(plain(name)));
    const change = CHANGES.includes(m?.change) ? m.change as MedicineChange : "new";
    return [{ name, ...keptDose ? { dose: keptDose } : {}, ...frequency ? { frequency } : {}, change, confidence: low ? "low" : "high" }];
  }).slice(0, 12);
  const followUp = interval(str(sorted.followUp, 30));
  const review = /(\br\/v\b|\btca\b|\bclinic\b|\bfollow[- ]?up\b)/i;
  const tasks = (Array.isArray(sorted.tasks) ? sorted.tasks : []).flatMap((t): ScanTask[] => {
    const title = str(t?.title, 80), due = str(t?.due, 30), owner = str(t?.owner, 40);
    // The review itself is the follow-up, not a second task.
    if (!title || !fromNote(`${title} ${due}`) || (followUp && review.test(title))) return [];
    return [{ title, ...due ? { due } : {}, ...owner ? { owner } : {} }];
  }).slice(0, 12);
  return { sections, medicines, tasks, ...followUp && numbersFrom(read, followUp) ? { followUp: { in: followUp } } : {} };
}

export function visionModels(look: Look, model: string, fallback: Models): Pick<Models, "readMedicinePhoto" | "incidentalFindings" | "readHandwrittenNote" | "readDocumentPage"> {
  return {
    // A quick read first. When it nearly read the medicine itself as another word ("AMIODIPINE" for AMLODIPINE on a
    // blurred strip), it looks again, thinking first (slower, steadier on print), and a different name that passes wins.
    async readMedicinePhoto(input) {
      if (!input.image?.length || !input.contentType) return fallback.readMedicinePhoto(input);
      try {
        const image = { bytes: input.image, contentType: input.contentType };
        const quick = await look({ image, prompt: MEDICINE_PHOTO, prefill: '{"printed": "', maxTokens: 300, logprobs: true });
        let read = medicineIn(quick.text);
        const ingredient = (m: { name: string }) => plain(m.name.split(" ")[0]!);
        if (read && quick.tokens && readingOf(quick.tokens).unsure.some(w => plain(w) === ingredient(read!))) {
          const again = medicineIn(afterThought((await look({ image, prompt: MEDICINE_PHOTO, maxTokens: 700 }).catch(() => ({ text: "" }))).text));
          if (again && ingredient(again) !== ingredient(read)) read = again;
        }
        if (read) return { ...read, source: "model", model };
      } catch { /* the sample below, labelled fixture */ }
      return fallback.readMedicinePhoto(input);
    },

    // What is there, then where: each finding's box goes through readBoxes, which drops one in the wrong place or of
    // the wrong size for its kind. A finding whose box fails is left out rather than marked wrongly.
    async incidentalFindings(input) {
      // Nothing was read (no film on the visit, or the read failed below): no findings, labelled as no model's. The stub's
      // authored pair is never the answer here: it was stored as the patient's own findings and shown on her discharge and the ward.
      const unread = { findings: [], validated: false as const, source: "fixture" as const };
      if (!input.image?.length || !input.contentType) return unread;
      try {
        const image = { bytes: input.image, contentType: input.contentType };
        const seen = jsonIn((await look({ image, prompt: FINDINGS, prefill: '{"cardiomegaly": ', maxTokens: 80 })).text);
        if (!seen) throw new Error("No reading");
        const asks: { label: string; where: string }[] = [];
        if (seen.cardiomegaly === true) asks.push({ label: "Enlarged heart (cardiomegaly)", where: "the heart" });
        const side = seen.effusion;
        if (side === "left" || side === "right") asks.push({ label: `${side === "left" ? "Left" : "Right"} pleural effusion`, where: `the ${side} pleural effusion` });
        if (side === "both") asks.push({ label: "Pleural effusions on both sides", where: "the pleural effusions" });
        const zone = str(seen.nodule, 40).toLowerCase().replace(/\bmid\b/, "middle"), mm = Number(seen.nodule_mm);
        if (zone && zone !== "none") {
          const size = Number.isFinite(mm) && mm >= 2 && mm <= 60 ? `${Math.round(mm)} mm ` : "";
          asks.push(ZONE.test(zone) ? { label: `${size}nodule, ${zone}`, where: `the nodule in the ${zone}` } : { label: `${size}nodule`, where: "the nodule" });
        }
        // Each box is asked for on its own, all at once; MedGemma thinks before placing it (its boxes are better for it).
        const found = await Promise.all(asks.map(async ask => {
          const reply = afterThought((await look({ image, prompt: LOCATE(ask.where), maxTokens: 700 })).text);
          const box = reply.match(/"box_2d"\s*:\s*\[([^\]]*)\]/)?.[1]?.split(",").map(Number);
          // Thousandths, as asked; it sometimes answers in fractions instead.
          return box ? readBoxes(JSON.stringify([{ label: ask.label.charAt(0).toUpperCase() + ask.label.slice(1), box_2d: box }]), box.every(n => n <= 1) ? 1 : 1000) : [];
        }));
        return { findings: found.flat() as DetectedFinding[], validated: false, source: "model", model };
      } catch { /* unread, labelled fixture */ }
      return unread;
    },

    // Read, then sort: the transcription carries the doubted words (from the model's own token probabilities, since
    // asked to mark them it marks none), and the sorted record keeps only what the transcription holds.
    async readHandwrittenNote(input) {
      if (!input.image?.length) return fallback.readHandwrittenNote(input);
      try {
        const reading = await look({ image: { bytes: input.image, contentType: input.contentType }, prompt: NOTE_READ, maxTokens: 700, logprobs: true });
        const { text, lines, unsure } = reading.tokens?.length ? readingOf(reading.tokens) : { text: afterThought(reading.text).trim(), lines: [], unsure: [] };
        if (text.replace(/\s/g, "").length >= 10) {
          const sorted = jsonIn((await look({ prompt: `${NOTE_SORT}${text}`, prefill: '{"sections": {"history": "', maxTokens: 900 })).text);
          if (sorted) {
            const note = sortedNote(text, unsure, sorted);
            // Without token probabilities nothing could be marked, so every medicine is left to check.
            if (!reading.tokens?.length) note.medicines = note.medicines.map(m => ({ ...m, confidence: "low" }));
            return { text, lines: lines.length ? lines : [{ text, confidence: "high" }], ...note, source: "model", model };
          }
        }
      } catch { /* the sample note below, labelled fixture */ }
      return fallback.readHandwrittenNote(input);
    },

    // A page read word for word; "NO TEXT" is how the model says the page is blank, which is not a failure. The doubted
    // words come from token probabilities, as on a handwritten note: on a Chinese page it once wrote nonsense with confidence.
    async readDocumentPage(input) {
      try {
        const page = await look({ image: { bytes: input.image, contentType: input.contentType }, prompt: DOCUMENT_PAGE, maxTokens: 1500, logprobs: true });
        const { text, unsure } = page.tokens?.length ? readingOf(page.tokens) : { text: afterThought(page.text).trim(), unsure: [] };
        return text === "NO TEXT" ? { text: "", unsure: [], source: "model", model } : { text, unsure, source: "model", model };
      } catch { /* nothing read, labelled fixture */ }
      return fallback.readDocumentPage(input);
    },
  };
}
