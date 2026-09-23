import { expect, test } from "bun:test";
import { patients } from "@/features/encounter/fixtures";
import { clinicalComponentNames, composeClinicalSpec, validateClinicalSpec } from "./catalog";

const feature = patient => ({ patient, onSource() {}, onOpen() {}, onRequest() {} });

test("all capability fixtures validate with only snapshot references", () => {
  for (const patient of patients) for (const kind of Object.keys(clinicalComponentNames)) {
    const props = feature(patient);
    const spec = composeClinicalSpec(props, kind, 3);
    expect(validateClinicalSpec(spec, props, kind)).not.toBeNull();
    expect(JSON.stringify(spec)).not.toContain(patient.complaint);
  }
});

test("incomplete and fuller encounters select different composition order", () => {
  const full = composeClinicalSpec(feature(patients[0]), "briefing", 3);
  const incomplete = composeClinicalSpec(feature(patients[1]), "briefing", 3);
  expect(full.elements[full.elements[full.root].children[0]].type).toBe("ClinicalBriefing");
  expect(incomplete.elements[incomplete.elements[incomplete.root].children[0]].type).toBe("ContextNotice");
});

test("progressive snapshots preserve existing node IDs", () => {
  const props = feature(patients[0]);
  const initial = composeClinicalSpec(props, "briefing", 1);
  const complete = composeClinicalSpec(props, "briefing", 3);
  expect(initial.root).toBe(complete.root);
  for (const id of initial.elements[initial.root].children) expect(complete.elements[id]).toEqual(initial.elements[id]);
});

test("foreign source and event bindings are rejected before rendering", () => {
  const props = feature(patients[0]);
  const spec = composeClinicalSpec(props, "briefing", 3);
  const source = Object.values(spec.elements).find(node => node.type === "SourceAction");
  source.props.sourceId = "foreign-patient-source";
  expect(validateClinicalSpec(spec, props, "briefing")).toBeNull();
  source.props.sourceId = "history";
  source.on = { press: { action: "navigate", params: { path: "/untrusted" } } };
  expect(validateClinicalSpec(spec, props, "briefing")).toBeNull();
});

test("wrong patient result and missing required context are rejected", () => {
  const props = { ...feature(patients[1]), result: { id: "result-1", kind: "briefing", patientId: patients[0].id, encounterId: patients[0].encounterId } };
  expect(validateClinicalSpec(composeClinicalSpec(props, "briefing"), props, "briefing")).toBeNull();
  const incomplete = feature(patients[1]);
  const spec = composeClinicalSpec(incomplete, "briefing", 2);
  const noticeId = spec.elements[spec.root].children.shift();
  delete spec.elements[noticeId];
  expect(validateClinicalSpec(spec, incomplete, "briefing")).toBeNull();
});
