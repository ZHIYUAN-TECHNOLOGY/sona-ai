import { deidentifyByRules, type IdentityKind, type Replacement } from "@sona-ai/domain/training";

import type { Models } from "./models";

/**
 * Models.deidentify on the PII box (packages/infra/baseten/pii): OpenMed's clinical PII model behind OpenMed's own
 * REST service. The rules run first, so everything they catch is replaced before the text leaves the Worker and the
 * model can only add to it: first names alone, relatives, staff, landlines. Its finds take the rules' placeholders.
 * A cold or failing box leaves the rules' answer, labelled fixture, so an export is never held up by the model; the
 * leak gate (routers/training.ts) re-checks whatever comes back.
 */
export const PII_MODEL = "OpenMed/OpenMed-PII-mClinicalE5-Large-560M-v1";

// OpenMed's labels for what Sona replaces. ponytail: addresses, dates of birth and the rest are found but kept, since
// the review screen knows these five placeholders only; an [ADDRESS] starts there (apps/native/features/training/model.ts).
const KINDS = new Map<string, IdentityKind>([
  ["first_name", "name"], ["last_name", "name"], ["ssn", "ic"], ["phone_number", "phone"], ["fax_number", "phone"],
  ["email", "email"], ["medical_record_number", "mrn"], ["health_plan_beneficiary_number", "mrn"],
]);
const PLACEHOLDER = /\[(?:NAME|IC|PHONE|EMAIL|MRN)\]/g;

/** POSTs a JSON body to a route on the PII box and returns its JSON (baseten-models' `call`, bound to the box). */
export type PiiPost = (route: string, body: string) => Promise<unknown>;

export function piiModels(post: PiiPost, fallback: Models): Pick<Models, "deidentify"> {
  return {
    async deidentify(input) {
      const ruled = deidentifyByRules(input.text, input.known);
      // Nothing but placeholders left (a scan sends the bare name): nothing to find, so no box is woken for it.
      if (!/[\p{L}\p{N}]/u.test(ruled.text.replace(PLACEHOLDER, ""))) return fallback.deidentify(input);
      try {
        const out = await post("/pii/extract", JSON.stringify({ text: ruled.text, model_name: PII_MODEL, confidence_threshold: 0.5 }));
        const found = (out as { entities?: unknown } | undefined)?.entities;
        if (!Array.isArray(found)) throw new Error("The PII box answered without entities");
        const model = replaceFound(ruled.text, found);
        return { text: model.text, replacements: [...ruled.replacements, ...model.replacements], source: "model", model: PII_MODEL };
      } catch { return fallback.deidentify(input); }
    },
  };
}

/**
 * Replaces each name, IC, phone, email or record number the model found with its placeholder. OpenMed counts code
 * points and JS strings UTF-16 units (one emoji in a reply would shift every later span), so offsets are mapped
 * first. The rules' placeholders are never touched, and finds of one kind split only by spaces ("Mei" "Ling") become one.
 */
export function replaceFound(text: string, found: unknown[]): { text: string; replacements: Replacement[] } {
  const unit = [0]; // code point index → UTF-16 index
  for (const ch of text) unit.push(unit.at(-1)! + ch.length);
  const kinds: (IdentityKind | undefined)[] = [];
  for (const e of found as { label?: unknown; start?: unknown; end?: unknown }[]) {
    const kind = KINDS.get(String(e?.label).toLowerCase());
    let start = Number.isInteger(e?.start) ? unit[e.start as number] : undefined, end = Number.isInteger(e?.end) ? unit[e.end as number] : undefined;
    if (!kind || start === undefined || end === undefined) continue;
    // A number found in part takes its adjacent digits too (OpenMed once gave "-4021 5566" of "03-4021 5566").
    if (kind !== "name" && kind !== "email") {
      while (start > 0 && /[\d+-]/.test(text[start - 1]!)) start--;
      while (end < text.length && /[\d+-]/.test(text[end]!)) end++;
    }
    for (let i = start; i < end; i++) if (text[i]!.trim()) kinds[i] ??= kind;
  }
  for (const m of text.matchAll(PLACEHOLDER)) for (let i = m.index; i < m.index + m[0].length; i++) kinds[i] = undefined;

  let out = "", at = 0;
  const replacements: Replacement[] = [];
  while (at < text.length) {
    const kind = kinds[at];
    if (!kind) { out += text[at++]; continue; }
    let end = at;
    for (;;) {
      while (kinds[end] === kind) end++;
      let next = end;
      while (text[next] === " ") next++;
      if (next === end || kinds[next] !== kind) break;
      end = next;
    }
    const placeholder = `[${kind.toUpperCase()}]`;
    out += placeholder;
    replacements.push({ kind, placeholder });
    at = end;
  }
  return { text: out, replacements };
}
