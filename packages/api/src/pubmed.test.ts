import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { fetchArticles, searchPubmed } from "./pubmed";

// Real E-utilities efetch output for the three studies behind the rehearsed steroid question.
const xml = readFileSync(new URL("./fixtures/pubmed-cap-steroids.xml", import.meta.url), "utf8");
const serve = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

test("an efetch reply becomes articles: title, journal, year, design and the abstract's conclusion", async () => {
  const articles = await fetchArticles(["31573350", "25608756", "36942789"], serve(xml));
  expect(articles.map(a => [a.pmid, a.year, a.kind])).toEqual([["31573350", 2019, "Guideline"], ["25608756", 2015, "Trial"], ["36942789", 2023, "Trial"]]);
  expect(articles[1]!.journal).toBe("Lancet");
  expect(articles[1]!.title).toStartWith("Adjunct prednisone therapy for patients with community-acquired pneumonia");
  expect(articles[1]!.conclusion).toStartWith("Prednisone treatment for 7 days in patients with community-acquired pneumonia admitted to hospital shortens time to clinical stability");
  expect(articles[2]!.conclusion).toStartWith("Among patients with severe community-acquired pneumonia being treated in the ICU");
  expect(articles[2]!.conclusion).not.toContain("<");
});

test("a search returns PubMed IDs in its order; a failed call is an error, not an empty answer", async () => {
  expect(await searchPubmed("steroids pneumonia", serve(JSON.stringify({ esearchresult: { idlist: ["2", "1"] } })))).toEqual(["2", "1"]);
  expect(searchPubmed("steroids pneumonia", serve("busy", 429))).rejects.toThrow("PubMed answered 429");
});
