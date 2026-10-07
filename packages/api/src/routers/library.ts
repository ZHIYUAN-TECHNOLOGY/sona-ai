import { ORPCError } from "@orpc/server";
import { documents, patients } from "@sona-ai/db/schema/clinical";
import { deidentifyByRules, type IdentityKind } from "@sona-ai/domain/training";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { protectedProcedure } from "../index";
import { stubModels } from "../models";
import { pdfPageImages, pdfText } from "../pdf";
import { fetchAbstract, resolveArticle } from "../pubmed";

/**
 * A doctor's library: guidelines and references they add by pasting text, uploading a PDF or
 * importing a PubMed abstract, or by checking MedGemma's reading of a scan. Each is cut into sections and searched alongside the shared library.
 * Scope "me" (the default) keeps a source to the doctor who added it; "hospital" shares it with
 * their hospital. No other hospital ever sees either.
 */
type Authed = Context & { session: NonNullable<Context["session"]>; hospitalId: string };

const libraryOf = (context: Context) => {
  if (!context.library) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "The library is not available on this server" });
  return context.library;
};

const scope = z.enum(["me", "hospital"]).default("me");
const requestId = z.string().min(1).max(100);

const DETAIL: Record<IdentityKind, string> = { name: "a patient's name", ic: "an IC number", phone: "a phone number", mrn: "a patient record number", email: "an email address" };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Patient details in text bound for the library: any Malaysian IC or mobile number, and the full name
 * or record number of any of the hospital's patients. Emails and other names are allowed, since
 * reference papers carry their authors'.
 * ponytail: rules stand in for OpenMed PII, which also finds names the hospital does not hold; swap in via the model seam once box ② is hosted.
 */
async function patientDetailsIn(context: Authed, text: string): Promise<IdentityKind[]> {
  const rows = await context.db.select({ id: patients.id, name: patients.name }).from(patients).where(eq(patients.hospitalId, context.hospitalId));
  const kinds = new Set(deidentifyByRules(text, { names: rows.map(r => r.name) }).replacements.map(r => r.kind).filter(k => k !== "email"));
  if (rows.some(r => new RegExp(`\\b${escape(r.id)}\\b`, "i").test(text))) kinds.add("mrn");
  return [...kinds];
}

/**
 * Checks for patient details, then indexes. Replay-safe: the document ID comes from the request, so a
 * retry replaces rather than duplicates, but never someone else's document.
 */
async function save(context: Authed, input: { requestId: string; scope: "me" | "hospital" }, fields: { title: string; source: string; year: number; license?: string | null; kind: "text" | "pdf" | "pubmed" | "scan" }, text: string) {
  const kinds = await patientDetailsIn(context, text);
  if (kinds.length) throw new ORPCError("BAD_REQUEST", {
    message: `This source contains ${kinds.map(k => DETAIL[k]).join(" and ")}. Remove patient details, then add it again.`,
    data: { reason: "patient-details", kinds },
  });
  const me = context.session.user.id;
  const doc = { id: `${context.hospitalId}:${input.requestId}`, hospitalId: context.hospitalId, ownerId: input.scope === "me" ? me : null, uploadedBy: me, license: null, ...fields };
  const [existing] = await context.db.select({ uploadedBy: documents.uploadedBy }).from(documents).where(eq(documents.id, doc.id));
  if (existing && existing.uploadedBy !== me) throw new ORPCError("CONFLICT", { message: "That source belongs to someone else" });
  const sections = await libraryOf(context).ingest(doc, text);
  return { id: doc.id, title: doc.title, source: doc.source, year: doc.year, kind: doc.kind, scope: input.scope, sections };
}

/** An article and its abstract from PubMed; its failures read as what the doctor can do about them. */
async function article(context: Context, pmid: string) {
  const found = await fetchAbstract(pmid, context.fetch ?? fetch).catch(() => { throw new ORPCError("SERVICE_UNAVAILABLE", { message: "PubMed is not answering. Try again in a moment." }); });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "PubMed has no abstract for this article, so there is nothing to cite" });
  return found;
}

/**
 * Page images read into text by MedGemma (box ③), two at a time, with the words it doubted. Nothing is saved here: a
 * reading goes back to staff to check against the page (it once made up a Chinese page's safety instruction), and
 * only what they send to addScan is kept. Refuses while the reader is starting, or when it found no words on any page.
 */
