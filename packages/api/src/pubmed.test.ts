import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { conclusionOf, fetchArticles, keyTerms, searchEvidence, searchPubmed, searchTerms } from "./pubmed";

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

test("an article keeps its whole abstract for the model: each part under PubMed's label, the funding left out; its conclusion is read back from it", async () => {
  const [, blum, capeCod] = await fetchArticles(["31573350", "25608756", "36942789"], serve(xml));
  expect(blum!.abstract.split("\n").map(p => p.slice(0, p.indexOf(":")))).toEqual(["BACKGROUND", "METHODS", "FINDINGS", "INTERPRETATION"]);
  // The numbers a doctor asks about are in the findings; the Lancet's decimal point arrives as a character, not as "&#xb7;".
  expect(blum!.abstract).toContain("prednisone 50 mg daily for 7 days");
  expect(blum!.abstract).toContain("(76 [19%] vs 43 [11%]; OR 1·96, 95% CI 1·31-2·93, p=0·0010)");
  expect(blum!.abstract).not.toMatch(/&#|FUNDING|Swiss National/);
  expect(capeCod!.abstract).toStartWith("BACKGROUND: ");
  for (const a of [blum!, capeCod!]) expect(conclusionOf(a.abstract)).toBe(a.conclusion);
  // A cached row saved before abstracts were kept whole holds a conclusion alone, and an abstract in one piece has no labels: each is its own conclusion.
  expect(conclusionOf("Prednisone shortens time to stability. It raises blood sugar.")).toBe("Prednisone shortens time to stability. It raises blood sugar.");
});

test("a search returns PubMed IDs in its order; a failed call is an error, not an empty answer", async () => {
  expect(await searchPubmed("steroids pneumonia", serve(JSON.stringify({ esearchresult: { idlist: ["2", "1"] } })))).toEqual(["2", "1"]);
  expect(searchPubmed("steroids pneumonia", serve("busy", 429))).rejects.toThrow("PubMed answered 429");
});

test("a question keeps its clinical terms as phrases; framing words, numbers and the patient's identity are dropped", () => {
  expect(keyTerms("Is azithromycin safe with a long QT interval?")).toEqual(["azithromycin", "long qt interval"]);
  expect(keyTerms("Procalcitonin to stop antibiotics in lower respiratory tract infection?")).toEqual(["procalcitonin", "antibiotics", "lower respiratory tract infection"]);
  expect(keyTerms("How much IV fluid should I give in dengue with warning signs?")).toEqual(["iv fluid", "dengue", "warning signs"]);
  expect(keyTerms("How long should a 65-year-old take 500 mg amoxicillin?")).toEqual(["duration", "amoxicillin"]);
  // "Type 2" keeps its number (any other number ends a phrase), and "whose" frames like "who".
  expect(keyTerms("When should I start insulin in a type 2 diabetic whose HbA1c is still high on metformin?")).toEqual(["insulin", "type-2 diabetic", "hba1c", "high", "metformin"]);
  // An abstract's own labels ("AIM:", "RESULTS:") would match every article.
  expect(keyTerms("What oxygen saturation should I aim for in COPD with pneumonia?")).toEqual(["oxygen saturation", "copd", "pneumonia"]);
  expect(keyTerms("Should Amelia (SYN-1042) get oseltamivir for her influenza?", ["Amelia Tan", "SYN-1042"])).toEqual(["oseltamivir", "influenza"]);
  // Whatever is typed, only lowercase words reach PubMed, never its syntax.
  expect(keyTerms('steroids[pt] OR "sepsis" NOT (shock)')).toEqual(["steroids pt", "sepsis", "shock"]);
  expect(keyTerms("这个病人可以用激素吗?")).toEqual([]);
});

test("a follow-up with too little of its own keeps the topic of the thread's latest question that named one", () => {
  const thread = ["Dapagliflozin in heart failure with preserved ejection fraction?", "What are the main harms?"];
  expect(searchTerms("What are the main harms?", thread.slice(0, 1))).toEqual(["dapagliflozin", "heart failure", "preserved ejection fraction", "harms"]);
  expect(searchTerms("Does this change for severe cases?", thread)).toEqual(["dapagliflozin", "heart failure", "preserved ejection fraction", "severe"]);
  // No earlier question named a topic on its own: all of them together.
  expect(searchTerms("What about the harms?", ["Is prednisone useful here?"])).toEqual(["prednisone", "harms"]);
  // A question with a topic of its own never borrows one.
  expect(searchTerms("Dengue fluids?", thread)).toEqual(["dengue fluids"]);
});

/** PubMed's esearch as a fake: each call takes the next answer (an ID list, or an error for PubMed failing), and its term is kept. */
function esearch(...answers: (string[] | Error)[]) {
  const terms: string[] = [];
  const fetcher = (async (url: string) => {
    terms.push(new URL(url).searchParams.get("term")!);
    const answer = answers.shift() ?? [];
    if (answer instanceof Error) throw answer;
    return Response.json({ esearchresult: { idlist: answer } });
  }) as unknown as typeof fetch;
  return { terms, fetcher };
}

test("the best evidence is searched first and topped up from any study type; every term must match, never just one", async () => {
  const strict = esearch(["1", "2", "3"]);
  expect(await searchEvidence(["iv fluid", "dengue"], strict.fetcher)).toEqual(["1", "2", "3"]);
  // One search; abbreviations spelled out, an English abstract required.
  expect(strict.terms).toEqual(["(intravenous fluid) AND (dengue) AND (guideline[pt] OR systematic review[pt] OR meta-analysis[pt] OR randomized controlled trial[pt]) AND hasabstract AND english[la]"]);

  const topped = esearch(["1"], ["1", "4", "5"]);
  expect(await searchEvidence(["harms", "dengue"], topped.fetcher)).toEqual(["1", "4", "5"]);
  expect(topped.terms[1]).toBe("(adverse effects) AND (dengue) AND hasabstract AND english[la]");

  // Nothing has every term: no study, rather than one that matches a single word of the question.
  const none = esearch([], [], ["7"]);
  expect(await searchEvidence(["dos amoxicillin", "wad", "guna"], none.fetcher)).toEqual([]);
  expect(none.terms).toHaveLength(2);

  const nothing = esearch();
  expect(await searchEvidence([], nothing.fetcher)).toEqual([]);
  expect(nothing.terms).toEqual([]);
});

test("PubMed failing on the first search throws (the route falls back to its cache); a later one failing keeps what was found", async () => {
  await expect(searchEvidence(["dengue"], esearch(new Error("timeout")).fetcher)).rejects.toThrow("timeout");
  expect(await searchEvidence(["dengue"], esearch(["1"], new Error("timeout")).fetcher)).toEqual(["1"]);
});
