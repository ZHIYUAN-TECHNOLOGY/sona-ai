import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { DEMO_HOSPITAL } from "@sona-ai/db/demo";
import { tasks } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { beforeEach, expect, test } from "bun:test";

import { groundedSpec } from "../ask-model";
import type { AskContext } from "../ask-spec";
import { boxState, type Baseten } from "../baseten-models";
import { appRouter } from "./index";

// Each test starts knowing nothing about the boxes (the adapter keeps what it learns for the isolate).
beforeEach(() => boxState.clear());

const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session);

async function nurse(baseten?: Baseten) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "nurse-lee", undefined, "nurse");
  return createRouterClient(appRouter, { context: { db, session: user("nurse-lee"), baseten } });
}

/** A fake Baseten: answers each call with `reply(url)` and records what was asked. */
function boxes(reply: (url: string) => unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(reply(url)), { status }); }) as unknown as typeof fetch;
  return { calls, baseten: { apiKey: "k", fetcher } };
}
const gemma = (content: unknown) => ({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });

const context: AskContext = {
  lines: ["Who needs me now? 2 patients need you now, most urgent first.", "What's overdue? 1 task overdue."],
  rows: [
    { id: "SYN-1086", title: "Daniel Rahman", detail: "History to complete", tone: "urgent", op: "open:SYN-1086" },
    { id: "SYN-1042", title: "Amelia Tan", detail: "Result to review", tone: "soon", op: "open:SYN-1042" },
    { id: "t1", title: "Repeat K+", detail: "Daniel Rahman · Nurse · was due 2026-09-28", tone: "soon", op: "open:SYN-1086" },
  ],
};
const spec = (lead: string, rows: unknown[] = [context.rows[0]]) => ({ root: "f", elements: {
  f: { type: "AskColumn", props: {}, children: ["f-0", "f-1"] },
  "f-0": { type: "AskLead", props: { text: lead }, children: [] },
  "f-1": { type: "AskRows", props: { rows }, children: [] },
} });
const free = { scope: "today", question: "Who is sickest?", context };

test("without a Baseten key both routes answer fixture, so the app keeps keyword routing and its own answers", async () => {
  const client = await nurse();
  expect(await client.ask.route({ request: "Brief me", patient: "Respiratory review" })).toEqual({ source: "fixture" });
  expect(await client.ask.free(free)).toEqual({ source: "fixture" });
});

