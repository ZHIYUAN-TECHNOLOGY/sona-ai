import { expect, test } from "bun:test";

import { stubModels } from "./models";

const patient = {
  id: "SYN-1042", encounterId: "visit-1042", name: "Amelia Tan", initials: "AT", age: 42, sex: "Female", subtitle: "", time: "09:30",
  complaint: "Cough for five days, with fever since yesterday.", history: ["Asthma"], family: "", social: "",
  allergies: "Penicillin — reported rash", medicines: [], vitals: [], sources: [], incomplete: false,
};

test("until the models are switched on, every capability answers with authored content labelled as a fixture", async () => {
  const answers = await Promise.all([
    stubModels.briefing({ patient }),
    stubModels.reasoning({ patient, question: "What else could this be?" }),
    stubModels.xrayRead({ image: new Uint8Array([1, 2, 3]), contentType: "image/png" }),
    stubModels.draftDischarge({ patient, language: "en" }),
    stubModels.suggestCodes({ sentences: [{ id: "s1", text: "Community-acquired pneumonia." }] }),
    stubModels.synthesiseEvidence({ question: "Oral switch after 48 h?", studies: [] }),
    stubModels.huddleBrief({ beds: [], owners: {} }),
    stubModels.classifyReply({ text: "Demam datang balik", language: "ms" }),
    stubModels.triageMessage({ text: "Bila temu janji saya?" }),
    stubModels.draftReply({ text: "Bila temu janji saya?", label: "admin", patientFirstName: "Amelia", language: "ms" }),
  ]);
  for (const answer of answers) expect(answer.source).toBe("fixture");
  expect((await stubModels.xrayRead({ image: new Uint8Array([1]), contentType: "image/png" })).validated).toBe(false);
  expect((await stubModels.classifyReply({ text: "Demam datang balik", language: "ms" })).label).toBe("worse");
  expect((await stubModels.classifyReply({ text: "Saya sihat, terima kasih", language: "ms" })).label).toBe("fine");
});
