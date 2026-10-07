/*
 * "Is this nodule new?": the films to set beside today's. The pure part: this patient's own earlier films first, oldest
 * first (a finding's course reads forward in time), then the hospital's similar films in the server's order of likeness.
 * Today's own film never appears (a phrase search does not exclude it, as a likeness search does).
 */
export type SimilarFilm = { encounterId: string; patientId: string; patientName: string; uploadedAt: string | Date; score: number; findings: string[] };

export function groupFilms<F extends SimilarFilm>(films: F[], patientId: string, encounterId: string) {
  const others = films.filter(f => f.encounterId !== encounterId);
  const earlier = others.filter(f => f.patientId === patientId).sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());
  const similar = others.filter(f => f.patientId !== patientId).sort((a, b) => b.score - a.score);
  return { earlier, similar };
}

export const filmDate = (at: string | Date) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
