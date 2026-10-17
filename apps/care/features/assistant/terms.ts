import type { MarkKind } from "@sona-ai/domain/answer-parts";

/**
 * The words in Sona's answers a patient looks for, in colour (the UX rule "meaningful highlights"): a medicine in the
 * blue the plan tags new medicines with, how much and when (a dose, its timing, and a visit or check-in and its date) in violet, and a warning sign or an allergy in red, the
 * colour kept for "call the hospital". English, Malay and Chinese; her own medicines come from her plan, so a name the
 * lists below don't know is still found. Pure, so bun can test it. The model's own marks may use every kind of the
 * shared contract (answer-parts MarkKind: also caution, condition, symptom and test); the lists here find only these three.
 */
export type Mark = MarkKind;
export type Piece = { text: string; mark?: Mark };

const words = (alternatives: string, flags = "giu") => new RegExp(`(?<![\\p{L}\\d])(?:${alternatives})(?![\\p{L}\\d])`, flags);

const WARNING = new RegExp([
  words([
    "call 999", "999", "emergency(?: department)?", "A&E", "chest pain", "short(?:ness)? of breath", "(?:difficulty|trouble) breathing",
    "can(?:'|no)t breathe", "bleeding", "coughing (?:up )?blood", "blood in (?:your )?(?:urine|stools?|phlegm|vomit)", "high fever",
    "faint(?:ing|ed)?", "pass(?:ed|ing)? out", "unconscious", "seizures?", "confus(?:ed|ion)", "allerg(?:y|ies|ic)(?: reaction)?",
    "swelling of (?:your )?(?:face|lips|tongue|throat)", "rash(?:es)?",
    "sakit dada", "sesak nafas", "(?:susah|sukar) bernafas", "pendarahan", "(?:batuk )?berdarah", "demam tinggi", "pengsan",
    "tidak sedarkan diri", "sawan", "keliru", "alahan", "alah", "kecemasan", "bengkak (?:muka|bibir|lidah|tekak)", "ruam",
  ].join("|")).source,
  "(?<!\\d)999(?!\\d)|胸口?痛|呼吸困难|喘不过气|咳血|出血|发?高烧|晕倒|昏倒|昏迷|失去知觉|抽搐|过敏|急诊|紧急|皮疹|红疹",
].join("|"), "giu");

const DRUG = new RegExp([
  words([
    "paracetamol", "acetaminophen", "panadol", "ibuprofen", "aspirin", "insulin", "warfarin", "heparin", "prednisolone", "salbutamol",
    "ventolin", "cetirizine", "loratadine", "antibiotics?", "antibiotik",
    // Generic names by their stems: amoxicillin, azithromycin, ciprofloxacin, lisinopril, losartan, atenolol, atorvastatin,
    // omeprazole, amlodipine, metformin, furosemide... At least three letters first, so "April" is no medicine.
    "\\p{L}{3,}(?:cillin|mycin|micin|floxacin|cycline|pril|sartan|olol|statin|prazole|azole|dipine|formin|gliptin|semide|thiazide|oxetine|azepam|codone|profen|triptan|lukast)",
  ].join("|")).source,
  "扑热息痛|对乙酰氨基酚|布洛芬|阿司匹林|胰岛素|抗生素|阿莫西林|阿奇霉素|二甲双胍|华法林",
].join("|"), "giu");

