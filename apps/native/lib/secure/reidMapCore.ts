// Pure re-identify helpers — NO native-module imports, so these are unit-testable
// under plain node (see ../db/db.test.ts). reidMap.ts imports the SecureStore
// wrappers around these and re-exports everything from one module.
//
// MOAT RULE: the ReidMap (token → real value) is device-only and must never be
// transmitted. These helpers only shape/apply it in memory; persistence goes
// through the secure enclave in reidMap.ts.

/**
 * The re-identify map for one consult: redaction token → real value.
 * e.g. { NAME_1: "Rahman bin Ismail", IC_1: "580214-05-5321", ... }
 * `NAME_UNCERTAIN_1` may be present but held pending clinician confirmation.
 */
export type ReidMap = Record<string, string>;

/** SecureStore key holding a consult's re-ID map (JSON-encoded ReidMap). */
export function storageKey(consultId: string): string {
  return `sona.reidmap.${consultId}`;
}

/** SecureStore key holding a consult's sealed audio hash (audio itself is discarded). */
export function audioSealKey(consultId: string): string {
  return `sona.audioseal.${consultId}`;
}

/** Pure merge helper: start from a base map and layer new token→value entries. */
export function buildReidMap(base: ReidMap, entries: ReidMap): ReidMap {
  return { ...base, ...entries };
}

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

/**
 * Pure, on-device substitution: replace each token in `text` with its real value.
 * Longer tokens are replaced first so NAME_UNCERTAIN_1 wins over a NAME_1 substring.
 * Replacement is BOUNDARY-GUARDED: a token must not be preceded by a word character
 * (so the consult's NAME_1 never fires inside a scanned document's DOC_NAME_1 token —
 * that spliced the consult patient's real name into the document's slot) and must not
 * be followed by a digit (so NAME_1 never eats the front of an unmapped NAME_12).
 * The result must never be transmitted.
 */
export function applyReidMap(map: ReidMap, text: string): string {
  let out = text;
  for (const token of Object.keys(map).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![A-Za-z0-9_])${token.replace(RE_ESCAPE, "\\$&")}(?![0-9])`, "g");
    out = out.replace(re, () => map[token]);
  }
  return out;
}
