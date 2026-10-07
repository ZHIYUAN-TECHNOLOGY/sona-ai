import { expect, test } from "bun:test";
import { groupFilms } from "./compare";

const film = (encounterId, patientId, uploadedAt, score) => ({ encounterId, patientId, patientName: patientId, uploadedAt, score, findings: [] });

test("this patient's earlier films come first, oldest first; the others follow by likeness; today's own film is left out", () => {
  const films = [
    film("other-1", "p2", "2026-09-01", 0.7),
    film("mine-new", "p1", "2026-09-20", 0.9),
    film("other-2", "p2", "2026-08-01", 0.95),
    film("mine-old", "p1", "2025-03-05", 0.6),
    film("today", "p1", "2026-10-07", 1),
  ];
  const { earlier, similar } = groupFilms(films, "p1", "today");
  expect(earlier.map(f => f.encounterId)).toEqual(["mine-old", "mine-new"]);
  expect(similar.map(f => f.encounterId)).toEqual(["other-2", "other-1"]);
});

test("no films: both groups empty", () => {
  expect(groupFilms([], "p1", "today")).toEqual({ earlier: [], similar: [] });
});