const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|januari|februari|mac|mei|julai|ogos|oktober|disember";
const WEEKDAY = "(?:mon|tues|wednes|thurs|fri|satur|sun)day|isnin|selasa|rabu|khamis|jumaat|sabtu|ahad";
const NUM = "\\d+(?:[.,]\\d+)?|one|two|three|four|five|six|half|a|satu|dua|tiga|empat|lima|enam|setengah|separuh|sebiji";
const ZH_NUM = "[\\d一二两三四五六七八九十半]+";
const DOSE = new RegExp([
  words([
    `(?:${NUM})\\s?(?:mg|mcg|µg|g|grams?|grammes?|milligrams?|ml|millilitres?|units?|tablets?|tabs?|capsules?|puffs?|drops?|sachets?|biji|kapsul|titis|sudu(?: teh| besar)?)`,
    "(?:once|twice|three times|four times)(?: (?:a|per|every) (?:day|week)| daily)?",
    "every (?:\\d+|two|three|four|six|eight|twelve)(?: to (?:\\d+|four|six|eight))? hours?",
    // When to come back: the visit and its date ("Saturday, October 24, 2026", "24 Oct", "day 2 and day 7"). A month
    // alone ("in April") is not a date.
    `(?:(?:${WEEKDAY}),? )?(?:(?:${MONTH}) \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?|\\d{1,2} (?:${MONTH})(?: \\d{4})?)`, WEEKDAY,
    "day \\d+(?: and (?:day )?\\d+)?", "hari (?:ke-?)?\\d+(?: dan (?:hari (?:ke-?)?)?\\d+)?",
    "clinic (?:review|visit|appointment)", "follow-up(?: visit| appointment| review)?", "check-ins?", "temujanji(?: klinik)?", "lawatan susulan", "every (?:morning|night|evening|day|other day)",
    "(?:before|after|with) (?:meals?|food|breakfast|lunch|dinner|eating)", "at (?:night|bedtime)", "before bed(?:time)?", "in the (?:morning|evening)",
    "for (?:\\d+|one|two|three|four|five|six|seven|ten|fourteen) (?:more )?(?:days?|weeks?|months?)", "\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)",
    "(?:sekali|dua kali|tiga kali|empat kali)(?: (?:sehari|seminggu))?", "setiap (?:\\d+|dua|tiga|empat|enam|lapan|dua belas) jam",
    "setiap (?:pagi|malam|hari)", "(?:sebelum|selepas|semasa|bersama) (?:makan(?:an)?|sarapan|tidur)", "waktu malam",
    "selama (?:\\d+|satu|dua|tiga|empat|lima|enam|tujuh) (?:hari|minggu|bulan)(?: lagi)?",
  ].join("|")).source,
  `${ZH_NUM}\\s?(?:毫克|克|毫升|片|粒|颗|包|滴|单位|mg|g|ml)`, `(?:每[天日]|一[天日])${ZH_NUM}次`, `每${ZH_NUM}个?小时`, "每[天晚早]",
  "饭前|饭后|餐前|餐后|睡前|空腹", "\\d{1,2}月\\d{1,2}[日号]", "星期[一二三四五六日天]|周[一二三四五六日]", `第${ZH_NUM}天`, "复诊|回诊|门诊", `${ZH_NUM}(?:天|周|个?星期|个月)`,
].join("|"), "giu");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Her medicines' names as the plan lists them, and each one's first word ("Salbutamol" of "Salbutamol nebuliser"). */
export function medicinesOf(plan?: { medicines?: Partial<Record<string, { name: string }[]>> }): string[] {
  const names = Object.values(plan?.medicines ?? {}).flatMap(group => group ?? []).map(m => m.name.trim()).filter(Boolean);
  return [...new Set(names.flatMap(n => [n, n.split(/\s+/)[0]!]).filter(n => n.length >= 4))];
}

/** A word to colour as the model chose it (care.ask's `marks`): its exact words in the answer, and its kind. */
export type Chosen<K extends string = Mark> = { text: string; kind: K };

/**
 * Where each of the model's chosen words is in `text`: each found in turn after the one before, so a dose said twice
 * is marked twice; one not in the text is skipped. Sona Pro's web answers use it too, with their own kinds.
 */
export function chosenIn<K extends string>(text: string, chosen: Chosen<K>[]) {
  const found: { from: number; to: number; mark: K }[] = [];
  const free = (from: number, to: number) => !found.some(f => from < f.to && to > f.from);
  const next = (words: string, at: number) => { let from = text.indexOf(words, at); while (from >= 0 && !free(from, from + words.length)) from = text.indexOf(words, from + 1); return from; };
  let cursor = 0;
  for (const c of chosen) {
    if (!c.text) continue;
    const from = next(c.text, cursor) >= 0 ? next(c.text, cursor) : next(c.text, 0);
    if (from < 0) continue;
    found.push({ from, to: from + c.text.length, mark: c.kind });
    cursor = from + c.text.length;
  }
  return found;
}

/** The text cut into pieces at the found words, each marked or not. */
export function piecesOf<K extends string>(text: string, found: { from: number; to: number; mark: K }[]): { text: string; mark?: K }[] {
  const pieces: { text: string; mark?: K }[] = [];
  let at = 0;
  for (const f of [...found].sort((a, b) => a.from - b.from)) {
    if (f.from > at) pieces.push({ text: text.slice(at, f.from) });
    pieces.push({ text: text.slice(f.from, f.to), mark: f.mark });
    at = f.to;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

/**
 * The text cut into pieces, each marked or not. The model's own marks when it gave any (`chosen`, even none: then
 * nothing is coloured). Without them (no model, or an older server) the word lists stand in: a warning wins over a
 * medicine, a medicine over a dose.
 */
export function marked(text: string, medicines: string[] = [], chosen?: Chosen[]): Piece[] {
  if (chosen) return piecesOf(text, chosenIn(text, chosen));
  const found: { from: number; to: number; mark: Mark }[] = [];
  const rules: [Mark, RegExp][] = [["warning", WARNING], ["medicine", DRUG], ["dose", DOSE]];
  if (medicines.length) rules.splice(1, 0, ["medicine", words([...medicines].sort((a, b) => b.length - a.length).map(escape).join("|"))]);
  for (const [mark, rule] of rules) for (const m of text.matchAll(rule)) {
    const from = m.index, to = from + m[0].length;
    if (!found.some(f => from < f.to && to > f.from)) found.push({ from, to, mark });
  }
  return piecesOf(text, found);
}
