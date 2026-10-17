import { describe, expect, test } from "bun:test";
import { defaultMedications, effectivePatient, getPrescriptionChecks } from "./clinical-state";
import { editNote, readNoteSections } from "../scribe/model";
import { patients, newEncounter } from "./fixtures";
import { acceptCard, beginRequest, createCard, finishRequest, issueSimulation, namedPatient, offeredAs, reviseEncounter, routeInThread, routePrompt, revealSections, queueAmendment, reconcileAmendment } from "./state";

const patient = patients[0];
const regimen = "Paracetamol 500 mg tablet · 1000 mg · Oral · Every 6 hours · 3 days";
// The clinician's part: the regimen entered, and each reported medicine confirmed (the record names no form for the cetirizine).
const eligible = () => ({ ...newEncounter(), proposedMedicine: regimen, medicationCheckedRevision: 1, medicationEntries: defaultMedications(patient).map(m => ({ ...m, formulation: m.formulation || "tablet", confirmed: true })), prescriptionInputs: { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } });
const request = { id: "req1", kind: "briefing", patientId: patient.id, encounterId: patient.encounterId, revision: 1, prompt: "Brief me", status: "streaming" };
describe("encounter isolation and streaming", () => {
  test("rejects cross-patient, cross-encounter, malformed and unexpected capability cards", () => {
    const state = beginRequest(newEncounter(), request), card = createCard(request);
    for (const payload of [{ ...card, patientId: patients[1].id }, { ...card, encounterId: "other" }, { ...card, kind: "arbitrary-code" }, { ...card, kind: "prescription" }]) expect(acceptCard(state, patient, payload)).toBe(state);
  });
  test("accepts once and rejects late events after cancellation or revision change", () => {
    const state = beginRequest(newEncounter(), request), card = createCard(request);
    const accepted = acceptCard(state, patient, card);
    expect(accepted.cards).toHaveLength(1);
    expect(acceptCard(accepted, patient, card)).toBe(accepted);
    expect(acceptCard(finishRequest(state, request.id, "cancelled"), patient, card).cards).toHaveLength(0);
    expect(acceptCard(reviseEncounter(state), patient, card).cards).toHaveLength(0);
  });
  test("new requests supersede active requests while preserving edits", () => {
    const state = beginRequest({ ...newEncounter(), note: "Manual clinical draft" }, request);
    const next = beginRequest(state, { ...request, id: "req2" });
    expect(next.requests[0].status).toBe("cancelled");
    expect(next.note).toBe("Manual clinical draft");
  });
  test("section events are monotonic and cannot change a cancelled response", () => {
    const start = acceptCard(beginRequest(newEncounter(), request), patient, { ...createCard(request), sections: 1 });
    const two = revealSections(start, request.id, 2);
    expect(two.cards[0].sections).toBe(2);
    expect(revealSections(two, request.id, 1).cards[0].sections).toBe(2);
    const cancelled = finishRequest(two, request.id, "cancelled");
    expect(revealSections(cancelled, request.id, 3)).toBe(cancelled);
  });
  test("does not accept a card matched to a differently bound request", () => {
    const wrong = beginRequest(newEncounter(), { ...request, patientId: patients[1].id });
    expect(acceptCard(wrong, patient, createCard(request))).toBe(wrong);
  });
});
describe("synthetic prescription actions", () => {
  test("blocks without checks; retries after checks; created actions deduplicate", () => {
    const blocked = issueSimulation(newEncounter(), patient, "op1");
    expect(blocked.prescription.status).toBe("blocked");
    const checked = { ...blocked, ...eligible() };
    const created = issueSimulation(checked, patient, "op1");
    expect(created.prescription.status).toBe("created");
    expect(issueSimulation(created, patient, "op1")).toBe(created);
    expect(issueSimulation(created, patient, "different-retry-id")).toBe(created);
  });
  test("missing patient eligibility and revised clinical facts block issuance", () => {
    expect(issueSimulation({ ...newEncounter(), medicationCheckedRevision: 1 }, patients[1], "op2").prescription.status).toBe("blocked");
    const revised = reviseEncounter({ ...newEncounter(), medicationCheckedRevision: 1, note: "Keep me" });
    expect(revised.note).toBe("Keep me");
    expect(issueSimulation(revised, patient, "op3").prescription.status).toBe("blocked");
  });
  test("new issuance leaves an earlier response receipt snapshot intact", () => {
    const first = issueSimulation(eligible(), patient, "op1");
    const withCard = { ...first, cards: [{ ...createCard(request), prescription: { ...first.prescription } }] };
    const revised = reviseEncounter(withCard);
    const next = issueSimulation({ ...revised, medicationCheckedRevision: revised.revision }, patient, "op2");
    expect(next.prescription.id).toBe("op2");
    expect(next.cards[0].prescription.id).toBe("op1");
  });
});
test("fixture routing prioritises actions and rejects unsupported requests", () => {
  expect(routePrompt("prescribe medication")).toBe("prescription");
  expect(routePrompt("review drug interactions")).toBe("medication");
  expect(routePrompt("What should I know before I see Amelia?")).toBe("briefing");
  expect(routePrompt("write arbitrary code")).toBeNull();
});