async function readPages(context: Context, images: { image: Uint8Array; contentType: string }[]) {
  const models = context.models ?? stubModels;
  const read: Awaited<ReturnType<typeof models.readDocumentPage>>[] = [];
  for (let i = 0; i < images.length; i += 2) read.push(...await Promise.all(images.slice(i, i + 2).map(page => models.readDocumentPage(page))));
  const byModel = read.find(r => r.source === "model");
  if (byModel?.source !== "model") {
    const waking = read.map(r => r.source === "fixture" ? r.waking : undefined).find(Boolean);
    throw new ORPCError("PRECONDITION_FAILED", { message: `The scan reader is starting. Try again in ${waking ? `about ${waking} min` : "a few minutes"}.`, data: { reason: "reader-off" } });
  }
  if (!read.some(r => r.text.trim())) throw new ORPCError("BAD_REQUEST", { message: "No text could be read from this scan.", data: { reason: "no-text" } });
  return { model: byModel.model, pages: read.map(r => ({ text: r.text.trim(), unsure: r.unsure })) };
}

const title = z.string().trim().min(1).max(200);
const base64 = (min: number) => z.string().min(min).max(14_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, "Not base64");
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
/** In chunks, since spreading a whole page picture into one call overflows the stack. */
const base64Of = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const pagesOf = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

/** A PDF's bytes and text layer ("" on a scan); a file that is not a PDF, or is locked, is refused. */
async function pdfOf(dataBase64: string) {
  const bytes = bytesOf(dataBase64);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new ORPCError("BAD_REQUEST", { message: "This file is not a PDF", data: { reason: "not-pdf" } });
  const { pages, text } = await pdfText(bytes).catch(() => { throw new ORPCError("BAD_REQUEST", { message: "This PDF could not be read. It may be locked with a password.", data: { reason: "unreadable" } }); });
  return { bytes, pages, text };
}

