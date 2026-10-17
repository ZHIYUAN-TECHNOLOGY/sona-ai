import { expect, test } from "bun:test";
import { dataUri, filmMarkers, leadImage } from "./film";

const film = { n: 1, id: "img", kind: "image", design: "Imaging", title: "Chest X-ray: Amelia Tan, 3 Oct 2026", year: 2026, text: "Right upper zone nodule.", encounterId: "enc-1" };
const study = { n: 1, id: "s", kind: "study", design: "Trial", title: "A trial", year: 2019, text: "..." };

test("the film leads the answer only when it is the first source", () => {
  expect(leadImage([film, { ...study, n: 2 }])).toBe(film);
  expect(leadImage([study, { ...film, n: 2 }])).toBeUndefined();
  expect(leadImage([])).toBeUndefined();
});

test("the stored bytes become a data URI of their own content type", () => {
  expect(dataUri({ contentType: "image/png", dataBase64: "AAAA" })).toBe("data:image/png;base64,AAAA");
});

test("only findings read from this film mark it, numbered in order, dismissed ones left out", () => {
  const rows = [
    { id: "a", imageKey: "k1", label: "9 mm nodule", status: "new", location: { x: 0.34, y: 0.3, box: [0.26, 0.29, 0.34, 0.39] } },
    { id: "b", imageKey: "k1", label: "Old scar", status: "dismissed", location: { x: 0.5, y: 0.5 } },
    { id: "c", imageKey: "k2", label: "Other film", status: "new", location: { x: 0.1, y: 0.1 } },
    { id: "d", imageKey: "k1", label: "Heart size", status: "tracked", location: { x: 0.56, y: 0.62, box: null } },
  ];
  expect(filmMarkers(rows, "k1")).toEqual([
    { id: "a", n: 1, x: 0.34, y: 0.3, label: "9 mm nodule", box: [0.26, 0.29, 0.34, 0.39] },
    { id: "d", n: 2, x: 0.56, y: 0.62, label: "Heart size", box: undefined },
  ]);
});
