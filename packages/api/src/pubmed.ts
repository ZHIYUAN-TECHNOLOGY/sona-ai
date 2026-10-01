import { studyKind, type StudyKind } from "@sona-ai/domain/evidence";

/**
 * NCBI E-utilities, the public PubMed API (no key needed under 3 requests a second). The Worker has
 * no XML parser, and efetch's article XML is regular, so fields are read by pattern. Every call has
 * a timeout: on stage a slow PubMed must fall back to the cache, not hang the answer.
 */
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TIMEOUT_MS = 4000;

export type Article = { pmid: string; title: string; journal: string; year: number; kind: StudyKind; publicationTypes: string[]; conclusion: string };

async function get(url: string, fetcher: typeof fetch) {
  const res = await fetcher(`${url}&tool=sona-ai`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`PubMed answered ${res.status}`);
  return res.text();
}

/** PubMed IDs for a question, most relevant first. */
export async function searchPubmed(query: string, fetcher: typeof fetch = fetch, max = 5): Promise<string[]> {
  const body = await get(`${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${max}&term=${encodeURIComponent(query)}`, fetcher);
  return (JSON.parse(body) as { esearchresult?: { idlist?: string[] } }).esearchresult?.idlist ?? [];
}

/**
 * Words that frame a question rather than name its topic: question and helper words, pronouns, the patient
 * in front of the doctor, verdict words abstracts rarely use ("safe", "useful", "stop"), the labels of an
 * abstract's parts ("aim", "results": every abstract matches them), units and a few Malay and Manglish ones.
 * PubMed ANDs every word it is given, so any one of these can empty a search or match everything.
 */
const FILLER = new Set(`a about after again all also am an and any are as at be been being both but by can could did do does doing done
during each either for from get gets give given giving good got has have having he her here hers him his how i if in into is it its just
may me might more most much must my need needed needs no nor not now of on only or other our over own patient patients really right same
she should so some still such take takes taking than that the their them then there these they this those to too under up us very was way we were what
when where which while who whom why will with within without would yet you your
safe safely safety effective benefit beneficial help helps helpful useful use used using work works worth better best reasonable
appropriate indicated recommend recommended recommends consider considered option options start starting stop stopping continue
change changes main key evidence data study studies trial trials research literature say says show shows know known think mean means
reduce reduces improve improves increase increases decrease decreases shorten shortens prevent prevents cause causes
manage managing management versus vs compared compare case cases aim aims objective objectives background method methods result results conclusion conclusions
man woman lady gentleman boy girl mr mrs ms madam encik puan year years old aged day days week weeks mg mcg ml kg mmol
adakah apa apakah bagaimana berapa bila boleh dan atau untuk dengan dalam pada ke ini itu yang saya dia pesakit perlu patut tak tidak
ada bagi mana kenapa jika kalau ah lah leh lor meh kan`.split(/\s+/));

/**
 * Bedside abbreviations PubMed misreads ("iv" is a journal to it, "mi" the microbiology subheading), spelled
 * out; harm words as PubMed indexes them. ponytail: a hand list grown from failed searches; a Gemma rewrite
 * of the question into MeSH terms replaces it if questions keep missing.
 */
const SPELLED: Record<string, string> = {
  iv: "intravenous", im: "intramuscular", po: "oral", sc: "subcutaneous", gi: "gastrointestinal", bp: "blood pressure",
  mi: "myocardial infarction", pe: "pulmonary embolism", ed: "emergency department", cap: "community-acquired pneumonia",
  harm: "adverse effects", harms: "adverse effects", harmful: "adverse effects", danger: "adverse effects", dangers: "adverse effects", dangerous: "adverse effects",
};

/**
 * A question's key clinical terms as phrases, in order: the runs of words left once the filler and any
 * `drop` words (the patient's name and record number, which never leave the hospital) are taken out, so
 * PubMed's own term mapping still reads "heart failure" or "long qt" as one concept. Lowercased letters,
 * digits and hyphens only, so nothing a doctor types becomes PubMed syntax ([pt], OR, quotes).
 * ponytail: English, plus Malay filler; a Malay or Chinese clinical term is not translated, so such a question finds little.
 */
export function keyTerms(question: string, drop: string[] = []): string[] {
  const skip = new Set(drop.flatMap(d => d.toLowerCase().split(/\s+/)));
  // Numbers (ages, doses, IC digits) and single letters say nothing a search can use either, nor does a compound of them ("65-year-old").
  const noise = (w: string) => FILLER.has(w) || w.length < 2 || !/[a-z]/.test(w);
  const phrases: string[][] = [[]];
  for (const word of question.toLowerCase().replace(/\bhow long\b/g, "duration").match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
    if (skip.has(word) || word.split("-").every(noise)) phrases.push([]); // ends the phrase
    else phrases.at(-1)!.push(word);
  }
  return phrases.filter(p => p.length).map(p => p.join(" "));
}

const words = (terms: string[]) => terms.join(" ").split(" ").filter(Boolean).length;

/**
 * The terms to search for: the question's own, and for a follow-up with under two key words of its own
 * ("What about the harms?"), the topic of the thread's latest question that named one (or of every earlier
 * question, when none did on its own).
 */
export function searchTerms(question: string, earlier: string[] = [], drop: string[] = []): string[] {
  const own = keyTerms(question, drop);
  if (words(own) >= 2) return own;
  const before = earlier.map(q => keyTerms(q, drop));
  const topic = before.findLast(t => words(t) >= 2) ?? before.flat();
  return [...new Set([...topic, ...own])];
}