test("prescribing does not equate a completed review with known safety prerequisites", () => {
  for (const scenario of ["unknown-coverage", "unsupported", "failed-prerequisite"]) {
    expect(issueSimulation({ ...eligible(), prescriptionScenario: scenario }, patient, scenario).prescription.status).toBe("blocked");
  }
  const base = eligible();
  for (const key of ["liverDisease", "kidneyDisease", "alcoholRisk", "paracetamolAllergy"]) {
    for (const value of ["unknown", "yes"]) expect(issueSimulation({ ...base, prescriptionInputs: { ...base.prescriptionInputs, [key]: value } }, patient, key).prescription.status).toBe("blocked");
  }
  expect(issueSimulation({ ...base, prescriptionInputs: { ...base.prescriptionInputs, weightKg: "49" } }, patient, "weight").prescription.status).toBe("blocked");
  expect(issueSimulation({ ...base, medicationEntries: [{ ...base.medicationEntries[0], ingredient: "unknown", confirmed: false }] }, patient, "identity").prescription.status).toBe("blocked");
});
test("creation failure retries idempotently and amendments retain earlier evidence", () => {
  const failed = issueSimulation({ ...eligible(), prescriptionScenario: "creation-failure" }, patient, "same-op");
  expect(failed.prescription.status).toBe("failed");
  const created = issueSimulation({ ...failed, prescriptionScenario: "standard" }, patient, "same-op");
  expect(created.prescription.status).toBe("created");
  // The receipt holds the regimen that was entered, and its audit says what happened: sample mode, on this phone, nothing sent.
  expect(created.prescription.regimen).toMatchObject({ medication: "Paracetamol", dose: "1000", frequency: "Every 6 hours", duration: "3 days", indication: `Recorded complaint: ${patient.complaint}` });
  expect(created.prescription.audit).toContain(`Regimen entered by the clinician: ${regimen}`);
  expect(created.prescription.audit[0]).toBe("Sample mode · checked on this phone; nothing was saved to a hospital record");
  expect(created.prescription.audit.at(-1)).toBe("Checked by Sona's rules, not by a model; not sent to a pharmacy; nothing dispensed");
  expect(created.prescription.audit.join(" ")).not.toMatch(/fixture|simulat/i);
  // No regimen entered: blocked, with no regimen on the outcome.
  const empty = issueSimulation({ ...eligible(), proposedMedicine: undefined }, patient, "none").prescription;
  expect([empty.status, empty.regimen]).toEqual(["blocked", undefined]);
  const withCard = { ...created, cards: [{ ...createCard(request), prescription: created.prescription }] };
  const revised = reviseEncounter(withCard);
  const next = issueSimulation({ ...revised, medicationCheckedRevision: revised.revision }, patient, "amendment");
  expect(next.prescription.supersedes).toBe("same-op");
  expect(next.cards[0].prescription.revision).toBe(1);
});
test("sourced history changes update current context without rewriting earlier cards", () => {
  const old = acceptCard(beginRequest(newEncounter(), request), patient, createCard(request));
  const changed = reviseEncounter({ ...old, historyFacts: [{ id: "fact-one", category: "family", value: "Family history corrected", source: "Patient interview", date: "2026-09-23", revision: 2 }] });
  const currentPatient = effectivePatient(patient, changed);
  expect(currentPatient.family).toBe("Family history corrected");
  expect(currentPatient.sources.at(-1).id).toBe("fact-one");
  expect(changed.cards[0].patientSnapshot.family).toBe(patient.family);
});
test("image replacement leaves the earlier image response bound to its original", () => {
  const xrayReq = { ...request, kind: "xray" };
  const old = acceptCard(beginRequest({ ...newEncounter(), imagingAttachment: { uri: "file://old", name: "original" } }, xrayReq), patient, createCard(xrayReq));
  const replaced = reviseEncounter({ ...old, imagingAttachment: { uri: "file://new", name: "replacement" } });
  expect(replaced.cards[0].imagingSnapshot.imagingAttachment.uri).toBe("file://old");
});

