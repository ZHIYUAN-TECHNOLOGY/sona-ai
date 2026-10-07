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
