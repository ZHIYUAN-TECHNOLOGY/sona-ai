import { leakGate } from "@sona-ai/domain/training";
import { beforeEach, expect, test } from "bun:test";

import { BOXES, COLD_START_MIN, basetenModels, boxState } from "./baseten-models";
import { stubModels } from "./models";
import { PII_MODEL, replaceFound } from "./pii-model";

/**
 * A fake PII box that "finds" the given words in whatever text it is sent, the way OpenMed reports them (code point
 * offsets). A thrown error is a cold box; every other box answers 503. Records each text sent and every URL called.
 */
function piiBox(finds: [label: string, word: string][] | Error | "unreadable") {
  const sent: string[] = [], urls: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    urls.push(url);
    if (url.endsWith("/wake")) return new Response(null, { status: 202 });
    if (!url.includes(BOXES.pii)) return new Response("no", { status: 503 });
    if (finds instanceof Error) throw finds;
    if (url.endsWith("/health")) return new Response("ok");
    const { text } = JSON.parse(init.body as string) as { text: string };
    sent.push(text);
    if (finds === "unreadable") return Response.json({ detail: "busy" });
    const entities = finds.flatMap(([label, word]) => {
      const at = text.indexOf(word);
      const start = Array.from(text.slice(0, at)).length;
      return at < 0 ? [] : [{ label, text: word, start, end: start + Array.from(word).length, confidence: 0.9 }];
    });
    return Response.json({ text, entities });
  }) as typeof fetch;
  return { models: basetenModels({ apiKey: "k", fetcher }), sent, urls };
}
const amelia = { names: ["Amelia Tan"], ic: "840312-14-5528", phone: "+60 11-0000 0000", mrn: "SYN-1042" };
const said = (...kinds: string[]) => kinds.map(kind => ({ kind, placeholder: `[${kind.toUpperCase()}]` }));
beforeEach(() => boxState.clear());

test("the rules run first, so the box only sees their redacted text; its finds take the same placeholders and the gate passes", async () => {
  const { models, sent } = piiBox([["first_name", "Amelia"], ["first_name", "Faizal"], ["phone_number", "03-4021 5566"], ["street_address", "8, Lorong Ipoh 2"], ["occupation", "teacher"]]);
  const out = await models.deidentify({ known: amelia, text: "Amelia Tan (SYN-1042), IC 840312-14-5528, a teacher. Amelia says her husband Faizal is on 03-4021 5566. Home: 8, Lorong Ipoh 2." });
  expect(sent).toEqual(["[NAME] ([MRN]), IC [IC], a teacher. Amelia says her husband Faizal is on 03-4021 5566. Home: 8, Lorong Ipoh 2."]);
  // Addresses and the rest are found but kept: the review screen knows five placeholders.
  expect(out).toEqual({
    text: "[NAME] ([MRN]), IC [IC], a teacher. [NAME] says her husband [NAME] is on [PHONE]. Home: 8, Lorong Ipoh 2.",
    replacements: said("name", "mrn", "ic", "name", "name", "phone"), source: "model", model: PII_MODEL,
  });
  expect(leakGate(out.text, amelia).kinds).toEqual([]);
});

test("a name split in two becomes one placeholder, the rules' placeholders are never touched, and an emoji does not shift the spans", () => {
  const at = (label: string, start: number, end: number) => ({ label, start, end });
  expect(replaceFound("Doctor, this is Mei Ling.", [at("first_name", 16, 19), at("last_name", 20, 24)]))
    .toEqual({ text: "Doctor, this is [NAME].", replacements: said("name") });
  // A span over "[NAME] Tan" replaces "Tan" only; one with no offsets, or an unknown label, is ignored.
  expect(replaceFound("[NAME] Tan says hi", [at("last_name", 0, 10), { label: "first_name" }, at("constructor", 11, 15)]).text).toBe("[NAME] [NAME] says hi");
  // 😷 is one code point to OpenMed and two UTF-16 units to JS.
  expect(replaceFound("😷 Saya Siti, demam lagi", [at("FIRST_NAME", 7, 11)]).text).toBe("😷 Saya [NAME], demam lagi");
  // A number found in part (as OpenMed did live) takes its adjacent digits.
  expect(replaceFound("contact the ward on 03-4021 5566 if worse", [at("fax_number", 22, 32)]).text).toBe("contact the ward on [PHONE] if worse");
});

test("a cold box leaves the rules' answer, labelled fixture with the minutes until it is ready, and the gate still catches what they missed", async () => {
  const { models } = piiBox(new Error("starting"));
  const text = "Amelia Tan is better. Amelia slept well.";
  const out = await models.deidentify({ text, known: amelia });
  expect(out).toEqual({ ...await stubModels.deidentify({ text, known: amelia }), waking: COLD_START_MIN.pii });
  expect(leakGate(out.text, amelia).kinds).toEqual(["name"]);
});

test("an unreadable answer falls back to the rules, and a bare name (a scan) never calls the box", async () => {
  const text = "Amelia Tan is better. Amelia slept well.";
  expect(await piiBox("unreadable").models.deidentify({ text, known: amelia })).toEqual(await stubModels.deidentify({ text, known: amelia }));
  const bare = piiBox([["first_name", "Amelia"]]);
  expect(await bare.models.deidentify({ text: "Amelia Tan", known: amelia })).toEqual(await stubModels.deidentify({ text: "Amelia Tan", known: amelia }));
  expect(bare.urls).toEqual([]);
});