test("amendment lifecycle survives presentation changes and stops on stale context", () => {
  const issued = issueSimulation(eligible(), patient, "initial");
  const receipt = { ...issued, cards: [{ ...createCard(request), prescription: issued.prescription }] };
  let current = queueAmendment(receipt, "Updated eligibility record", "amend-1");
  expect(current.amendmentOperation.phase).toBe("queued-review");
  const review = { ...request, id: "review-amend", kind: "medication", revision: current.revision, status: "complete" };
  current = { ...current, requests: [review], medicationCheckedRevision: current.revision, amendmentOperation: { ...current.amendmentOperation, phase: "reviewing", requestId: review.id } };
  current = reconcileAmendment(current, review.id);
  expect(current.amendmentOperation.phase).toBe("queued-issue");
  expect(reviseEncounter(current).amendmentOperation.phase).toBe("cancelled");
  const prescriptionRequest = { ...review, id: "issue-amend", kind: "prescription" };
  current = issueSimulation({ ...current, requests: [prescriptionRequest], amendmentOperation: { ...current.amendmentOperation, phase: "issuing", requestId: prescriptionRequest.id } }, patient, "new-receipt");
  expect(reconcileAmendment(current, prescriptionRequest.id).amendmentOperation.phase).toBe("complete");
  expect(current.cards[0].prescription.id).toBe("initial");
  const failed = { ...current, requests: [{ ...prescriptionRequest, status: "failed" }] };
  expect(reconcileAmendment(failed, prescriptionRequest.id).amendmentOperation.phase).toBe("failed");
});

test("live mode shows the server's receipt: its time, its id and, for an amendment, the receipt it supersedes", () => {
  const issued = issueSimulation(eligible(), patient, "rx-1");
  const revised = reviseEncounter({ ...issued, cards: [{ ...createCard(request), prescription: issued.prescription }] });
  const server = { id: "r-2", requestId: "amendment-op", revision: 3, createdAt: new Date("2026-10-01T02:05:00Z"), approvedBy: "dr-aisyah",
    payload: { medication: "Paracetamol", formulation: "500 mg tablet", dose: "500", unit: "mg", route: "Oral", frequency: "Every 8 hours", duration: "2 days", indication: "Recorded complaint: fever", sourceId: "paracetamol-reference", sourceVersion: "NHS", checks: [], transmitted: false, amendment: { reason: "Weight re-measured", supersedes: "rx-1" } } };
  // The server wrote the receipt after its own checks passed, so it is the outcome even where this phone's checks lag.
  const amended = issueSimulation(revised, patient, server.requestId, server).prescription;
  expect(amended).toMatchObject({ id: "amendment-op", status: "created", reasons: [], createdAt: "2026-10-01T02:05:00.000Z", supersedes: "rx-1" });
  // The regimen shown is the one the server recorded, not this phone's copy, and only the regimen (no receipt flags).
  expect(amended.regimen).toEqual({ medication: "Paracetamol", formulation: "500 mg tablet", dose: "500", unit: "mg", route: "Oral", frequency: "Every 8 hours", duration: "2 days", indication: "Recorded complaint: fever", sourceId: "paracetamol-reference", sourceVersion: "NHS" });
  expect(amended.audit[0]).toBe("Recorded in the visit record on the server · receipt r-2 · server revision 3 · prescribed by dr-aisyah");
});

test("a question typed after an evidence answer continues the evidence thread unless another capability claims it", () => {
  expect(routeInThread("What harms should I watch for?", "evidence")).toBe("evidence");
  expect(routeInThread("What harms should I watch for?", "briefing")).toBe(null);
  expect(routeInThread("Review drug interactions", "evidence")).toBe("medication");
  expect(routeInThread("Steroids for her pneumonia?")).toBe("evidence");
});

