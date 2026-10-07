// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { filmTitle, findingTone, followUpOf, groupFilms, readingOf } from "./films";

const film = (encounterId: string, patientId: string, uploadedAt: string, score: number) => ({ encounterId, patientId, patientName: patientId, uploadedAt, score, findings: [] });

test("the patient's own films come first, oldest first; the rest nearest first", () => {
  const films = [film("c", "other", "2026-09-01", 0.9), film("a", "me", "2026-08-02", 0.7), film("d", "other", "2026-05-01", 0.95), film("b", "me", "2026-03-01", 0.6)];
  const { earlier, similar } = groupFilms(films, "me");
  expect(earlier.map(f => f.encounterId)).toEqual(["b", "a"]);
  expect(similar.map(f => f.encounterId)).toEqual(["d", "c"]);
  expect(groupFilms(films, undefined).earlier).toEqual([]);
});

test("a film's title line, from the cited title or a name and a date", () => {
  expect(filmTitle("Chest X-ray: Amelia Tan, 7 Oct 2026")).toBe("Chest X-ray · Amelia Tan · 7 Oct");
  expect(filmTitle("Chest X-ray: Tan, Mei Ling, 17 Sept 2026")).toBe("Chest X-ray · Tan, Mei Ling · 17 Sept");
  expect(filmTitle("Some other film")).toBe("Some other film");
  expect(filmTitle({ name: "Amelia Tan", at: "2026-10-06T20:00:00Z" })).toBe("Chest X-ray · Amelia Tan · 7 Oct");
  expect(filmTitle({})).toBe("Chest X-ray");
});

test("the reading drops the patient line the library stores first", () => {
  expect(readingOf("Patient: Amelia Tan (SYN-1). Chest X-ray taken 7 Oct 2026.\nRight lower lobe consolidation.")).toBe("Right lower lobe consolidation.");
  expect(readingOf("No effusion.")).toBe("No effusion.");
});

test("a finding's chip tone and follow-up", () => {
  expect(findingTone({ kind: "nodule", status: "open" })).toBe("urgent");
  expect(findingTone({ kind: "effusion", status: "open" })).toBe("soon");
  expect(findingTone({ kind: "nodule", status: "tracked" })).toBe("done");
  expect(findingTone({ kind: "nodule", status: "dismissed" })).toBe("neutral");
  expect(followUpOf({ kind: "nodule", status: "open", action: "CT chest at 3 months, PET-CT", dueAt: "2027-01-07T02:00:00Z" })).toBe("CT chest by 7 Jan");
  expect(followUpOf({ kind: "nodule", status: "open", dueAt: null })).toBeUndefined();
  expect(followUpOf({ kind: "nodule", status: "dismissed", dueAt: "2027-01-07T02:00:00Z" })).toBeUndefined();
});
