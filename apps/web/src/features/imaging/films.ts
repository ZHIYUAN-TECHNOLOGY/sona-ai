/** One film `xray.similar` returns: whose, when, how close, and what was read on it. */
export type SimilarFilm = { encounterId: string; patientId: string; patientName: string; uploadedAt: Date | string; score: number; findings: string[] };

/**
 * The Compare card's two lists: this patient's own earlier films oldest first (a nodule's history reads forward), then
 * the hospital's similar films nearest first. Without a patient every film is "similar".
 */
export function groupFilms<F extends SimilarFilm>(films: F[], patientId: string | undefined) {
  const earlier = films.filter(f => f.patientId === patientId).sort((a, b) => +new Date(a.uploadedAt) - +new Date(b.uploadedAt));
  const similar = films.filter(f => f.patientId !== patientId).sort((a, b) => b.score - a.score);
  return { earlier, similar };
}

/** "7 Oct", the day a film was taken, in the hospital's time zone. */
export const shortDay = (at: Date | string) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" });

/**
 * "Chest X-ray · Amelia Tan · 7 Oct", from the library title an answer cites ("Chest X-ray: Amelia Tan, 7 Oct 2026",
 * routers/xray.ts indexXray) or from a name and a date. Any other title is shown as it is.
 */
export function filmTitle(from: string | { name?: string; at?: Date | string }) {
  if (typeof from !== "string") return ["Chest X-ray", from.name, from.at && shortDay(from.at)].filter(Boolean).join(" · ");
  const m = /^Chest X-ray: (.+), (\d{1,2} \w{3,4})(?: \d{4})?$/.exec(from);
  return m ? `Chest X-ray · ${m[1]} · ${m[2]}` : from;
}

/** The cited reading without the "Patient: … Chest X-ray taken …" line indexXray writes first. */
export const readingOf = (text: string) => text.replace(/^Patient:[^\n]*\n/, "").trim() || text;

/** The follow-up test as the API writes it on a finding (findings.ts testOf). */
export const testOf = (action?: string | null) => action?.split(/,| at /)[0]?.trim() || "follow-up test";

type Finding = { kind: string; status: string; action?: string | null; dueAt?: Date | string | null };
/** A finding's chip: a nodule still waiting must not be missed; tracked is done; dismissed is quiet. */
export const findingTone = (f: Finding) => (f.status === "tracked" ? "done" : f.status === "dismissed" ? "neutral" : f.kind === "nodule" ? "urgent" : "soon");
/** "CT chest by 7 Jan": what the finding asks for and by when; nothing when no follow-up is due. */
export const followUpOf = (f: Finding) => (f.dueAt && f.status !== "dismissed" ? `${testOf(f.action)} by ${shortDay(f.dueAt)}` : undefined);