test("a question sent with its attachment settles: the request belongs to the revision the attachment made, not the one its sender last saw", () => {
  // The dock attaches the image (a revision) and asks in the same tick, so the request still carries the earlier revision.
  const attached = reviseEncounter({ ...newEncounter(), imagingAttachment: { uri: "file:///film.jpg", name: "film.jpg" } });
  const asked = beginRequest(attached, { ...request, id: "req-xray", kind: "xray", revision: attached.revision - 1 });
  const held = asked.requests.at(-1);
  expect(held.revision).toBe(attached.revision);
  // Its card is accepted (it was refused as late, and the answer hung on "Opening the radiograph…"), with the image it was asked about.
  const answered = acceptCard(asked, patient, createCard(held));
  expect(answered.cards.map(c => [c.kind, c.imagingSnapshot.imagingAttachment.uri])).toEqual([["xray", "file:///film.jpg"]]);
  expect(finishRequest(answered, "req-xray", "complete").requests.at(-1).status).toBe("complete");
});

test("a request that names one patient on the roster is theirs; no name, or a name two share, still asks which patient", () => {
  const roster = [{ id: "a", name: "Ganesan Muthu" }, { id: "b", name: "Siti Aminah" }, { id: "c", name: "Siti Nurhaliza" }, { id: "d", name: "Tan Mei Ling" }];
  expect(namedPatient("Brief me on Ganesan Muthu", roster)?.id).toBe("a");
  expect(namedPatient("brief me on ganesan muthu in bed 11", roster)?.id).toBe("a");
  expect(namedPatient("Review Ganesan’s medicines", roster)?.id).toBe("a");
  expect(namedPatient("Brief me on Siti Aminah", roster)?.id).toBe("b"); // the whole name settles a shared first name
  expect(namedPatient("Brief me on Siti", roster)).toBeUndefined();
  expect(namedPatient("Brief me on this patient", roster)).toBeUndefined();
  expect(namedPatient("Which tan is this?", roster)).toBeUndefined(); // a three-letter part alone names nobody
});

test("one of the app's own suggested questions, word for word, is the kind it was offered as", () => {
  const offered = [{ kind: "evidence", text: "Should Siti get steroids for this pneumonia?" }, { kind: "medication", text: "Check Siti’s medicines for interactions" }];
  // The keyword rule alone would not decide this; a router that reads "steroids" as a medicines review is not asked.
  expect(offeredAs("should siti get steroids for this pneumonia", offered)).toBe("evidence");
  expect(offeredAs("Check Siti's medicines for interactions.", offered)).toBe("medication");
  expect(offeredAs("Should Siti get antibiotics for this pneumonia?", offered)).toBeUndefined();
});

test("a note edit leaves the revision, the medication review and a pending amendment untouched", () => {
  const amendment = { id: "amendment-1", revision: 1, phase: "queued-review" };
  const before = { ...eligible(), amendmentOperation: amendment };
  const after = editNote(before, { ...readNoteSections(""), subjective: "Cough for five days" });
  expect(after.note).toContain("Cough for five days");
  expect(after.noteReviewed).toBe(false);
  expect(after.revision).toBe(before.revision);
  expect(after.medicationCheckedRevision).toBe(before.medicationCheckedRevision);
  expect(after.reviewInvalidated).toBeUndefined();
  expect(after.amendmentOperation).toBe(amendment);
  expect(getPrescriptionChecks(after, patient).find(check => check.id === "review").status).toBe("passed");
});

test("a second send of the same question is the same request: while its answer streams, or within 2 s of it", async () => {
  const { isRepeat } = await import("./state");
  const now = 1_790_000_000_000;
  const last = { id: `request-${now - 500}-abcde`, kind: "reasoning", prompt: "What possibilities should I consider?", status: "complete" };
  expect(isRepeat(last, "reasoning", "What possibilities should I consider? ", now)).toBe(true); // double tap
  expect(isRepeat(last, "reasoning", "What possibilities should I consider?", now + 5000)).toBe(false); // asked again later on purpose
  expect(isRepeat({ ...last, status: "streaming" }, "reasoning", "What possibilities should I consider?", now + 60_000)).toBe(true); // still coming
  expect(isRepeat(last, "evidence", "What possibilities should I consider?", now)).toBe(false); // another answer
  expect(isRepeat(last, "reasoning", "Is it pneumonia?", now)).toBe(false); // another question
  expect(isRepeat(undefined, "reasoning", "x", now)).toBe(false);
});