test("Laya's pick comes back as card and medicine, asked on its box with the Baseten key; not covered is no card; a failure is fixture, starting for about a minute, and wakes the box", async () => {
  const up = boxes(() => ({ answers: { capability: { choice: "medication", answer_confidence: 0.97 }, medicine: { choice: "salbutamol-inhaler" } } }));
  const picked = await (await nurse(up.baseten)).ask.route({ request: "Salbutamol ada clash dengan ubat lain tak?", patient: "Respiratory review" });
  expect(picked).toEqual({ source: "model", model: "sona-laya", card: "medication", medicine: "salbutamol-inhaler", confidence: 0.97 });
  expect(up.calls[0]!.url).toBe("https://model-qe2dp10q.api.baseten.co/environments/production/sync/v1/systemone");
  expect((up.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Api-Key k");
  expect(JSON.parse(up.calls[0]!.init.body as string).state).toEqual({ request: "Salbutamol ada clash dengan ubat lain tak?", patient: "Respiratory review" });

  const none = boxes(() => ({ answers: { capability: { choice: "not-covered" }, medicine: { choice: "none" } } }));
  expect(await (await nurse(none.baseten)).ask.route({ request: "Discharge dia hari ni", patient: "Respiratory review" })).toMatchObject({ source: "model", card: null, medicine: null });

  const down = boxes(() => "starting", 503);
  expect(await (await nurse(down.baseten)).ask.route({ request: "Brief me", patient: "Respiratory review" })).toEqual({ source: "fixture", waking: 1 });
  expect(down.calls.map(c => c.url.split("/").at(-1))).toEqual(["systemone", "wake"]);
});

test("a free answer that stays on the page's data comes back as a spec with Gemma's name", async () => {
  const answer = spec("Daniel Rahman needs you first; 2 patients need you now.");
  const { calls, baseten } = boxes(() => gemma("```json\n" + JSON.stringify(answer) + "\n```"));
  expect(await (await nurse(baseten)).ask.free(free)).toEqual({ source: "model", model: "gemma-4-26b-a4b", spec: answer });
  // A health check first (nothing was known about the box), then the question.
  expect(calls.map(c => c.url)).toEqual(["https://model-q9p7zn63.api.baseten.co/environments/production/sync/health", "https://model-q9p7zn63.api.baseten.co/environments/production/sync/v1/chat/completions"]);
  // Gemma is given the page's rows, ids and ops included, to copy from.
  expect(JSON.parse(calls[1]!.init.body as string).messages[1].content).toContain(JSON.stringify(context.rows[0]));
});

test("while Gemma is starting, a free question is not held: fixture at once, with the minutes until it should answer", async () => {
  const cold = boxes(() => "starting", 503);
  expect(await (await nurse(cold.baseten)).ask.free(free)).toEqual({ source: "fixture", waking: 12 });
  expect(cold.calls.map(c => c.url.split("/").at(-1))).toEqual(["health", "wake"]);
});

test("an invalid or ungrounded free answer is fixture, marked unanswered (the model ran): off-catalogue, invented rows, names or numbers, review cards and task-done", async () => {
  const rejected = [
    { unanswered: true },
    "not json at all",
    spec("Siti Aminah needs you first."), // a name not on the page
    spec("Daniel's potassium is 2.1."), // a number not on the page
    spec("Daniel needs you.", [{ ...context.rows[0], id: "SYN-9999" }]), // a row the page doesn't have
    spec("Daniel needs you.", [{ ...context.rows[0], detail: "Chest pain" }]), // a row's words changed
    spec("Daniel needs you.", [{ ...context.rows[0], op: "open:SYN-1042" }]), // another row's op
    spec("Daniel needs you.", [{ ...context.rows[0], op: "task-done:SYN-1086:t1" }]),
    { root: "f", elements: { f: { type: "AskColumn", props: {}, children: ["f-0"] }, "f-0": { type: "AskReview", props: { title: "Mark done", items: [], what: "x", confirm: "Done", done: "Done", op: "task-done:SYN-1086:t1" }, children: [] } } },
    { root: "f", elements: { f: { type: "AskColumn", props: {}, children: ["f-0"] }, "f-0": { type: "Script", props: {}, children: [] } } },
  ];
  // One database for all of them: the fake box answers with whichever reply is current.
  let reply: unknown;
  const client = await nurse(boxes(() => gemma(reply)).baseten);
  // Never the model's own words. Where it did answer from the page (a spec), the page's own lines stand in, as the rules' answer.
  const pageSays = { root: "f", elements: { f: { type: "AskColumn", props: {}, children: ["f-0"] }, "f-0": { type: "AskLead", props: { text: "2 patients need you now, most urgent first. 1 task overdue." }, children: [] } } };
  for (reply of rejected) expect(await client.ask.free(free)).toEqual({ source: "fixture", unanswered: true, ...typeof reply === "object" && "elements" in reply! && { spec: pageSays } });
  // A page that says nothing has nothing to stand in.
  expect(await client.ask.free({ ...free, context: { lines: [], rows: context.rows } })).toEqual({ source: "fixture", unanswered: true });
});

test("a list longer than an answer may show is cut to its first 12 rows, whoever wrote it, instead of failing the whole answer", async () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: `SYN-${i}`, title: `Patient ${i}`, detail: "Result to review", tone: "soon" as const, op: `open:SYN-${i}` }));
  const many = { lines: ["Who needs me now? 14 patients need you now, most urgent first."], rows };
  const read = groundedSpec(spec("14 patients need you now.", rows), many);
  expect((read!.elements["f-1"]!.props.rows as unknown[])).toEqual(rows.slice(0, 12));
});

test("a clinical question Gemma marks as one the literature answers comes back as evidence, for the app to answer with citations", async () => {
  const asked = { ...free, question: "Is tranexamic acid helpful in upper GI bleeding?" };
  const marked = await (await nurse(boxes(() => gemma({ general: "It has not been shown to reduce deaths.", evidence: true })).baseten)).ask.free(asked);
  expect(marked).toMatchObject({ source: "model", general: true, evidence: true });
  // Unmarked (or marked by anything but true), a general answer stays one.
  const plain = await (await nurse(boxes(() => gemma({ general: "Ward rounds usually start at 8.", evidence: "yes" })).baseten)).ask.free(asked);
  expect(plain).not.toHaveProperty("evidence");
});

test("a question the page doesn't answer gets a general answer from Gemma, marked general (no content limit)", async () => {
  const client = await nurse(boxes(() => gemma({ general: "Paracetamol's usual adult maximum is 4 g a day." })).baseten);
  const r = await client.ask.free({ ...free, question: "What is the maximum daily dose of paracetamol?" });
  expect(r).toMatchObject({ source: "model", general: true, spec: { root: "f", elements: { "f-0": { type: "AskLead", props: { text: "Paracetamol's usual adult maximum is 4 g a day." } } } } });
});

