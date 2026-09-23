import { describe, expect, test } from "bun:test";
import { defaultMedications, effectivePatient } from "./clinical-state";
import { patients, newEncounter } from "./fixtures";
import { acceptCard, beginRequest, createCard, finishRequest, issueSimulation, reviseEncounter, routePrompt, revealSections, queueAmendment, reconcileAmendment } from "./state";

const patient = patients[0];
const eligible = () => ({ ...newEncounter(), medicationCheckedRevision: 1, medicationEntries: defaultMedications(patient).map(m => ({ ...m, confirmed: true })), prescriptionInputs: { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } });
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
  expect(created.prescription.regimen.dose).toBe("500");
  expect(created.prescription.audit.some(s => s.includes("NHS"))).toBe(true);
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
