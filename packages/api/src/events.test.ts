import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import { changeFor, type Change } from "./events";
import { appRouter } from "./routers/index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;

test("a write names its topic and visit; a read announces nothing", () => {
  expect(changeFor(["claim", "send"], { encounterId: "visit-1042", requestId: "r" })).toEqual({ topic: "claim", encounterId: "visit-1042" });
  expect(changeFor(["results", "acknowledge"], { resultId: "lab-1" })).toEqual({ topic: "results" });
  expect(changeFor(["ward", "assignOwner"], { blockerId: "b", owner: "Nurse" })).toEqual({ topic: "ward" });
  for (const read of [["claim", "status"], ["tasks", "list"], ["encounter", "get"], ["ward", "beds"], ["evidence", "ask"], ["patients", "list"], ["findings", "list"],
    ["encounter", "timeline"], ["discharge", "plan"]])
    expect(changeFor(read, { encounterId: "visit-1042" })).toBeUndefined();
});

test("model answers, speech, previews and push tokens change nothing an app shows, so a visit's question never sets its patient's Sona Care refetching", () => {
  for (const read of [["evidence", "stream"], ["ask", "route"], ["ask", "free"], ["voice", "transcribe"], ["library", "previewArticle"], ["clinician", "me"], ["push", "register"], ["push", "unregister"]])
    expect(changeFor(read, { encounterId: "visit-1042" })).toBeUndefined();
  // Real writes on the same topics still announce.
  expect(changeFor(["library", "importArticle"], { pmid: "1" })).toEqual({ topic: "library" });
  expect(changeFor(["scan", "apply"], { encounterId: "visit-1042" })).toEqual({ topic: "scan", encounterId: "visit-1042" });
});

test("every successful write through the API is announced to the caller's hospital; refused writes and reads are not", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await addClinician(db, "dr-aisyah");
  const heard: [string, Change][] = [];
  const api = createRouterClient(appRouter, { context: { db, session, announce: async (hospitalId: string, change: Change) => { heard.push([hospitalId, change]); } } });
  await api.claim.update({ encounterId: "visit-1042", organismConfirmed: true });
  await api.results.receive({ patientId: "SYN-1086", test: "Potassium", value: "2.6", unit: "mmol/L" });
  await api.claim.status({ encounterId: "visit-1042" });
  await api.claim.send({ encounterId: "visit-1042", requestId: "c1", approvedBy: "dr-aisyah" }).catch(() => {}); // refused: a criterion is still open
  expect(heard).toEqual([["demo", { topic: "claim", encounterId: "visit-1042" }], ["demo", { topic: "results", patientId: "SYN-1086" }]]);
});

test("a failed announcement never fails the write", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  await addClinician(db, "dr-aisyah");
  const api = createRouterClient(appRouter, { context: { db, session, announce: async () => { throw new Error("channel down"); } } });
  expect(await api.tasks.create({ encounterId: "visit-1042", title: "Repeat chest X-ray", owner: "Nurse", requestId: "t1" })).toMatchObject({ title: "Repeat chest X-ray" });
});
