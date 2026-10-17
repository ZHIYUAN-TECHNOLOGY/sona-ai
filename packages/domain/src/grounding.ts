import type { Language } from "./discharge";

/**
 * "Cannot invent": a Sona Care answer is read sentence by sentence against the patient's own record before she sees or
 * hears it, and a sentence that states a fact about her which the record does not hold is taken out. The record is the
 * text the model was given (packages/api care-plan's recordText); passages are the hospital leaflet text it was also given.
 * Pure text rules: no model call, no I/O, so a call can judge each sentence before it is spoken.
 *
 * The rule, in plain words.
 *
 * 1. Only some things are facts to check: a dose (500 mg, 1 tablet), how often (twice a day, every 6 hours), how long
 *    (for 5 days), a result or observation (sodium 132 mmol/L, temperature 37.2), a calendar date or weekday, a clock
 *    time, and a medicine called hers. Every other number is left alone: "8 glasses of water", "999", "7 to 9 hours of
 *    sleep". A range ("2 to 3 weeks", "135 to 145") and a limit or norm ("above 38°C", "a normal temperature is 37")
 *    are general knowledge, never her reading, so they are left alone too.
 *
 * 2. A fact is checked only where the sentence is about her:
 *    - a dose, how often and how long: when the sentence speaks to her (you/your, anda/awak/kamu, 您/你), names a
 *      medicine her record holds, or tells her to take something ("Take ...", "Ambil ...", "请服用..."), and it is about
 *      medicine. "Adults usually take 500 mg" speaks of nobody in particular and is kept.
 *    - a result: when the number follows the name of a result or observation (sodium, kalium, 体温, "your level"), or
 *      carries a lab unit in a sentence that speaks to her.
 *    - a calendar date: always (general advice has none). A weekday or a clock time: when the sentence is about a visit
 *      (appointment, clinic, temu janji, 预约) or about her medicine.
 *    - a medicine name: when it is called hers ("your amoxicillin", "amoxicillin anda", "您的…"). "Paracetamol can help
 *      with fever" names a medicine but claims nothing about her.
 *
 * 3. Where a fact must be found:
 *    - a dose, frequency, duration or date beside one of her medicines: on the record lines that name that medicine, so
 *      cetirizine's 10 mg never vouches for azithromycin.
 *    - a result: on the record line of that result. A visit's date and time: on the record's visit lines.
 *    - anything else: anywhere in the record. A passage can also support a dose or a general statement ("the clinic
 *      opens at 8:00"), never her results, her appointments or a medicine of hers.
 *    Numbers match with their unit (1 g is 1000 mg; "132" matches "132 mmol/L"), dates across formats and languages
 *    ("8 Oct", "08/10/2026", "10月8日", "Khamis" when the record's date is a Thursday), times across 12 and 24 hours.
 *    A medicine name matches the record's spelling, Malay spelling included (azitromisin); a Chinese name only when the
 *    record or a passage holds those characters, since no table here says which Chinese name is which medicine.
 *
 * 4. Decided: a frequency is removed only when it contradicts (the lines it is read against give one, and not this one).
 *    Where they give none ("as needed"), it cannot be checked and is kept. "At night" and "in the morning" count as once
 *    a day; which part of the day is not checked. A duration may also be the days from today to a date on those lines
 *    ("2 more days" when the last dose is tomorrow).
 *
 * 5. Safety first: a sentence that tells her to call 999 or get urgent help is never removed, whatever else it says.
 *
 * ponytail: this is a heuristic over words, not understanding. Its ceiling: it cannot tell what a sentence means, so it
 * misses an invented fact with no number, date or medicine name ("your X-ray was clear"), a relative day ("tomorrow"), a
 * result it has no name for and that has no unit, a wrong part of the day, a fact that is in the record but about
 * something else when no medicine or result is named, and anything in a sentence with urgent words. It wrongly removes
 * a true fact the model worked out rather than copied (an age, a count of doses left), a Chinese medicine name the
 * record only holds in English, and general advice that happens to address her with a dose or a clinic time no passage
 * holds. The upgrade is an entailment model that reads each sentence against the record, or structured answers where
 * the model cites the record line behind each fact and only cited lines are shown.
 */
export type Reason = "medicine" | "dose" | "frequency" | "duration" | "result" | "date" | "time";
/** Why a sentence is not supported, and the fact as it was written (lower case). */
export type Unsupported = { reason: Reason; fact: string };

/**
 * Said in place of what was removed: once per answer, after the kept sentences (alone when none is kept), never once per
 * removed sentence. `grounded` appends it; a call says it once after the last sentence if any was held back.
 */
