import { expect, test } from "bun:test";
import { patients } from "@/features/encounter/fixtures";
import { routePrompt } from "@/features/encounter/state";
import { STUDIES, curb65, pubmedUrl } from "./model";

test("CURB-65 scores the demo patient from her chart", () => {
  const r = curb65(patients.find(p => p.id === "SYN-1042"));
  expect(r).toMatchObject({ score: 0, recorded: 5 });
  expect(r.risk).toStartWith("Low risk");
});

test("an unrecorded factor stays unknown and withholds the risk band", () => {
  const r = curb65(patients.find(p => p.incomplete));
  expect(r.recorded).toBe(1);
  expect(r.risk).toBeUndefined();
});

test("evidence questions route to the evidence answer", () => {
  expect(routePrompt("Should Amelia get steroids for her pneumonia?")).toBe("evidence");
  expect(routePrompt("What does the guideline say?")).toBe("evidence");
  expect(routePrompt("Run the prescribing simulation")).toBe("prescription");
  expect(STUDIES.map(pubmedUrl)).toEqual(["https://pubmed.ncbi.nlm.nih.gov/31573350/", "https://pubmed.ncbi.nlm.nih.gov/25608756/", "https://pubmed.ncbi.nlm.nih.gov/36942789/"]);
});
