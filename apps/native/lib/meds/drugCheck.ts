// Pure medication-safety checker. Scans a note's Orders for known drugs and flags
// standard cautions + well-established interactions. Deterministic + unit-tested; no
// native deps. REFERENCE SUPPORT ONLY — it never computes a dose or prescribes; the
// UI labels it as such and the clinician decides. Runs on-device.

export interface DrugEntry {
  name: string;
  aliases: string[];
  klass?: string;
  /** Standard adult max, only where unambiguous (e.g. "4 g/day"). */
  maxDoseAdult?: string;
  /** One-line caution/principle. */
  note?: string;
  source?: string;
}

export interface Interaction {
  /** generic name OR class (lowercase). */
  a: string;
  b: string;
  severity: "severe" | "moderate";
  risk: string;
  source: string;
}

export type FlagSeverity = "severe" | "moderate" | "info";
export interface DrugFlag {
  severity: FlagSeverity;
  message: string;
  source?: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Known drugs (by name or alias, whole-word, case-insensitive) present in `text`. */
export function drugsInText(text: string, entries: DrugEntry[]): DrugEntry[] {
  const out: DrugEntry[] = [];
  for (const d of entries) {
    const names = [d.name, ...d.aliases].filter(Boolean);
    const re = new RegExp(`\\b(?:${names.map(escapeRe).join("|")})\\b`, "i");
    if (re.test(text)) out.push(d);
  }
  return out;
}

const RANK: Record<FlagSeverity, number> = { severe: 0, moderate: 1, info: 2 };

/**
 * Check a note's orders. Emits, most-severe first:
 *  • interaction flags when two interacting drugs/classes both appear in the orders;
 *  • an informational reminder per present drug that carries a max dose or caution.
 * Drugs are matched across ALL orders (interactions can span two order lines).
 */
export function checkOrders(
  orders: { text: string }[],
  entries: DrugEntry[],
  interactions: Interaction[],
): DrugFlag[] {
  // Present drugs (unique by name) across every order line.
  const present = new Map<string, DrugEntry>();
  for (const o of orders) {
    for (const d of drugsInText(o.text, entries)) present.set(d.name, d);
  }
  const drugs = [...present.values()];

  // Tokens each present drug can be referred to by (name/alias/class), for matching
  // an interaction's a/b which may be a class.
  const tokenToNames = new Map<string, Set<string>>();
  const add = (tok: string, name: string) => {
    const k = tok.toLowerCase();
    if (!tokenToNames.has(k)) tokenToNames.set(k, new Set());
    tokenToNames.get(k)!.add(name);
  };
  for (const d of drugs) {
    add(d.name, d.name);
    for (const a of d.aliases) add(a, d.name);
    if (d.klass) add(d.klass, d.name);
  }

  const flags: DrugFlag[] = [];
  const seen = new Set<string>();

  for (const it of interactions) {
    const aNames = tokenToNames.get(it.a.toLowerCase());
    const bNames = tokenToNames.get(it.b.toLowerCase());
    if (!aNames || !bNames) continue;
    // Must be two DIFFERENT present drugs (not the same drug matching both sides).
    const distinct = [...aNames].some((n) => [...bNames].some((m) => m !== n));
    if (!distinct) continue;
    const key = `x:${[it.a, it.b].sort().join("+")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({ severity: it.severity, message: it.risk, source: it.source });
  }

  for (const d of drugs) {
    const bits: string[] = [];
    if (d.maxDoseAdult) bits.push(`max ${d.maxDoseAdult}`);
    if (d.note) bits.push(d.note);
    if (bits.length === 0) continue;
    const key = `i:${d.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({ severity: "info", message: `${d.name} — ${bits.join("; ")}`, source: d.source });
  }

  return flags.sort((x, y) => RANK[x.severity] - RANK[y.severity]);
}