export const NOT_FOUND: Record<Language, string> = {
  en: "I could not find that in your record. Please ask your care team.",
  ms: "Saya tidak menemuinya dalam rekod anda. Sila tanya pasukan penjagaan anda.",
  zh: "我在您的记录中找不到这项信息，请向您的医护团队查询。",
};

type Day = { d: number; m?: number; y?: number };
type Amount = { n: number; unit?: string };
/** What one piece of text states, each fact with the words it was written in. */
type Facts = {
  text: string;
  dates: (Day & { raw: string })[]; weekdays: { n: number; raw: string }[]; times: { at: number[]; raw: string }[];
  freqs: { n: number; raw: string }[]; durations: { n: number; raw: string }[]; doses: (Amount & { raw: string })[];
  /** The numbers left over, each with a lab unit if it has one, and where it sits in the text. */
  values: (Amount & { raw: string; at: number; end: number })[];
};
type Segment = Facts & { visit: boolean };
/** A record and its passages, read once (groundsOf) so each sentence is judged without reading them again. */
export type Grounds = { record: Segment[]; passages: Segment[]; medicines: Map<string, string>; today?: number; text: string; passageText: string };

const EN_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const MS_NUMBERS = ["kosong", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "lapan", "sembilan", "sepuluh"];
const ZH_DIGITS = "零一二三四五六七八九";
/** 十 is 10, 二十五 is 25, 二〇二六 is 2026. */
function zhNumber(word: string) {
  const w = word.replace(/两/g, "二").replace(/〇/g, "零");
  if (!w.includes("十")) return [...w].map(c => ZH_DIGITS.indexOf(c)).join("");
  const [tens = "", ones = ""] = w.split("十");
  return String((tens ? ZH_DIGITS.indexOf(tens) : 1) * 10 + (ones ? ZH_DIGITS.indexOf(ones) : 0));
}

/**
 * One spelling for everything compared: full-width digits and punctuation to ASCII, lower case, and a number written as
 * a word made a digit, only where a unit follows (two tablets, dua kali, 两次, 十月), so "一些" and "one of us" are untouched.
 * 一点 is "a little" unless a part of the day comes before it.
 */
function norm(text: string) {
  return text.normalize("NFKC").toLowerCase()
    .replace(/\b([ap])\.m\b\.?/g, "$1m")
    .replace(/(?<![星期礼拜周])[零〇一二两三四五六七八九十]+(?=\s*(?:毫克|微克|克|毫升|片|粒|颗|喷|次|天|日|号|月|年|点|點|小时|个小时|周))/g,
      (m, at: number, all: string) => m === "一" && /^[点點]/.test(all.slice(at + 1)) && !/(?:上午|下午|早上|晚上|中午|凌晨|傍晚)$/.test(all.slice(0, at)) ? m : zhNumber(m))
    .replace(/半(?=[片粒颗])/g, "0.5")
    .replace(/\bhalf\s+(?:of\s+)?an?(?=\s+(?:tablet|capsule|pill)\b)/g, "0.5")
    .replace(/\ban?(?=\s+(?:tablet|capsule|pill|puff)\b)/g, "1")
    .replace(new RegExp(`\\b(${EN_NUMBERS.join("|")})(?=\\s+(?:more\\s+)?(?:tablets?|capsules?|pills?|puffs?|days?|weeks?|times|hours?)\\b)`, "g"), m => String(EN_NUMBERS.indexOf(m)))
    .replace(/\bsetengah(?=\s+biji\b)/g, "0.5")
    .replace(/\bse(biji|kali)\b/g, "1 $1")
    .replace(new RegExp(`\\b(${MS_NUMBERS.join("|")})(?=\\s+(?:biji|tablet|kapsul|kali|hari|minggu|sedutan|jam)\\b)`, "g"), m => String(MS_NUMBERS.indexOf(m)));
}

