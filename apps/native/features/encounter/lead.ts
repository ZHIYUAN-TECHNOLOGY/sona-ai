import { isRehearsed } from "@sona-ai/domain/evidence";
import { testInSentence } from "@/features/day/model";
import { emphasise } from "./emphasis";
import type { Capability, MedicationEntry, Patient } from "./types";

/**
 * What an answer's card shows, as far as its one-line lead needs it. Built from the same state the
 * card reads (the encounter, the card's own snapshot, the server's answer), so the lead can't say
 * one thing above a card that says another.
 */
export type LeadState = {
  /** The medicines as the card lists them. */
  medicines?: Pick<MedicationEntry, "confirmed" | "ingredient" | "formulation">[];
  /** The X-ray card's image: the reference example, the clinician's own, an unsupported or empty sample, or none at all. */
  image?: "reference" | "attached" | "read" | "unsupported" | "no-finding" | "none";
  note?: "none" | "draft" | "reviewed";
  prescription?: "created" | "failed" | "blocked" | "outside" | "ready";
  tasks?: { total: number; open: number };
  /** Evidence: the rehearsed or an authored answer (demo), live mode off, or the server's answer (cited, general when no source answers, or none). */
  evidence?: "rehearsed" | "authored" | "off" | "enough" | "general" | "not-enough";
  /** A new result for this patient nobody has acknowledged (the briefing leads with it). */
  result?: { test: string };
};

/** How many medicines are confirmed, and whether all are (with an ingredient and a form), as the medication card counts them. */
export function medicinesConfirmed(entries: NonNullable<LeadState["medicines"]>) {
  const confirmed = entries.filter(e => e.confirmed).length;
  return { total: entries.length, confirmed, all: entries.length > 0 && entries.every(e => e.confirmed && e.ingredient.trim() && e.formulation.trim()) };
}

const first = (patient: Patient) => patient.name.split(" ")[0]!;

/** The one-sentence lead above an answer; undefined when the card has nothing settled to summarise yet. None is model output. */
export function leadFor(kind: Capability, patient: Patient, state: LeadState, prompt = ""): string | undefined {
  const name = first(patient);
  const allergy = patient.allergies ? `${patient.allergies.split(" — ")[0]} allergy still needs confirming.` : "Allergy history is unknown.";
  switch (kind) {
    case "briefing": {
      const result = state.result ? ` A new ${testInSentence(state.result.test)} result needs acknowledging.` : "";
      // Only the abnormal is coloured (fever with a raised temperature), not every noun.
      if (patient.incomplete) return `${name} is here with ${patient.complaint.charAt(0).toLowerCase()}${patient.complaint.slice(1).replace(/\.$/, "")}, and most of the history is still missing.${result}`;
      return emphasise(`${name} is ${patient.age} and here for a ${patient.subtitle.toLowerCase()}. ${patient.complaint}${result}`, patient);
    }
    case "reasoning": return patient.incomplete ? "There isn’t enough history yet to weigh possibilities. Here’s what to collect first." : "Two possibilities are worth exploring. The record doesn’t confirm either of them.";
    case "medication": {
      const { total, confirmed, all } = medicinesConfirmed(state.medicines ?? []);
      const meds = !total ? "No medicines are recorded yet."
        : all ? (total === 1 ? "The one medicine is confirmed." : total === 2 ? "Both medicines are confirmed." : `All ${total} medicines are confirmed.`)
        : `${confirmed} of ${total} medicines confirmed. The rest block the prescribing simulation.`;
      return emphasise(`${meds} ${allergy}`, patient);
    }
    case "xray": return {
      reference: "Here’s a reference chest radiograph, not this patient’s, with its uploader’s description. It isn’t a model reading.",
      attached: "Your image is attached. Nothing has been read from it, so there are no findings.",
      read: "The image model has described your image. It is unvalidated, so check it against the film.",
      unsupported: "This image is outside chest radiography, so no interpretation is available.",
      "no-finding": "This sample returned no finding result. That doesn’t mean the examination is normal.",
      none: "No image is attached, so there are no findings yet.",
    }[state.image ?? "reference"];
    case "prescription": return state.prescription === "created" ? "The prescribing simulation passed every check and created a receipt."
      : state.prescription === "failed" ? "The prescribing simulation failed, so no receipt was created."
      : state.prescription === "outside" ? "A recorded risk puts this case outside what the simulation supports, so nothing will be prescribed."
      : state.prescription === "ready" ? "Every check has passed. Review the regimen below, then prescribe."
      : "Nothing is prescribed yet. The checks below say what still blocks the simulation.";
    case "followup": {
      const t = state.tasks;
      if (!t?.total) return "One follow-up is proposed. Give it an owner and a date to make it a task.";
      return t.open ? `${t.open} ${t.open === 1 ? "follow-up is" : "follow-ups are"} open for ${name}.` : `All of ${name}’s follow-ups are done.`;
    }
    case "note": return state.note === "reviewed" ? "The consultation note is marked reviewed."
      : state.note === "draft" ? "Here’s the note drafted from the transcript. The assessment and plan are yours to add."
      : "No note yet. Play the sample consultation, then draft the note from it.";
    case "evidence": switch (state.evidence) {
      // The steroid summary belongs to the rehearsed question only.
      case "rehearsed": return !prompt || isRehearsed(prompt) ? `The evidence is against routine steroids here. ${name}’s severity score decides which studies apply.` : "Here’s what the cited studies say.";
      case "authored": case "enough": return "Here’s what the cited sources say. Each claim links to its study.";
      case "general": return "No source covers this, so here’s a general answer, not from the evidence.";
      case "not-enough": return "Not enough evidence was found to answer this.";
      case "off": return "Live mode answers this from PubMed and your library. It’s off now.";
      default: return undefined; // still searching, or the search failed: the card says which
    }
  }
}
