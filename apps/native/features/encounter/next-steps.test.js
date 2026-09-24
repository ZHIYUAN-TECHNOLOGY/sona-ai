import { expect, test } from "bun:test";
import { patients } from "./fixtures";
import { nextSteps } from "./next-steps";

const base = { revision: 1, cards: [], requests: [], note: "", noteReviewed: false, transcript: [], recording: "idle", recordingSeconds: 0, language: "english", tasks: [] };

test("steps start at the first unconfirmed medicine and end at the simulation", () => {
  const steps = nextSteps("medication", base, patients[0]);
  expect(steps[0].id).toBe("confirm-medicine-0");
  expect(steps.find(step => !step.done).action.type).toBe("confirm");
  expect(steps.at(-1).id).toBe("simulate");
});

test("confirmed medicines and a current review move the next step to eligibility", () => {
  const medicationEntries = [{ id: "medicine-0", name: "Salbutamol", ingredient: "salbutamol", formulation: "inhaler", confirmed: true }, { id: "medicine-1", name: "Cetirizine", ingredient: "cetirizine", formulation: "tablet", confirmed: true }];
  const steps = nextSteps("prescription", { ...base, medicationEntries, medicationCheckedRevision: 1 }, patients[0]);
  expect(steps.find(step => !step.done).id).toBe("eligibility");
});

test("other answers and incomplete patients have no step bar", () => {
  expect(nextSteps("briefing", base, patients[0])).toBeUndefined();
  expect(nextSteps("medication", base, patients[1])).toBeUndefined();
});