// January to December, English and Malay. "may" alone is the verb far more often than the month (see factsOf).
const MONTHS = ["jan(?:uar[yi])?", "feb(?:ruar[yi])?", "mar(?:ch)?|mac", "apr(?:il)?", "may|mei", "june?", "jul(?:y|ai)?", "aug(?:ust)?|ogos", "sep(?:t(?:ember)?)?", "o[ck]t(?:ober)?", "nov(?:ember)?", "de[cs](?:ember)?|dis(?:ember)?"];
const MONTH = MONTHS.join("|");
const monthOf = (word: string) => MONTHS.findIndex(m => new RegExp(`^(?:${m})$`).test(word)) + 1;
const EN_DAYS = ["sun", "mon", "tues", "wednes", "thurs", "fri", "satur"], MS_DAYS = ["ahad", "isnin", "selasa", "rabu", "khamis", "jumaat", "sabtu"];
/** The record's ISO stamps are UTC; her days and times are Malaysia's. */
const MALAYSIA_HOURS = 8;
const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;
/** Mass in milligrams, so 1 g is 1000 mg; a count of tablets, capsules or 片 is one unit. */
const MASS: Record<string, number> = { mcg: 0.001, μg: 0.001, ug: 0.001, mikrogram: 0.001, microgram: 0.001, micrograms: 0.001, 微克: 0.001, g: 1000, gram: 1000, grams: 1000, 克: 1000 };
const LAB_UNIT = "(?:[mμnp]?mol|[mμnpk]?g|m?l|iu|u|cells)\\/(?:d?l|ml|min|μl)";
const TIMES_A_DAY: Record<string, number> = { once: 1, twice: 2, thrice: 3, od: 1, bd: 2, bid: 2, tds: 3, tid: 3, qid: 4, qds: 4 };

/**
 * Every checkable fact in a piece of normalised text. Each kind is read in turn and blanked out, so "08 Oct 2026 10:30"
 * leaves no stray 8, 2026, 10 or 30 to be mistaken for a result. A record is read generously (asRecord): its ranges and
 * any "5 days" count, and a bare "10:30" is the 24-hour time; an answer's range is general knowledge and is dropped.
 */
