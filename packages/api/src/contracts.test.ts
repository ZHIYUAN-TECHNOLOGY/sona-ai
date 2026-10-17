import { expect, test } from "bun:test";
import { approvedCommandSchema, assignOwnerSchema, drugLookupSchema, observationSchema, icdCodeSchema, retrievalHitSchema, searchInputSchema } from "./contracts";

test("an ICD-10 code is a letter, two digits and an optional subcode", () => {
  expect(icdCodeSchema.safeParse({ code: "J18.9", label: "Pneumonia, unspecified organism" }).success).toBe(true);
  expect(icdCodeSchema.safeParse({ code: "I64", label: "Stroke, not specified" }).success).toBe(true);
  expect(icdCodeSchema.safeParse({ code: "j18.9", label: "lower case" }).success).toBe(false);
  expect(icdCodeSchema.safeParse({ code: "J18.", label: "dangling dot" }).success).toBe(false);
});

test("a retrieval search is always scoped to a hospital and has a bounded result count", () => {
  expect(searchInputSchema.parse({ query: "steroids in pneumonia", hospitalId: "demo" })).toEqual({ query: "steroids in pneumonia", hospitalId: "demo", k: 5 });
  expect(searchInputSchema.safeParse({ query: "steroids in pneumonia" }).success).toBe(false);
  expect(searchInputSchema.safeParse({ query: "", hospitalId: "demo" }).success).toBe(false);
  expect(searchInputSchema.safeParse({ query: "x", hospitalId: "demo", k: 21 }).success).toBe(false);
});

test("discharging and sending a claim need an idempotency key and a named approver", () => {
  const ok = { encounterId: "visit-1042", requestId: "req-1", approvedBy: "dr-aisyah" };
  expect(approvedCommandSchema.safeParse(ok).success).toBe(true);
  expect(approvedCommandSchema.safeParse({ ...ok, requestId: undefined }).success).toBe(false);
  expect(approvedCommandSchema.safeParse({ ...ok, approvedBy: "" }).success).toBe(false);
});

test("a drug lookup is either covered with a cited dose or explicitly not covered", () => {
  expect(drugLookupSchema.safeParse({ status: "covered", drug: "paracetamol", dose: "1 g every 6 h", sourceId: "openfda-paracetamol" }).success).toBe(true);
  expect(drugLookupSchema.safeParse({ status: "not-covered", drug: "unknown tablet" }).success).toBe(true);
  expect(drugLookupSchema.safeParse({ status: "covered", drug: "paracetamol", dose: "1 g every 6 h" }).success).toBe(false);
});

test("a retrieval hit always names its source and section", () => {
  const hit = { chunkId: "c1", documentId: "d1", sourceId: "moh-cpg-cap-2016#4.2", text: "…", score: 0.82, tags: { source: "MOH CPG", year: 2016, section: "4.2 Corticosteroids" } };
  expect(retrievalHitSchema.safeParse(hit).success).toBe(true);
  expect(retrievalHitSchema.safeParse({ ...hit, sourceId: undefined }).success).toBe(false);
  expect(retrievalHitSchema.safeParse({ ...hit, tags: { source: "MOH CPG", year: 2016 } }).success).toBe(false);
});

test("a blocker is owned by one of the four discharge teams", () => {
  expect(assignOwnerSchema.safeParse({ blockerId: "b6-gl", owner: "Billing" }).success).toBe(true);
  expect(assignOwnerSchema.safeParse({ blockerId: "b6-gl", owner: "Cleaner" }).success).toBe(false);
});

test("a chart observation carries its unit and source", () => {
  expect(observationSchema.safeParse({ patientId: "SYN-1042", kind: "urea", value: 5.1, unit: "mmol/L", sourceId: "chart-urea-1" }).success).toBe(true);
  expect(observationSchema.safeParse({ patientId: "SYN-1042", kind: "urea", value: 5.1, unit: "mmol/L" }).success).toBe(false);
  expect(observationSchema.safeParse({ patientId: "SYN-1042", kind: "mood", value: 1, unit: "", sourceId: "x" }).success).toBe(false);
});
