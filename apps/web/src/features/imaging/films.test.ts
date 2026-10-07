// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { groupFilms } from "./films";

const film = (encounterId: string, patientId: string, uploadedAt: string, score: number) => ({ encounterId, patientId, patientName: patientId, uploadedAt, score, findings: [] });

test("the patient's own films come first, oldest first; the rest nearest first", () => {
  const films = [film("c", "other", "2026-09-01", 0.9), film("a", "me", "2026-08-02", 0.7), film("d", "other", "2026-05-01", 0.95), film("b", "me", "2026-03-01", 0.6)];
  const { earlier, similar } = groupFilms(films, "me");
  expect(earlier.map(f => f.encounterId)).toEqual(["b", "a"]);
  expect(similar.map(f => f.encounterId)).toEqual(["d", "c"]);
  expect(groupFilms(films, undefined).earlier).toEqual([]);
});