function factsOf(text: string, asRecord = false): Facts {
  let t = text;
  const f: Facts = { text, dates: [], weekdays: [], times: [], freqs: [], durations: [], doses: [], values: [] };
  // Returning false from `read` leaves the match in place: it was not that kind of fact after all.
  const take = (re: RegExp, read: (m: (string | undefined)[]) => unknown) => {
    t = t.replace(re, (...a) => read(a.slice(0, -2)) === false ? a[0] : " ".repeat(a[0].length));
  };
  const date = (raw: string, d: number, m?: number, y?: number) => {
    if (d < 1 || d > 31 || (m !== undefined && (m < 1 || m > 12))) return false;
    const year = y === undefined ? undefined : y < 100 ? 2000 + y : y;
    f.dates.push({ raw: raw.trim(), d, m, y: year });
    if (asRecord && m && year) f.weekdays.push({ n: new Date(dayNumber(year, m, d) * 86_400_000).getUTCDay(), raw });
  };
  const time = (raw: string, h: number, minute: number, half = "") => {
    if (h > 24 || minute > 59) return false;
    const am = /^a|pagi|上午|早上|凌晨/.test(half), pm = !am && /^p|malam|下午|晚上|傍晚/.test(half), at = h * 60 + minute, later = (h % 12 + 12) * 60 + minute;
    // An answer's bare "2:30" may be the afternoon; the record's is what it says.
    f.times.push({ raw: raw.replace(/^(?:at|pukul|jam|@)\s*/, "").trim(), at: am ? [(h % 12) * 60 + minute] : pm ? [later] : asRecord || h > 12 || h === 0 ? [at] : [at, later] });
  };

  take(/\b(\d{4})-(\d{2})-(\d{2})(?:t(\d{2}):(\d{2})[\d:.]*(z)?)?/g, ([raw, y, m, d, h, minute, utc]) => {
    const at = new Date(Date.UTC(+y!, +m! - 1, +d!, h ? +h + (utc ? MALAYSIA_HOURS : 0) : 0, +(minute ?? 0)));
    if (h) time(raw!, at.getUTCHours(), at.getUTCMinutes());
    return date(raw!, at.getUTCDate(), at.getUTCMonth() + 1, at.getUTCFullYear());
  });
  take(new RegExp(`\\b(\\d{1,2})(st|nd|rd|th|\\s?hb)?\\s*(of\\s+|hari\\s?bulan\\s+)?(${MONTH})\\b(?:,?\\s*(\\d{4})\\b)?`, "g"), ([raw, d, ordinal, of, month, y]) =>
    month === "may" && !ordinal && !of && !y ? false : date(raw!, +d!, monthOf(month!), y ? +y : undefined));
  take(new RegExp(`\\b(${MONTH})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?![:.]\\d|\\s*(?:mg|g\\b|ml|tab|cap|biji|kali|hari|day|time|hour|jam|more))(?:,?\\s*(\\d{4})\\b)?`, "g"), ([raw, month, d, y]) =>
    month === "may" ? false : date(raw!, +d!, monthOf(month!), y ? +y : undefined));
  take(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g, ([raw, d, m, y]) => date(raw!, +d!, +m!, +y!));
  take(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]?/g, ([raw, y, m, d]) => date(raw!, +d!, +m!, y ? +y : undefined));
  take(/\b(\d{1,2})\s?hb\b|(\d{1,2})号/g, ([raw, a, b]) => date(raw!, +(a ?? b)!));
  take(/\b(sun|mon|tues|wednes|thurs|fri|satur)day\b|\b(ahad|isnin|selasa|rabu|khamis|jumaat|sabtu)\b|(?:星期|礼拜|(?<![每\d])周)([日天一二三四五六])(?!次)/g, ([raw, en, ms, zh]) => {
    f.weekdays.push({ raw: raw!, n: en ? EN_DAYS.indexOf(en) : ms ? MS_DAYS.indexOf(ms) : Math.max(0, "天一二三四五六".indexOf(zh!)) });
  });

  // "10.30" is a time only with "at"/"pukul" before it or am/pm/pagi after it; otherwise it is a number (a result of 3.10).
  take(/(?:\b(at|pukul|jam)\s*|(@)\s*)?\b(\d{1,2})([:.])(\d{2})(?!\d)\s*(am|pm|pagi|petang|malam)?(?![a-z])/g, ([raw, word, sign, h, dot, minute, half]) =>
    dot === "." && !word && !sign && !half ? false : time(raw!, +h!, +minute!, half));
  take(/\b(\d{1,2})\s*(am|pm)(?![a-z])/g, ([raw, h, half]) => time(raw!, +h!, 0, half));
  take(/\bpukul\s*(\d{1,2})\b\s*(pagi|petang|malam)?/g, ([raw, h, half]) => time(raw!, +h!, 0, half));
  take(/(上午|早上|凌晨|中午|下午|晚上|傍晚)?\s*(\d{1,2})\s*[点點](?:(半)|(\d{1,2})分?)?/g, ([raw, half, h, thirty, minute]) => time(raw!, +h!, thirty ? 30 : +(minute ?? 0), half));

  if (!asRecord) take(/\b(?:between|antara)\s+\d+(?:\.\d+)?\s*\S{0,6}\s*(?:and|dan)\s+\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?(?:[a-zμ°%]{1,6}|毫克|微克|克|毫升|天|周|小时|度)?\s*(?:\bto\b|\bhingga\b|\bsampai\b|[至到~–—-])\s*\d+(?:\.\d+)?/g, () => true);

  // How often, as times a day: "every 6 hours" is 4.
  const freq = (raw: string, n: number) => { f.freqs.push({ raw: raw.trim(), n }); };
  take(/\b(\d+)\s*(?:times?|x)\s*(?:a|per|each|every)?\s*(?:day|daily)\b/g, ([raw, n]) => freq(raw!, +n!));
  take(/\b(once|twice|thrice)\s*(?:a|per|each|every)?\s*(?:day|daily)\b/g, ([raw, word]) => freq(raw!, TIMES_A_DAY[word!]!));
  take(/\bevery\s*(\d+)\s*(?:hours?|hrs?)\b|\b(\d+)[- ]hourly\b|\bsetiap\s*(\d+)\s*jam\b|每隔?(\d+)个?小时/g, ([raw, a, b, c, d]) => freq(raw!, 24 / +(a ?? b ?? c ?? d)!));
  take(/\b(\d+)\s*kali\s*(?:sehari|setiap hari|1 hari)\b|\bsehari\s*(\d+)\s*kali\b|[天日]\s*(\d+)\s*次/g, ([raw, a, b, c]) => freq(raw!, +(a ?? b ?? c)!));
  take(/\b(od|bd|bid|tds|tid|qid|qds)\b/g, ([raw, word]) => freq(raw!, TIMES_A_DAY[word!]!));
  take(/\b(?:daily|every day|each day|at night|nightly|before bed|at bedtime|(?:in the|each|every) morning|sehari|setiap hari|tiap hari|waktu malam|sebelum tidur|setiap pagi|setiap malam)\b|每[天日晚]|晚上|睡前|早上|早晨/g, ([raw]) => freq(raw!, 1));

  // How long, in days. Only the phrasings of a course in an answer; any count of days in a record.
  const lasts = (m: (string | undefined)[]) => {
    const i = m.findIndex((x, k) => k > 0 && x !== undefined);
    f.durations.push({ raw: m[0]!.trim(), n: +m[i]! * (/week|minggu|周/.test(m[i + 1]!) ? 7 : 1) });
  };
  take(/\bfor\s*(\d+)\s*(?:more\s*)?(day|week)s?\b|\b(\d+)\s*more\s*(day|week)s?\b|\b(\d+)[- ](day|week)\s*course\b|\bselama\s*(\d+)\s*(hari|minggu)\b|\b(\d+)\s*(hari|minggu)\s*lagi\b|(?:再|共|满|连续|服用?|吃)\D{0,2}(\d+)\s*(天|周)(?![后内前以])|(\d+)\s*(天|周)的?疗程/g, lasts);
  if (asRecord) take(/\b(\d+)\s*(days?|weeks?|hari|minggu)\b|(\d+)\s*(天|周)/g, lasts);

  take(/(\d+(?:\.\d+)?)\s*(mcg|μg|ug|mikrogram|micrograms?|微克|mg|miligram|milligrams?|毫克|grams?|g|克|ml|毫升|iu|units?)(?![a-z/])/g, ([raw, n, unit]) => {
    f.doses.push({ raw: raw!, n: +(+n! * (MASS[unit!] ?? 1)).toPrecision(12), unit: unit! in MASS || /^m(?:g|il)|毫克/.test(unit!) ? "mg" : /ml|毫升/.test(unit!) ? "ml" : "unit" });
  });
  take(/(\d+(?:\.\d+)?)\s*(?:tablets?|tabs?|capsules?|caps|pills?|biji|kapsul|片|粒|颗)(?![a-z])/g, ([raw, n]) => { f.doses.push({ raw: raw!, n: +n!, unit: "tablet" }); });
  take(/(\d+(?:\.\d+)?)\s*(?:puffs?|sedutan|喷)(?![a-z])/g, ([raw, n]) => { f.doses.push({ raw: raw!, n: +n!, unit: "puff" }); });

  // What is left: a number is a candidate result unless it counts something else (days, glasses, "day 2", "CURB-65").
  for (const m of t.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(°\\s?c|摄氏度|度|mmhg|bpm|次\\/分|\\/\\s?min|%|${LAB_UNIT}(?![a-z]))?`, "g"))) {
    const before = t.slice(0, m.index), end = m.index + m[0].length;
    if (/[a-z]-?$/.test(before) || /(?:\bday|\bhari|第|#)\s*$/.test(before)) continue;
    if (/^\s*(?:days?|weeks?|hours?|hrs?|months?|years?|times?|minutes?|mins?|hari|minggu|jam|bulan|tahun|kali|minit|天|周|小时|个|年|次|岁|分钟|kg|公斤|glasses|gelas|cawan|cups?|杯|of\b)/.test(t.slice(end))) continue;
    const unit = m[2]?.replace(/\s/g, "");
    f.values.push({ raw: m[0].trim(), n: +m[1]!, unit: unit && (/度/.test(unit) ? "°c" : /bpm|min|分/.test(unit) ? "/min" : unit), at: m.index, end });
  }
  return f;
}

/** Results and observations by name, in the three languages; a record line and a sentence are about the same one when the same entry matches both. */
const MEASURES = [
  /\b(?:potassium|kalium)\b|钾/g, /\b(?:sodium|natrium)\b|钠/g, /\bcrp\b|c-reactive|c反应蛋白/g, /\b(?:ha?emoglobin|hb)\b|血红蛋白/g, /\burea\b|尿素/g,
  /\b(?:creatinine|kreatinin)\b|肌酐/g, /\b(?:glucose|glukosa|sugar|gula)\b|血糖/g, /\b(?:white cells?|wbc|wcc|sel darah putih)\b|白细胞/g, /\b(?:platelets?|platelet)\b|血小板/g,
  /\b(?:cholesterol|kolesterol)\b|胆固醇/g, /\bhba1c\b|糖化血红蛋白/g, /\b(?:temperature|suhu)\b|体温/g, /\b(?:blood pressure|bp|systolic|diastolic|tekanan darah)\b|血压|收缩压|舒张压/g,
  /\b(?:pulse|heart rate|nadi|kadar jantung|degupan jantung)\b|脉搏|心率|心跳/g, /\b(?:saturation|spo2|oxygen|oksigen)\b|血氧|氧饱和度/g,
  /\b(?:respiratory rate|breathing rate|kadar pernafasan)\b|呼吸频率/g, /\b(?:weight|berat badan)\b|体重/g,
];
const ANY_RESULT = /\b(?:results?|levels?|readings?|keputusan|paras|bacaan)\b|结果|水平|指标|数值/;
// The number is given as a limit or a norm ("above 38", "normally 37", "38 or higher"), not as her reading.
const LIMIT_BEFORE = /(?:\b(?:above|below|over|under|than|least|most|exceeds?|reach(?:es)?|normal\w*|usual\w*|typical\w*|should|target|atas|bawah|melebihi|daripada|sekurang-kurangnya|biasa\w*|sasaran)\b|超过|低于|高于|达到|正常|应该|目标|[<>≥≤])[^\d]*$/;
const LIMIT_AFTER = /^\s*(?:(?:or|and|atau|dan)\s+(?:more|higher|above|less|lower|below|lebih|ke atas|ke bawah)|ke atas|ke bawah|或?以上|或?以下|或更高|或更低)/;

/** A word that is a medicine by its ending or because it is a common one; her own medicines come from her record instead. */
const MEDICINE = /\b(?:[a-z]{2,}(?:cillin|mycin|floxacin|statin|sartan|prazole|azole|dipine|formin|tidine|rizine|profen|butamol|parin|xaban|gliptin|gliflozin|sone|solone|cycline|caine|zepam|setron)|[a-z]{4,}pril|[a-z]{3,}olol|paracetamol|acetaminophen|panadol|aspirin|warfarin|insulin|morphine|tramadol|codeine|digoxin|furosemide|frusemide|ventolin|augmentin|zithromax|zyrtec|co-amoxiclav|amoxiclav|loratadine|chlorpheniramine|piriton|diclofenac|naproxen|celecoxib|clopidogrel|levothyroxine|gabapentin)\b/g;
const ZH_MEDICINE_ENDING = /霉素|西林|沙星|他汀|洛尔|普利|沙坦|拉唑|地平|替丁|利嗪|洛芬/g;
const ZH_MEDICINE = /胰岛素|扑热息痛|对乙酰氨基酚|阿司匹林|二甲双胍|华法林|沙丁胺醇|必理痛/g;
const MEDICINE_WORD = /\b(?:medicines?|medications?|tablets?|capsules?|pills?|antibiotics?|inhalers?|doses?|dosage|syrup|ubat|pil|kapsul|antibiotik|dos|sedutan)\b|药|抗生素|剂量|吸入器|疗程/;
/**
 * One spelling for a medicine's name in English and Malay: azithromycin and azitromisin, cetirizine and setirizin.
 * ponytail: spelling rules, not a drug dictionary; a brand name for a generic (Zithromax) is not matched.
 */
const fold = (name: string) => name.replace(/ph/g, "f").replace(/th/g, "t").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/y/g, "i").replace(/(.)\1/g, "$1").replace(/e$/, "");

const YOU = /\b(?:you|your|yours|you're|you've|you'll|anda|awak|kamu|engkau)\b|[您你]/;
const APPOINTMENT = /\b(?:appointments?|follow[- ]?ups?|reviews?|booked|booking|scheduled|temu ?janji|susulan)\b|预约|复诊|复查|回诊|约诊/;
const VISIT = /\b(?:visits?|check-?ups?|clinic|see (?:the|your|a) doctor|come back|lawatan|klinik|jumpa doktor|datang semula)\b|门诊|看医生|就诊/;
const INSTRUCTION = /\b(?:take|taking|use|inhale|swallow|continue|finish|complete|stop|ambil|makan|minum|telan|guna|gunakan|teruskan|habiskan|berhenti)\b|服用|服药|吃|使用|继续服/;
const NOBODY_IN_PARTICULAR = /\b(?:adults?|children|people|patients|most|some|many|usually|typically|generally|commonly|normally|orang|kebanyakan|biasanya|lazimnya|umumnya|dewasa|kanak-kanak|pesakit)\b|一般|通常|成人|大多数|多数人|有些人|很多人|儿童|患者|常用/;
/** Urgent help: 999, an emergency, or "now" beside who to turn to. Such a sentence is never judged. */
const NOW = "(?:\\b(?:immediately|urgent(?:ly)?|right away|straight away|at once|now|segera|serta[- ]merta)\\b|立即|马上|立刻|尽快)", HELP = "(?:\\b(?:doctor|hospital|clinic|help|care|attention|call|doktor|klinik|bantuan|rawatan|hubungi)\\b|医|诊|求助|拨打|联系)";
const URGENT = new RegExp(`\\b(?:999|112|emergency|ambulance|a&e|kecemasan|ambulans)\\b|急诊|急救|救护车|紧急|就医|求医|${NOW}.*${HELP}|${HELP}.*${NOW}`);

/** The record (recordText's lines) and the passages, read once for a whole answer or a whole call. */
export function groundsOf(record: string, passages: readonly string[] = []): Grounds {
  const text = norm(record), segments: Segment[] = [], medicines = new Map<string, string>();
  let section = "", today: number | undefined;
  const hers = (name?: string) => { if (name && name.length > 3 && name !== "none") medicines.set(fold(name), name); };
  for (const line of text.split("\n")) {
    const item = line.startsWith("- "), before = /^medicines before admission:(.*)/.exec(line);
    if (!item) section = line;
    // Her medicines by name: the plan's lines, what she took before admission, and any medicine word (the note, an allergy).
    if (item && section === "medicines:") hers(/^- ([a-z-]+)/.exec(line)?.[1]);
    for (const part of before?.[1]!.split(";") ?? []) hers(/^\s*([a-z-]+)/.exec(part)?.[1]);
    for (const m of line.matchAll(MEDICINE)) hers(m[0]);
    // One fact line each: the observations sit on one line apart by " · ", the medicines before admission apart by ";".
    for (const part of line.split(before ? /;| · / : " · ")) {
      const facts = factsOf(part, true), now = line.startsWith("now:") && facts.dates[0];
      if (now && now.m && now.y) today = dayNumber(now.y, now.m, now.d);
      segments.push({ ...facts, visit: (item && section.startsWith("visits")) || line.startsWith("follow-up:") });
    }
  }
  const read = passages.map(norm);
  return { record: segments, passages: read.map(p => ({ ...factsOf(p, true), visit: false })), medicines, today, text, passageText: read.join("\n") };
}

const sameDay = (claim: Day, held: Day) => claim.d === held.d && (claim.m === undefined || claim.m === held.m) && (claim.y === undefined || held.y === undefined || claim.y === held.y);

/**
 * One sentence against the record: why it is not supported, or undefined when it is supported, general, or urgent.
 * Synchronous and quick (a few dozen regular expressions over one sentence), so a call can judge each sentence
 * before it is sent to be spoken.
 */
export function unsupported(sentence: string, g: Grounds): Unsupported | undefined {
  const t = norm(sentence);
  if (URGENT.test(t)) return;
  const f = factsOf(t);

  // The medicines the sentence names: hers by the record's spelling, and any called hers that the record does not hold.
  const named = new Set<string>();
  let medicine = false;
  const calledHers = (at: number, end: number) =>
    /\byour\s+(?:[a-z-]+\s+){0,2}$|[您你]的[^,。;]{0,6}$|\byou(?:'re| are| were| have been)?\s+(?:[a-z]+\s+)?(?:taking|given|prescribed)\s+(?:[a-z-]+\s+){0,2}$|\bubat\s+(?:anda|awak|kamu|you)\s+$/.test(t.slice(0, at))
    || /^\s+(?:[a-z]+\s+)?(?:anda|awak|kamu)\b/.test(t.slice(end));
  for (const m of t.matchAll(/[a-z][a-z-]{3,}/g)) {
    const own = g.medicines.get(fold(m[0]));
    if (own) named.add(own);
    else if (m[0].search(MEDICINE) === 0) {
      medicine = true;
      if (calledHers(m.index, m.index + m[0].length)) return { reason: "medicine", fact: m[0] };
    }
  }
  // A Chinese name is known only by its characters: the longest run ending in a medicine's ending that the record or a passage holds.
  for (const [re, lead] of [[ZH_MEDICINE_ENDING, [4, 3, 2, 1]], [ZH_MEDICINE, [0]]] as const) for (const m of t.matchAll(re)) {
    const end = m.index + m[0].length, names = lead.map(k => t.slice(Math.max(0, m.index - k), end));
    const own = names.find(n => g.text.includes(n));
    medicine = true;
    if (own) named.add(own);
    else if (!names.some(n => g.passageText.includes(n)) && calledHers(m.index, end)) return { reason: "medicine", fact: names.at(-2) ?? names[0]! }; // most generic names are two characters and the ending
  }

  const you = YOU.test(t), own = named.size > 0, appointment = APPOINTMENT.test(t), visit = appointment || VISIT.test(t);
  const told = INSTRUCTION.test(t) && !NOBODY_IN_PARTICULAR.test(t);
  const aboutMedicine = own || medicine || MEDICINE_WORD.test(t) || f.doses.length > 0;
  /** A treatment said to her: its dose, frequency and duration must be her record's. */
  const treatment = aboutMedicine && (you || own || told);
  // Beside one medicine of hers, only that medicine's lines count; a passage never speaks for her own medicine.
  const [only] = named.size === 1 ? [...named] : [];
  const lines = only === undefined ? undefined : g.record.filter(s => s.text.includes(only));
  const treatmentLines = lines ?? [...g.record, ...g.passages];
  const visitLines = g.record.filter(s => s.visit);
  const whenLines = lines ?? [...(visit && !aboutMedicine && visitLines.length ? visitLines : g.record), ...(you || own || appointment ? [] : g.passages)];

  if (treatment) {
    for (const dose of f.doses) if (!treatmentLines.some(s => s.doses.some(d => d.n === dose.n && d.unit === dose.unit))) return { reason: "dose", fact: dose.raw };
    const known = treatmentLines.flatMap(s => s.freqs.map(x => x.n));
    for (const freq of f.freqs) if (known.length && !known.includes(freq.n)) return { reason: "frequency", fact: freq.raw };
    // The days from today to a date on those lines also count: the last dose tomorrow is "1 more day", or 2 with today's.
    const left = g.today === undefined ? [] : treatmentLines.flatMap(s => s.dates).flatMap(d => d.m && d.y ? [dayNumber(d.y, d.m, d.d) - g.today!] : []).filter(n => n >= 0);
    for (const lasts of f.durations) if (!treatmentLines.some(s => s.durations.some(d => d.n === lasts.n)) && !left.some(n => lasts.n === n || lasts.n === n + 1)) return { reason: "duration", fact: lasts.raw };
  }

  for (const value of f.values) {
    const before = t.slice(Math.max(0, value.at - 40), value.at);
    if (LIMIT_BEFORE.test(before.slice(-25)) || LIMIT_AFTER.test(t.slice(value.end))) continue;
    // The result the number belongs to: the nearest one named before it.
    const measure = MEASURES.map(re => ({ re, at: [...before.matchAll(re)].at(-1)?.index ?? -1 })).filter(m => m.at >= 0).sort((a, b) => b.at - a.at)[0]?.re;
    if (!measure && !ANY_RESULT.test(before) && !(you && value.unit && value.unit !== "%")) continue;
    const held = measure ? g.record.filter(s => s.text.search(measure) >= 0) : g.record;
    if (!held.some(s => s.values.some(v => v.n === value.n && (!v.unit || !value.unit || v.unit === value.unit)))) return { reason: "result", fact: value.raw };
  }

  const timed = visit || treatment;
  for (const date of f.dates) if ((timed || date.m !== undefined) && !whenLines.some(s => s.dates.some(d => sameDay(date, d)))) return { reason: "date", fact: date.raw };
  if (timed) {
    for (const day of f.weekdays) if (!whenLines.some(s => s.weekdays.some(w => w.n === day.n))) return { reason: "date", fact: day.raw };
    for (const time of f.times) if (!whenLines.some(s => s.times.some(x => time.at.includes(x.at[0]!)))) return { reason: "time", fact: time.raw };
  }
}

/**
 * An answer as its sentences, each with the space before it, so joining them gives the answer back. A stop ends a
 * sentence; a decimal point, "a.m." and a list's "1." do not.
 */
export const sentencesOf = (text: string) =>
  text.split(/(?<=[。！？!?])(?![。！？!?\n])|(?<=\n)(?!\n)|(?<=\.)(?<!\b(?:a\.m|p\.m|dr|mr|mrs|e\.g|i\.e|vs)\.)(?<!(?:^|\n)[ \t]*\d{1,2}\.)(?=[^\S\n])/i).filter(Boolean);

/**
 * A whole typed answer: `kept` is the answer without its unsupported sentences, `removed` those sentences and why,
 * `changed` whether any was removed, and `text` what to show: the answer itself when nothing was removed, else what was
 * kept and then, once, the line that says so in her language (NOT_FOUND).
 */
export function grounded(answer: string, grounds: Grounds, language: Language = "en") {
  const removed: (Unsupported & { sentence: string })[] = [];
  const kept = sentencesOf(answer).filter(s => {
    const why = unsupported(s, grounds);
    if (why) removed.push({ sentence: s.trim(), ...why });
    return !why;
  }).join("").trim();
  if (!removed.length) return { text: answer, kept: answer, removed, changed: false };
  return { text: [kept, NOT_FOUND[language]].filter(Boolean).join(language === "zh" ? "" : " "), kept, removed, changed: true };
}
