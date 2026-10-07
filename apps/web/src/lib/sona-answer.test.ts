// @ts-expect-error apps/web has no bun types yet; add @types/bun and drop this line
import { expect, test } from "bun:test";

import { type Answer, apply, newTurn } from "@/features/evidence/thread";

import { phaseOf, rowPatient, rulesAnswer } from "./sona-answer";

const spec = (...parts: { type: string; props: Record<string, unknown> }[]) => ({
  root: "r",
  elements: { r: { type: "AskColumn", props: {}, children: parts.map((_, i) => `p${i}`) }, ...Object.fromEntries(parts.map((p, i) => [`p${i}`, p])) },
});

test("an ask spec becomes a rule answer: lead, rows, only patient ops kept, who wrote it", () => {
  const answer = rulesAnswer({
    source: "rules",
    spec: spec(
      { type: "AskLead", props: { text: "Amelia Tan needs you first." } },
      { type: "AskRows", props: { rows: [
        { id: "p1", title: "Amelia Tan", detail: "NEWS 7", tone: "urgent", op: "open:p1" },
        { id: "t1", title: "Chase the echo", detail: "", tone: "soon", op: "task-done:t1" },
      ] } },
    ),
  });
  expect(answer).toEqual({
    kind: "rules", lead: "Amelia Tan needs you first.", by: "rules",
    rows: [{ id: "p1", title: "Amelia Tan", detail: "NEWS 7", tone: "urgent", op: "open:p1" }, { id: "t1", title: "Chase the echo", tone: "soon" }],
  });
  expect(answer!.rows.map(rowPatient)).toEqual(["p1", undefined]);
});

test("calm rows are counted, a review adds its items, the model is named, and an empty spec is no answer", () => {
  const calm = rulesAnswer({ source: "model", model: "Gemma 3 27B", spec: spec(
    { type: "AskLead", props: { text: "Two visits today." } },
    { type: "AskRows", props: { rows: [{ id: "a", title: "A", detail: "9:00", tone: "calm" }, { id: "b", title: "B", detail: "10:00", tone: "calm" }] } },
  ) });
  expect(calm).toMatchObject({ by: "Gemma 3 27B", heading: "2 items" });
  const review = rulesAnswer({ source: "fixture", spec: spec({ type: "AskReview", props: { title: "Discharge Amelia?", items: ["Oral switch done"] } }) });
  expect(review).toEqual({ kind: "rules", lead: "Discharge Amelia?", rows: [{ title: "Oral switch done", tone: "calm" }], heading: "1 item", by: undefined });
  expect(rulesAnswer({ source: "fixture" })).toBeUndefined();
});

test("stream events move an evidence turn through search, read, write and done", () => {
  let turn = newTurn("a", "Steroids for CAP?");
  expect(phaseOf(turn)).toBe("search");
  turn = apply(turn, { type: "step", step: "read", studies: 0, passages: 0, references: [] });
  expect(phaseOf(turn)).toBe("read");
  turn = apply(turn, { type: "step", step: "write" });
  expect(phaseOf(turn)).toBe("write");
  turn = apply(turn, { type: "bottomLine", text: "Not routinely." });
  expect(phaseOf(turn)).toBe("write");
  turn = apply(turn, { type: "answer", answer: { bottomLine: "Not routinely.", claims: [], references: [], source: "gemma" } as unknown as Answer });
  expect(phaseOf(turn)).toBe("done");
  expect(phaseOf({ ...newTurn("b", "?"), failed: "no" })).toBe("done");
});
