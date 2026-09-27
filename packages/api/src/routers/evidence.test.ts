import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { provenance, pubmedArticles } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { STUDIES } from "@sona-ai/domain/evidence";

import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;
// Real efetch output for the rehearsed question's three studies.
const efetch = readFileSync(new URL("../fixtures/pubmed-cap-steroids.xml", import.meta.url), "utf8");

/** PubMed as a fake: efetch serves the saved XML, esearch the given IDs; `down` makes every call fail. */
function pubmed(idlist = ["25608756"]) {
  const state = { down: false, calls: [] as string[] };
  const fetcher = (async (url: string) => {
    state.calls.push(String(url));
    if (state.down) throw new Error("network unreachable");
    return new Response(String(url).includes("esearch") ? JSON.stringify({ esearchresult: { idlist } }) : efetch);
  }) as unknown as typeof fetch;
  return { state, fetcher };
}

async function signedIn(fetcher: typeof fetch, signed = true) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  return { db, api: createRouterClient(appRouter, { context: { db, session: signed ? session : null, fetch: fetcher } }) };
}

test("the rehearsed steroid question: the cached answer, its three PubMed studies with certainty by rule, and Amelia's CURB-65 from her chart", async () => {
  const { fetcher } = pubmed();
  const { api, db } = await signedIn(fetcher);
  const r = await api.evidence.ask({ encounterId: "visit-1042", question: "Steroids for this patient with community-acquired pneumonia?" });
  expect(r.source).toBe("cached");
  expect(r.answer[0]).toBe("No routine steroids for non-severe community-acquired pneumonia.");
  expect(r.studies.map(s => [s.pmid, s.kind, s.year, s.journal])).toEqual([["31573350", "Guideline", 2019, "Am J Respir Crit Care Med"], ["25608756", "Trial", 2015, "Lancet"], ["36942789", "Trial", 2023, "N Engl J Med"]]);
  // A guideline abstract rarely states its recommendations, so the rehearsed answer shows its summaries of each study.
  expect(r.studies.map(s => s.finding)).toEqual([STUDIES[0]!.finding, STUDIES[1]!.finding, STUDIES[2]!.finding]);
  expect(r.grade).toEqual({ certainty: "High certainty", direction: "Against routine use", scope: "non-severe pneumonia", rule: "Strongest design cited: guideline" });
  expect(r.pubmed).toBe("live");
  expect(r.curb65).toMatchObject({ score: 0, recorded: 5, risk: "Low risk · home treatment is usually suitable" });
  expect(r.curb65.factors.find(f => f.id === "u")!.sources).toEqual(["obs-1042-urea"]);
  // The answer is logged with the studies it cites.
  const [log] = await db.select().from(provenance);
  expect(log).toMatchObject({ encounterId: "visit-1042", kind: "evidence-answer", sourceIds: ["pmid:31573350", "pmid:25608756", "pmid:36942789"], model: "cached" });
});

test("when PubMed is down the studies come from the last fetch; never fetched means no studies and no certainty, said plainly", async () => {
  const { state, fetcher } = pubmed();
  const { api, db } = await signedIn(fetcher);
  const question = "Should Amelia get corticosteroids for her pneumonia?";
  state.down = true;
  const cold = await api.evidence.ask({ encounterId: "visit-1042", question });
  expect(cold).toMatchObject({ pubmed: "unavailable", studies: [], grade: { certainty: "No evidence found" } });
  state.down = false;
  await api.evidence.ask({ encounterId: "visit-1042", question });
  expect(await db.select().from(pubmedArticles)).toHaveLength(3);
  state.down = true;
  const warm = await api.evidence.ask({ encounterId: "visit-1042", question });
  expect(warm.pubmed).toBe("cached");
  expect(warm.studies.map(s => s.pmid)).toEqual(["31573350", "25608756", "36942789"]);
});

test("any other question searches PubMed and never borrows the rehearsed answer: the synthesis is labelled as a fixture", async () => {
  const { state, fetcher } = pubmed(["25608756"]);
  const { api } = await signedIn(fetcher);
  const r = await api.evidence.ask({ encounterId: "visit-1086", question: "Does prednisone shorten time to stability?" });
  expect(state.calls.some(u => u.includes("esearch") && u.includes("prednisone"))).toBe(true);
  expect(r.source).toBe("fixture");
  expect(r.answer.join(" ")).toContain("no model has weighed these studies");
  expect(r.studies.map(s => [s.pmid, s.finding.slice(0, 32)])).toEqual([["25608756", "Prednisone treatment for 7 days "]]);
  expect(r.grade).toEqual({ certainty: "Moderate certainty", rule: "Strongest design cited: randomised trial" });
  // Daniel has no chart readings: only age counts, and the band is withheld.
  expect(r.curb65).toMatchObject({ recorded: 1, risk: undefined });
});

test("evidence needs a login", async () => {
  const { api } = await signedIn(pubmed().fetcher, false);
  expect(api.evidence.ask({ encounterId: "visit-1042", question: "Steroids?" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