test("grounding: counts up to the page's rows, names from the data and a row without its op pass; the answer is still the app's schema", () => {
  expect(groundedSpec(spec("Two patients need you: Daniel Rahman first, then Amelia Tan."), context)).not.toBeNull();
  expect(groundedSpec(spec("Amelia's result to review.", [{ ...context.rows[1], op: undefined }]), context)).not.toBeNull();
  expect(groundedSpec(spec("12 patients need you."), context)).toBeNull();
  // An invented finding fails whatever its case: every word long enough to carry a claim must come from the page or the question.
  expect(groundedSpec(spec("Daniel needs you: possible sepsis."), context)).toBeNull();
  expect(groundedSpec(spec("Daniel needs you: possible Sepsis."), context)).toBeNull();
  expect(groundedSpec(spec(""), context)).toBeNull(); // AskLead needs text
});

// Sona Pro web sends no page data (scope "web"): the server reads the hospital's Today, Ward and Tasks and always answers.
async function webDoctor(baseten?: Baseten) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T15:40:00+08:00"));
  await addClinician(db, "dr-web");
  await db.insert(tasks).values([
    { id: "t-ours", hospitalId: DEMO_HOSPITAL, encounterId: "visit-1086", kind: "followup", title: "Repeat potassium", owner: "Nurse", due: "2026-09-25" },
    { id: "t-theirs", hospitalId: "other-hospital", kind: "followup", title: "Another hospital's task", owner: "Nurse", due: "2026-09-25" },
  ]);
  return createRouterClient(appRouter, { context: { db, session: user("dr-web"), baseten } });
}
const web = (question: string) => ({ scope: "web", question });
type Res = { spec?: { elements: Record<string, { type: string; props: Record<string, unknown> }> } };
const rowsOf = (res: Res) => Object.values(res.spec?.elements ?? {}).flatMap(e => e.type === "AskRows" ? e.props.rows as { id: string; title: string; detail: string; tone: string }[] : []);
const leadOf = (res: Res) => Object.values(res.spec?.elements ?? {}).find(e => e.type === "AskLead")?.props.text as string;

test("web: the bar's three questions are answered by rule from the hospital's own data, with no model, in English or Malay", async () => {
  const client = await webDoctor();
  const needs = await client.ask.free(web("What needs me first?"));
  expect(needs.source).toBe("rules");
  const needRows = rowsOf(needs);
  // Daniel's low potassium is waiting on a doctor: he leads, urgent; the overdue task is there too.
  expect(needRows[0]).toMatchObject({ id: "SYN-1086", title: "Daniel Rahman", tone: "urgent" });
  expect(needRows.some(r => r.id === "t-ours" && r.tone === "soon")).toBe(true);
  expect(leadOf(needs)).toContain("most urgent first: Daniel Rahman");

  const blocked = await client.ask.free(web("Which beds are blocked?"));
  const bedRows = rowsOf(blocked);
  expect(bedRows.length).toBeGreaterThan(0);
  expect(bedRows.every(r => r.title.startsWith("Bed") && r.detail.includes("no owner"))).toBe(true);
  expect(leadOf(blocked)).toMatch(/blocked, about \d+ bed-hours waiting/);

  const due = await client.ask.free(web("What is due today?"));
  expect(rowsOf(due).find(r => r.id === "t-ours")).toMatchObject({ title: "Repeat potassium", detail: "Daniel Rahman · Nurse · was due 2026-09-25" });

  expect(rowsOf(await client.ask.free(web("Apa perlu saya buat dulu?")))).toEqual(needRows);
  expect(rowsOf(await client.ask.free(web("Katil mana tersekat?")))).toEqual(bedRows);
  expect(leadOf(await client.ask.free(web("Apa yang perlu hari ini?")))).toBe(leadOf(due));
});

test("web: another hospital's tasks never appear, in any answer or in the page data the model is given", async () => {
  const client = await webDoctor();
  for (const q of ["What needs me first?", "What is due today?", "Which beds are blocked?"]) expect(JSON.stringify(await client.ask.free(web(q)))).not.toContain("t-theirs");
  const up = boxes(() => gemma({ general: "Nothing unusual.", evidence: false }));
  await (await webDoctor(up.baseten)).ask.free(web("Anything odd tonight?"));
  const sent = String(up.calls.find(c => c.url.endsWith("completions"))?.init.body);
  expect(sent).toContain("Repeat potassium");
  expect(sent).not.toContain("Another hospital");
});

test("web: with no model, another question answers from what the pages show that matches it, else one plain line that the model is off", async () => {
  const client = await webDoctor();
  const matched = await client.ask.free(web("Is Daniel's potassium back?"));
  expect(matched.source).toBe("rules");
  expect(rowsOf(matched).some(r => r.title === "Daniel Rahman")).toBe(true);
  const off = await client.ask.free(web("Explain the parking policy"));
  expect(off).toMatchObject({ source: "fixture" });
  expect(leadOf(off)).toBe("Sona's assistant model is off right now; ask again when it is on, or open Today, Ward or Tasks.");
  expect(rowsOf(off)).toEqual([]);
});