const STUDY_TYPES = "(guideline[pt] OR systematic review[pt] OR meta-analysis[pt] OR randomized controlled trial[pt])";
// Something to cite: an abstract, in the language the clinicians read.
const CITABLE = "hasabstract AND english[la]";
const phrase = (term: string) => `(${term.split(" ").map(w => SPELLED[w] ?? w).join(" ")})`;

/**
 * PubMed IDs for a clinical question's terms, best evidence first: all of them in a guideline, review or
 * trial, topped up from any study type. Never an article without an English abstract: it has nothing to cite.
 * Every term must match: loosening to any one of them cited unrelated papers (a Malay question's "guna" found
 * Ayurveda), and no study is better than a wrong one, since the library still answers. At most two searches,
 * one after the other (each under the 4 s timeout, and slower than NCBI's 3 a second); the first failing is
 * PubMed being down, so it throws, while the second failing keeps what was found.
 */
export async function searchEvidence(terms: string[], fetcher: typeof fetch = fetch, max = 3): Promise<string[]> {
  if (!terms.length) return [];
  const all = terms.map(phrase).join(" AND ");
  const found = await searchPubmed(`${all} AND ${STUDY_TYPES} AND ${CITABLE}`, fetcher, max);
  if (found.length < max) {
    for (const id of await searchPubmed(`${all} AND ${CITABLE}`, fetcher, max).catch(() => [])) if (!found.includes(id)) found.push(id);
  }
  return found.slice(0, max);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** Element text without inline markup (<i>, <sup>) or entities. */
const text = (s = "") => s.replace(/<[^>]+>/g, "").replace(/&(#\d+|\w+);/g, (m, e: string) => e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : ENTITIES[e] ?? m).replace(/\s+/g, " ").trim();
const first = (xml: string, re: RegExp) => text(xml.match(re)?.[1]);

/** The abstract's conclusion (labelled CONCLUSIONS or, in the Lancet, INTERPRETATION), else its last paragraph; funding notes dropped. */
function conclusionOf(article: string) {
  const parts = [...article.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)];
  const labelled = parts.find(p => /Label="(CONCLUSIONS?|INTERPRETATION)/i.test(p[1]!));
  return text((labelled ?? parts.at(-1))?.[2]).replace(/\s*\((Funded|Supported) by[^)]*\)\.?$/, "");
}

/** The articles for these PubMed IDs, in the order given (IDs PubMed does not return are left out). */
export async function fetchArticles(pmids: string[], fetcher: typeof fetch = fetch): Promise<Article[]> {
  if (!pmids.length) return [];
  const body = await get(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmids.join(",")}`, fetcher);
  const articles = body.split(/<PubmedArticle>/).slice(1).map((article): Article => {
    const publicationTypes = [...article.matchAll(/<PublicationType[^>]*>([^<]+)</g)].map(m => text(m[1]));
    const year = Number(first(article, /<PubDate>[\s\S]*?<Year>(\d{4})</) || first(article, /<MedlineDate>(\d{4})/));
    return {
      pmid: first(article, /<PMID[^>]*>(\d+)</), title: first(article, /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/).replace(/\.$/, ""),
      journal: first(article, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/), year, kind: studyKind(publicationTypes), publicationTypes, conclusion: conclusionOf(article),
    };
  });
  return pmids.flatMap(id => articles.filter(a => a.pmid === id));
}

/**
 * The PubMed ID a doctor means by what they pasted: a PMID ("31573350", "PMID: 31573350"), a PubMed
 * link, or a DOI on its own or in a doi.org link (looked up in PubMed). Null when it is none of these,
 * or PubMed has no article for the DOI.
 */
export async function resolveArticle(ref: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const s = ref.trim();
  const pmid = s.match(/^(?:PMID:?\s*)?(\d{1,9})$/i)?.[1] ?? s.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})/i)?.[1];
  if (pmid) return pmid;
  const doi = s.match(/\b(10\.\d{4,9}\/[^\s?#]+)/)?.[1];
  if (!doi) return null;
  const [found] = await searchPubmed(`${decodeURIComponent(doi)}[doi]`, fetcher, 1);
  return found ?? null;
}

export type Abstract = { pmid: string; title: string; journal: string; year: number; text: string };

/** One article's abstract for the library, each labelled part (Background, Methods…) as its own section. Null when PubMed has no abstract for it. */
export async function fetchAbstract(pmid: string, fetcher: typeof fetch = fetch): Promise<Abstract | null> {
  const article = (await get(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmid}`, fetcher)).split(/<PubmedArticle>/)[1];
  if (!article) return null;
  const parts = [...article.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
    .map(p => ({ label: text(p[1]!.match(/Label="([^"]+)"/)?.[1]) || "Abstract", body: text(p[2]) })).filter(p => p.body);
  if (!parts.length) return null;
  const year = Number(first(article, /<PubDate>[\s\S]*?<Year>(\d{4})</) || first(article, /<MedlineDate>(\d{4})/));
  return {
    pmid, title: first(article, /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/).replace(/\.$/, ""), year,
    journal: first(article, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/) || first(article, /<Title>([\s\S]*?)<\/Title>/),
    text: parts.map(p => `# ${p.label.charAt(0) + p.label.slice(1).toLowerCase()}\n${p.body}`).join("\n\n"),
  };
}
