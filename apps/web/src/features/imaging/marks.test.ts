// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { filmUrl, onImage } from "./marks";

test("only open findings read from this very film are drawn on it", () => {
  const at = { box: [0.1, 0.1, 0.2, 0.2] };
  const rows = [
    { id: "a", imageKey: "film-1", status: "open", location: at },
    { id: "b", imageKey: "film-1", status: "dismissed", location: at },
    { id: "c", imageKey: "film-0", status: "open", location: at },
    { id: "d", imageKey: null, status: "tracked", location: at },
  ];
  expect(onImage(rows, "film-1").map(f => f.id)).toEqual(["a"]);
  expect(onImage(rows, undefined)).toEqual([]);
  expect(filmUrl({ contentType: "image/png", dataBase64: "AAAA" })).toBe("data:image/png;base64,AAAA");
});
