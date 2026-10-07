import { createRouterClient } from "@orpc/server";
import type { Context } from "@sona-ai/api/context";
import { appRouter } from "@sona-ai/api/routers/index";
import { hospitalMembers, hospitals, provenance } from "@sona-ai/db/schema/clinical";
import { DEMO_HOSPITAL, seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { ingest, reindex, search, stubEmbedder } from "./retrieval";

/** A doctor's own hospital library through the API, with the real retrieval functions behind it (as the Worker wires them). */
const user = (id: string) => ({
  user: { id, name: id, email: `${id}@demo.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: `s-${id}`, userId: id, token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
}) as never;

/** PubMed unreachable, so every answer rests on the library alone. */
const offline = (async () => { throw new Error("network unreachable"); }) as unknown as typeof fetch;

async function signedIn(fetcher: typeof fetch = offline, extra: Partial<Context> = {}) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  await addClinician(db, "dr-bala");
  await db.insert(hospitals).values({ id: "other", name: "Other Hospital (synthetic)" });
  await db.insert(hospitalMembers).values({ userId: "dr-other", hospitalId: "other" });
  const library = {
    ingest: (doc: Parameters<typeof ingest>[1], text: string) => ingest(db, doc, text, stubEmbedder),
    search: (input: Parameters<typeof search>[1]) => search(db, input, stubEmbedder),
    reindex: (hospitalId: string) => reindex(db, stubEmbedder, hospitalId),
  };
  const as = (id: string | null) => createRouterClient(appRouter, { context: { db, session: id ? user(id) : null, library, fetch: fetcher, ...extra } });
  return { db, as, api: as("dr-aisyah") };
}

const protocol = {
  requestId: "req-1", title: "Ward CAP protocol (synthetic)", source: "Hospital pharmacy", year: 2026,
  text: "# Steroids\nNo hydrocortisone in non-severe pneumonia on this ward.\n\n# Antibiotics\nAmoxicillin 1 g three times daily for five days.",
};

test("a doctor adds a source to their hospital's library and it is listed there, never for another hospital", async () => {
  const { api, as } = await signedIn();
  const added = await api.library.add({ ...protocol, scope: "hospital" });
  expect(added).toMatchObject({ title: protocol.title, source: "Hospital pharmacy", year: 2026 });
  expect((await api.library.list()).map(d => [d.id, d.title, d.uploadedBy])).toEqual([[added.id, protocol.title, "dr-aisyah"]]);
  expect(await as("dr-other").library.list()).toEqual([]);
});

test("a retried add replaces the same document, and only its own hospital can remove it", async () => {
  const { api, as } = await signedIn();
  const first = await api.library.add(protocol);
  await api.library.add({ ...protocol, title: "Ward CAP protocol v2 (synthetic)" });
  expect((await api.library.list()).map(d => [d.id, d.title])).toEqual([[first.id, "Ward CAP protocol v2 (synthetic)"]]);
  await expect(as("dr-other").library.remove({ documentId: first.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await api.library.remove({ documentId: first.id })).toEqual({ id: first.id });
  expect(await api.library.list()).toEqual([]);
});

test("the evidence answer lists the hospital's own passages as numbered library references, and stops once removed", async () => {
  const { api, db } = await signedIn();
  const doc = await api.library.add(protocol);
  const ask = () => api.evidence.ask({ encounterId: "visit-1086", question: "What amoxicillin dose does the ward use?" });
  const r = await ask();
  const library = r.references.filter(x => x.kind === "library");
  expect(library[0]).toMatchObject({ n: 1, id: `${doc.id}#antibiotics`, documentId: doc.id, design: "Library", title: protocol.title, section: "Antibiotics", from: "Hospital pharmacy", year: 2026 });
  expect(library[0]!.text).toContain("Amoxicillin 1 g");
  expect(library.length).toBeLessThanOrEqual(3);
  // PubMed is down here, so the passages are the only sources, numbered from 1; the mock's claim cites the first.
  expect(r).toMatchObject({ pubmed: "unavailable", enough: true, source: "fixture" });
  expect(r.references.every(x => x.kind === "library")).toBe(true);
  expect(r.claims[0]).toMatchObject({ text: expect.stringMatching(/^Your library \(2026\) reports:/), cites: [1] });
  const [log] = await db.select().from(provenance);
  expect(log!.sourceIds).toContain(`${doc.id}#antibiotics`);
  await api.library.remove({ documentId: doc.id });
  expect(await ask()).toMatchObject({ references: [], claims: [], enough: false });
});

test("management re-indexes the shared library and every source of its hospital, never another hospital's; a doctor may not", async () => {
  const { api, as, db } = await signedIn();
  await addClinician(db, "mgr-farah", DEMO_HOSPITAL, "management");
  await api.library.add(protocol); // the doctor's own source: 2 sections
  await api.library.add({ ...protocol, requestId: "req-2", scope: "hospital", text: "# Fluids\nThirty millilitres per kilogram." });
  await as("dr-other").library.add({ ...protocol, requestId: "req-3" }); // another hospital's: not this hospital's to re-index
  expect(await as("mgr-farah").library.reindex()).toEqual({ chunks: 3 });
  await expect(api.library.reindex()).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("the library needs a login", async () => {
  const { as } = await signedIn();
  await expect(as(null).library.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(as(null).library.add(protocol)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

/** A real PDF with one text line per entry on each page (Helvetica, no compression), as a clinic's export would be. */
function tinyPdf(pages: string[][]) {
  const streams = pages.map(lines => `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map(l => `(${l}) Tj T*`).join(" ")} ET`);
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${streams.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  streams.forEach((c, i) => objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${c.length} >>\nstream\n${c}\nendstream`));
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return btoa(out);
}

test("a source is the doctor's own by default: a colleague neither lists, cites nor removes it; a shared one they do", async () => {
  const { api, as } = await signedIn();
  const mine = await api.library.add(protocol);
  expect(mine).toMatchObject({ scope: "me", kind: "text", sections: 2 });
  const shared = await api.library.add({ ...protocol, requestId: "req-2", title: "Ward sepsis bundle (synthetic)", text: "# Fluids\nThirty millilitres per kilogram within three hours." , scope: "hospital" });
  const bala = as("dr-bala");
  expect((await api.library.list()).map(d => [d.title, d.scope, d.sections])).toEqual([[shared.title, "hospital", 1], [protocol.title, "me", 2]]);
  expect((await bala.library.list()).map(d => d.id)).toEqual([shared.id]);
  const question = { encounterId: "visit-1086", question: "What amoxicillin dose does the ward use?" };
  expect((await api.evidence.ask(question)).references.map(p => p.documentId)).toContain(mine.id);
  expect((await bala.evidence.ask(question)).references.map(p => p.documentId)).not.toContain(mine.id);
  await expect(bala.library.remove({ documentId: mine.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  // Nor can a colleague overwrite it by replaying its request ID.
  await expect(bala.library.add({ ...protocol, title: "Replaced" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await bala.library.remove({ documentId: shared.id })).toEqual({ id: shared.id });
});

test("text holding a patient's name, IC or record number is refused before it is stored; authors' emails are fine", async () => {
  const { api } = await signedIn();
  const refused = (text: string) => api.library.add({ ...protocol, text }).then(() => { throw new Error("stored"); }, (e: { code: string; data: { kinds: string[] } }) => [e.code, e.data.kinds.sort()]);
  expect(await refused("# Case\nAmelia Tan, 34, improved on amoxicillin.")).toEqual(["BAD_REQUEST", ["name"]]);
  expect(await refused("# Case\nIC 900101-14-5678, seen for SYN-1042.")).toEqual(["BAD_REQUEST", ["ic", "mrn"]]);
  expect(await api.library.list()).toEqual([]);
  expect(await api.library.add({ ...protocol, text: "# Correspondence\nDr Lim, lim@um.edu.my\n\n# Antibiotics\nAmoxicillin 1 g." })).toMatchObject({ sections: 2 });
});

test("a PDF is read into one section per page, split again at numbered headings, and cited like any source", async () => {
  const { api } = await signedIn();
  const pdf = tinyPdf([["Ward CAP protocol", "For adults on the medical wards."], ["2. Antibiotics", "Amoxicillin 1 g three times daily for five days."]]);
  const added = await api.library.addPdf({ requestId: "pdf-1", title: "Ward CAP protocol.pdf", dataBase64: pdf });
  expect(added).toMatchObject({ kind: "pdf", scope: "me", pages: 2, sections: 2, source: "PDF, 2 pages" });
  const { references } = await api.evidence.ask({ encounterId: "visit-1086", question: "What amoxicillin dose does the ward use?" });
  expect(references.find(r => r.kind === "library")).toMatchObject({ documentId: added.id, section: "2. Antibiotics" });
});

test("a PDF that is not one, has no text layer or names a patient is refused with a reason the app can show", async () => {
  const { api } = await signedIn();
  const reason = (dataBase64: string) => api.library.addPdf({ requestId: "pdf-x", title: "x.pdf", dataBase64 }).then(() => "stored", (e: { data: { reason: string } }) => e.data.reason);
  expect(await reason(btoa("GIF89a not a pdf"))).toBe("not-pdf");
  expect(await reason(tinyPdf([[]]))).toBe("no-text");
  expect(await reason(tinyPdf([["Discharge letter for Amelia Tan"]]))).toBe("patient-details");
  expect(await api.library.list()).toEqual([]);
});

/** PubMed as a fake: a DOI search, and one article whose abstract has labelled parts. */
const pubmed = (async (url: string) => {
  if (url.includes("esearch")) return new Response(JSON.stringify({ esearchresult: { idlist: url.includes(encodeURIComponent("10.1056/NEJMoa2215145")) ? ["36942789"] : [] } }));
  if (url.includes("efetch") && url.includes("id=36942789")) return new Response(`<PubmedArticleSet><PubmedArticle><PMID>36942789</PMID><Journal><Title>The New England journal of medicine</Title><ISOAbbreviation>N Engl J Med</ISOAbbreviation><JournalIssue><PubDate><Year>2023</Year></PubDate></JournalIssue></Journal><ArticleTitle>Hydrocortisone in Severe Community-Acquired Pneumonia.</ArticleTitle><Abstract><AbstractText Label="BACKGROUND">Whether hydrocortisone helps is unclear.</AbstractText><AbstractText Label="CONCLUSIONS">Hydrocortisone lowered mortality at day 28 in severe pneumonia.</AbstractText></Abstract></PubmedArticle></PubmedArticleSet>`);
  return new Response("<PubmedArticleSet></PubmedArticleSet>");
}) as unknown as typeof fetch;

test("a DOI, PMID or PubMed link previews the article, and importing adds its abstract part by part", async () => {
  const { api } = await signedIn(pubmed);
  const preview = { pmid: "36942789", title: "Hydrocortisone in Severe Community-Acquired Pneumonia", journal: "N Engl J Med", year: 2023, sections: 2, url: "https://pubmed.ncbi.nlm.nih.gov/36942789/" };
  for (const ref of ["https://doi.org/10.1056/NEJMoa2215145", "PMID: 36942789", "https://pubmed.ncbi.nlm.nih.gov/36942789/"]) expect(await api.library.previewArticle({ ref })).toEqual(preview);
  await expect(api.library.previewArticle({ ref: "steroids in pneumonia" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(api.library.previewArticle({ ref: "10.9999/unknown" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const added = await api.library.importArticle({ requestId: "pm-1", pmid: "36942789" });
  expect(added).toMatchObject({ kind: "pubmed", scope: "me", title: preview.title, source: "N Engl J Med", year: 2023, sections: 2 });
  const { references } = await api.evidence.ask({ encounterId: "visit-1086", question: "Does hydrocortisone lower mortality in severe pneumonia?" });
  expect(references.filter(r => r.kind === "library").map(p => p.section)).toContain("Conclusions");
});

test("importing while PubMed is down says so, and stores nothing", async () => {
  const { api } = await signedIn();
  await expect(api.library.previewArticle({ ref: "36942789" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  await expect(api.library.importArticle({ requestId: "pm-1", pmid: "36942789" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  expect(await api.library.list()).toEqual([]);
});

test("a patient's X-ray is found by its reading, in Malay too, and comes back as an image of the visit, never as a listed source", async () => {
  const objects = new Map<string, Uint8Array>();
  const uploads = { put: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); }, get: async (key: string) => { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null; } };
  const { api, db } = await signedIn(offline, { uploads, now: () => new Date("2026-10-03T10:00:00+08:00") });
  await api.xray.upload({ encounterId: "visit-1042", contentType: "image/png", dataBase64: Buffer.from([1]).toString("base64") });
  await api.xray.read({ encounterId: "visit-1042" });
  await api.findings.detect({ encounterId: "visit-1042" }); // Amelia's authored nodule and heart size
  const hits = await search(db, { query: "pesakit dengan nodul", hospitalId: DEMO_HOSPITAL }, stubEmbedder);
  expect(hits[0]).toMatchObject({ documentId: "xray:visit-1042", tags: { kind: "xray", source: "Imaging", year: 2026, title: "Chest X-ray: Amelia Tan, 3 Oct 2026" } });
  // The answer hands the film back as an image reference naming the visit, with the reading as its text.
  const r = await api.evidence.ask({ encounterId: "visit-1042", question: "Tunjukkan X-ray dada dia, ada nodul?" });
  expect(r.references.find(x => x.kind === "image")).toMatchObject({ design: "Imaging", encounterId: "visit-1042", documentId: "xray:visit-1042", title: "Chest X-ray: Amelia Tan, 3 Oct 2026", from: "Imaging", year: 2026 });
  // Once, though its reading and its search terms are separate chunks and both match.
  expect(r.references.filter(x => x.kind === "image")).toHaveLength(1);
  expect(r.references.map(x => x.text).join("\n")).toContain("9 mm nodule, right upper zone 9 mm, right upper zone (open, CT chest due 1 Jan 2027, demo reading)");
  // Not a doctor's source, not another hospital's, and never a patient's leaflet.
  expect(await api.library.list()).toEqual([]);
  expect(await search(db, { query: "nodul", hospitalId: "other" }, stubEmbedder)).toEqual([]);
  expect(await search(db, { query: "nodul", hospitalId: DEMO_HOSPITAL, patient: true }, stubEmbedder)).toEqual([]);
});
