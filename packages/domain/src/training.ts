/**
 * Continuous training on hospital data without identity: consent → capture → de-identify → leak gate
 * → steward review → versioned export. Pure rules here; the routes live in packages/api (training.ts).
 * A sample only ever holds de-identified text; the raw note or reply stays in its own table.
 */
export type IdentityKind = "name" | "ic" | "phone" | "email" | "mrn";
export type Replacement = { kind: IdentityKind; placeholder: string };
/** What the de-identifier and the gate know about the patient: their record's own identifiers. */
export type KnownIdentity = { names: string[]; ic?: string; phone?: string; mrn?: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const digitsOf = (s: string) => s.replace(/\D/g, "");
/** Digits with an optional space or dash between each, so "011-0000 0000" matches "01100000000". */
const spaced = (digits: string) => digits.split("").join("[\\s-]?");

/** YYMMDD-PB-###G, dashes optional, and only when YYMMDD is a real date (so an order number is left alone). */
const IC = /(?<![\d+])(\d{2})(\d{2})(\d{2})-?\d{2}-?\d{4}(?!\d)/g;
const validDate = (yy: string, mm: string, dd: string) => {
  const d = new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd)));
  return d.getUTCMonth() === Number(mm) - 1 && d.getUTCDate() === Number(dd);
};
/** Malaysian mobiles: +60 or 0, then 1x, then 7 or 8 more digits, spaces or dashes allowed. */
const PHONE = /(?<![\d+])(?:\+?60|0)1\d(?:[\s-]?\d){7,8}(?!\d)/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * The rule-based de-identifier behind the model seam's stub. It replaces the patient's FULL names only
 * ("Amelia Tan" → [NAME]), so a first name alone slips through; the leak gate is what catches that.
 * ponytail: rules stand in for OpenMed's clinical PII model (openmed-skills: deidentifying-clinical-text), which also finds partial names and other people.
 */
export function deidentifyByRules(text: string, known: KnownIdentity): { text: string; replacements: Replacement[] } {
  const replacements: Replacement[] = [];
  const swap = (re: RegExp, kind: IdentityKind, keep: (m: string[]) => boolean = () => true) => {
    text = text.replace(re, (...m: string[]) => {
      if (!keep(m)) return m[0]!;
      replacements.push({ kind, placeholder: `[${kind.toUpperCase()}]` });
      return `[${kind.toUpperCase()}]`;
    });
  };
  for (const name of known.names.map(n => n.trim()).filter(Boolean).sort((a, b) => b.length - a.length))
    swap(new RegExp(`\\b${name.split(/\s+/).map(escape).join("\\s+")}\\b`, "gi"), "name");
  if (known.mrn) swap(new RegExp(`\\b${escape(known.mrn)}\\b`, "gi"), "mrn");
  swap(EMAIL, "email");
  swap(IC, "ic", m => validDate(m[1]!, m[2]!, m[3]!));
  swap(PHONE, "phone");
  return { text, replacements };
}

/**
 * The leak gate: scans de-identified text for anything that still points at the patient (each name
 * token of 3+ letters as a whole word, the IC and phone digits, the MRN) and for any IC, phone or email
 * at all. Returns the kinds found (never the values) and the text with each hit masked as [LEAK].
 */
export function leakGate(text: string, known: KnownIdentity): { kinds: IdentityKind[]; masked: string } {
  const kinds = new Set<IdentityKind>();
  let masked = text;
  const scan = (re: RegExp, kind: IdentityKind, keep: (m: string[]) => boolean = () => true) => {
    masked = masked.replace(re, (...m: string[]) => {
      if (!keep(m)) return m[0]!;
      kinds.add(kind);
      return "[LEAK]";
    });
  };
  const tokens = [...new Set(known.names.flatMap(n => n.split(/[\s,'’.-]+/)).filter(t => /^\p{L}{3,}$/u.test(t)).map(t => t.toLowerCase()))];
  for (const token of tokens) scan(new RegExp(`(?<![\\p{L}\\p{N}])${escape(token)}(?![\\p{L}\\p{N}])`, "giu"), "name");
  if (known.mrn) scan(new RegExp(`\\b${escape(known.mrn)}\\b`, "gi"), "mrn");
  if (known.ic && digitsOf(known.ic).length >= 6) scan(new RegExp(spaced(digitsOf(known.ic)), "g"), "ic");
  const core = known.phone ? digitsOf(known.phone).replace(/^60/, "").replace(/^0/, "") : "";
  if (core.length >= 7) scan(new RegExp(spaced(core), "g"), "phone");
  scan(IC, "ic", m => validDate(m[1]!, m[2]!, m[3]!));
  scan(PHONE, "phone");
  scan(EMAIL, "email");
  return { kinds: [...kinds], masked };
}