export const libraryRouter = {
  /** Pasted text; # or numbered headings become sections. */
  add: protectedProcedure.input(z.object({
    requestId, scope, title: z.string().trim().min(1).max(200), source: z.string().trim().min(1).max(200),
    year: z.number().int().min(1900).max(2100), license: z.string().trim().max(200).optional(), text: z.string().trim().min(1).max(200_000),
  })).handler(({ context, input }) =>
    save(context, input, { title: input.title, source: input.source, year: input.year, license: input.license ?? null, kind: "text" }, input.text)),

  /** A PDF with a text layer, indexed one section per page. A scan goes to readScan instead, to be checked first. The file itself is not kept. */
  addPdf: protectedProcedure.input(z.object({ requestId, scope, title, dataBase64: base64(1) })).handler(async ({ context, input }) => {
    const { pages, text } = await pdfOf(input.dataBase64);
    if (!text) throw new ORPCError("BAD_REQUEST", { message: "This PDF is a scan. Sona will read it for you to check first.", data: { reason: "scan" } });
    return { ...await save(context, input, { title: input.title, source: `PDF, ${pagesOf(pages)}`, year: clockOf(context).getFullYear(), kind: "pdf" }, text), pages };
  }),

  /**
   * A scanned PDF (its first ten pages) or up to ten photos of printed pages, read by the vision model and handed back
   * beside each page's picture for staff to check. Saves nothing; addScan saves what they checked.
   */
  readScan: protectedProcedure.input(z.union([
    z.object({ pdf: z.object({ dataBase64: base64(1) }) }).strict(),
    z.object({ images: z.array(z.object({ dataBase64: base64(16), contentType: z.enum(["image/jpeg", "image/png"]) })).min(1).max(10) }).strict(),
  ])).handler(async ({ context, input }) => {
    let shown: { image: string; contentType: "image/png" | "image/jpeg"; bytes: Uint8Array }[];
    if ("pdf" in input) {
      const { bytes, text } = await pdfOf(input.pdf.dataBase64);
      if (text) throw new ORPCError("BAD_REQUEST", { message: "This PDF has text; add it as a PDF.", data: { reason: "has-text" } });
      const { images } = await pdfPageImages(bytes);
      if (!images.length) throw new ORPCError("BAD_REQUEST", { message: "No text could be read from this scan.", data: { reason: "no-text" } });
      shown = images.map(png => ({ image: base64Of(png), contentType: "image/png", bytes: png }));
    } else shown = input.images.map(i => ({ image: i.dataBase64, contentType: i.contentType, bytes: bytesOf(i.dataBase64) }));
    const { model, pages } = await readPages(context, shown.map(s => ({ image: s.bytes, contentType: s.contentType })));
    return { pages: pages.map((p, i) => ({ ...p, image: shown[i]!.image, contentType: shown[i]!.contentType })), model, source: "pdf" in input ? "pdf" as const : "photo" as const };
  }),

  /** A scan's pages as staff checked them against the page pictures, one "# Page n" section each; blank pages are left out. */
  addScan: protectedProcedure.input(z.object({
    requestId, scope, title, source: z.enum(["pdf", "photo"]), model: z.string().trim().min(1).max(80),
    pages: z.array(z.string().trim().max(20_000)).min(1).max(10),
  })).handler(async ({ context, input }) => {
    const text = input.pages.map((t, i) => t && `# Page ${i + 1}\n${t}`).filter(Boolean).join("\n\n");
    if (!text) throw new ORPCError("BAD_REQUEST", { message: "No text could be read from this scan.", data: { reason: "no-text" } });
    const pages = input.pages.length;
    const source = `${input.source === "pdf" ? "Scanned PDF" : "Photo"}, ${pagesOf(pages)}, read by ${input.model}, checked by staff`;
    return { ...await save(context, input, { title: input.title, source, year: clockOf(context).getFullYear(), kind: "scan" }, text), pages };
  }),

  /** What a pasted PMID, DOI or PubMed link points to, shown to the doctor before anything is added. */
  previewArticle: protectedProcedure.input(z.object({ ref: z.string().trim().min(1).max(500) })).handler(async ({ context, input }) => {
    const pmid = await resolveArticle(input.ref, context.fetch ?? fetch).catch(() => { throw new ORPCError("SERVICE_UNAVAILABLE", { message: "PubMed is not answering. Try again in a moment." }); });
    if (!pmid) throw new ORPCError("NOT_FOUND", { message: "No PubMed article matches that. Paste a PMID, a DOI or a PubMed link." });
    const { title, journal, year, text } = await article(context, pmid);
    return { pmid, title, journal, year, sections: text.split(/^# /m).length - 1, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` };
  }),

  /** The previewed article's abstract, each labelled part a section. Abstracts only: full text is copyrighted unless open access. */
  importArticle: protectedProcedure.input(z.object({ requestId, scope, pmid: z.string().regex(/^\d{1,9}$/) })).handler(async ({ context, input }) => {
    const { title, journal, year, text } = await article(context, input.pmid);
    return save(context, input, { title, source: journal || "PubMed", year, license: "PubMed abstract", kind: "pubmed" }, text);
  }),

  /**
   * The hospital's shared sources and the caller's own, newest first. The hospital's patient leaflets (kind "leaflet",
   * which Sona Care's answers read) are not a doctor's sources: they are neither listed here nor removed below.
   * ponytail: nobody can see or edit the leaflets in Sona Pro yet (the seed puts them there); give them a screen of their own.
   */
  list: protectedProcedure.handler(({ context }) =>
    context.db.select({
      id: documents.id, title: documents.title, source: documents.source, year: documents.year, license: documents.license, uploadedBy: documents.uploadedBy, createdAt: documents.createdAt,
      kind: sql<"text" | "pdf" | "pubmed" | "scan">`${documents.kind}`, scope: sql<"me" | "hospital">`case when ${documents.ownerId} is null then 'hospital' else 'me' end`,
      sections: sql<number>`(select count(*)::int from chunks c where c.document_id = "documents"."id")`,
    }).from(documents)
      .where(and(eq(documents.hospitalId, context.hospitalId), ne(documents.kind, "leaflet"), or(isNull(documents.ownerId), eq(documents.ownerId, context.session.user.id))))
      .orderBy(desc(documents.createdAt))),

  /**
   * Management only: re-embeds the shared library and every source of the hospital (its doctors' private ones too;
   * only the count comes back). Run once after the embedding model changes, since vectors from two models do not compare.
   */
  reindex: protectedProcedure.handler(async ({ context }) => ({ chunks: await libraryOf(context).reindex(context.hospitalId) })),

  /** Deletes a shared source of the hospital's or one of the caller's own; its sections go with it. */
  remove: protectedProcedure.input(z.object({ documentId: z.string().min(1) })).handler(async ({ context, input }) => {
    const [gone] = await context.db.delete(documents).where(and(eq(documents.id, input.documentId), eq(documents.hospitalId, context.hospitalId), ne(documents.kind, "leaflet"), or(isNull(documents.ownerId), eq(documents.ownerId, context.session.user.id)))).returning({ id: documents.id });
    if (!gone) throw new ORPCError("NOT_FOUND", { message: `No document ${input.documentId} in your library` });
    return gone;
  }),
};
