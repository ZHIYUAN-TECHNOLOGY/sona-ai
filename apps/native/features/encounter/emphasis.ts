import type { Patient } from "./types";

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Wraps the first mention of each term in `[[term|mark]]`; any markup turns the colour dictionary off for that text. */
export function markTerms(text: string, terms: [string | undefined, "alert" | "caution" | "finding"][]) {
  // A term starts a word and is not the tail of a hyphenated one ("non-severe" is not "severe").
  return terms.reduce((out, [term, mark]) => term ? out.replace(new RegExp(`(?<![\\w-])${escape(term)}`, "i"), found => `[[${found}|${mark}]]`) : out, text);
}

/** Only what is abnormal or must be acted on gets a colour: a raised temperature and its fever amber, the recorded allergen red. */
export function emphasise(text: string, patient: Patient) {
  const temp = patient.vitals.find(v => v.label === "Temp")?.value;
  const raised = temp !== undefined && parseFloat(temp) >= 37.8; // the vitals card's "Raised" threshold
  return markTerms(text, [[raised ? temp : undefined, "caution"], [raised ? "fever" : undefined, "caution"], [patient.allergies?.split(" — ")[0], "alert"]]);
}
