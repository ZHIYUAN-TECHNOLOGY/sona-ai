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
