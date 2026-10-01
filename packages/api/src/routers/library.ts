import { ORPCError } from "@orpc/server";
import { documents, patients } from "@sona-ai/db/schema/clinical";
import { deidentifyByRules, type IdentityKind } from "@sona-ai/domain/training";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { clockOf, type Context } from "../context";
import { protectedProcedure } from "../index";
import { pdfText } from "../pdf";
import { fetchAbstract, resolveArticle } from "../pubmed";

/**
 * A doctor's library: guidelines and references they add by pasting text, uploading a PDF or
 * importing a PubMed abstract. Each is cut into sections and searched alongside the shared library.
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
async function save(context: Authed, input: { requestId: string; scope: "me" | "hospital" }, fields: { title: string; source: string; year: number; license?: string | null; kind: "text" | "pdf" | "pubmed" }, text: string) {
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

export const libraryRouter = {
  /** Pasted text; # or numbered headings become sections. */
  add: protectedProcedure.input(z.object({
    requestId, scope, title: z.string().trim().min(1).max(200), source: z.string().trim().min(1).max(200),
    year: z.number().int().min(1900).max(2100), license: z.string().trim().max(200).optional(), text: z.string().trim().min(1).max(200_000),
  })).handler(({ context, input }) =>
    save(context, input, { title: input.title, source: input.source, year: input.year, license: input.license ?? null, kind: "text" }, input.text)),

  /** A PDF: its text is read here and indexed one section per page; the file itself is not kept. */
  addPdf: protectedProcedure.input(z.object({
    requestId, scope, title: z.string().trim().min(1).max(200),
    dataBase64: z.string().min(1).max(14_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, "Not base64"),
  })).handler(async ({ context, input }) => {
    const bytes = Uint8Array.from(atob(input.dataBase64), c => c.charCodeAt(0));
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new ORPCError("BAD_REQUEST", { message: "This file is not a PDF", data: { reason: "not-pdf" } });
    const { pages, text } = await pdfText(bytes).catch(() => { throw new ORPCError("BAD_REQUEST", { message: "This PDF could not be read. It may be locked with a password.", data: { reason: "unreadable" } }); });
    if (!text) throw new ORPCError("BAD_REQUEST", { message: "This PDF has no text to read. It looks like a scan, and scans are not supported yet.", data: { reason: "no-text" } });
    return { ...await save(context, input, { title: input.title, source: `PDF, ${pages} page${pages === 1 ? "" : "s"}`, year: clockOf(context).getFullYear(), kind: "pdf" }, text), pages };
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

  /** The hospital's shared sources and the caller's own, newest first. */
  list: protectedProcedure.handler(({ context }) =>
    context.db.select({
      id: documents.id, title: documents.title, source: documents.source, year: documents.year, license: documents.license, uploadedBy: documents.uploadedBy, createdAt: documents.createdAt,
      kind: documents.kind, scope: sql<"me" | "hospital">`case when ${documents.ownerId} is null then 'hospital' else 'me' end`,
      sections: sql<number>`(select count(*)::int from chunks c where c.document_id = "documents"."id")`,
    }).from(documents)
      .where(and(eq(documents.hospitalId, context.hospitalId), or(isNull(documents.ownerId), eq(documents.ownerId, context.session.user.id))))
      .orderBy(desc(documents.createdAt))),

  /**
   * Management only: re-embeds the shared library and every source of the hospital (its doctors' private ones too;
   * only the count comes back). Run once after the embedding model changes, since vectors from two models do not compare.
   */
  reindex: protectedProcedure.handler(async ({ context }) => ({ chunks: await libraryOf(context).reindex(context.hospitalId) })),

  /** Deletes a shared source of the hospital's or one of the caller's own; its sections go with it. */
  remove: protectedProcedure.input(z.object({ documentId: z.string().min(1) })).handler(async ({ context, input }) => {
    const [gone] = await context.db.delete(documents).where(and(eq(documents.id, input.documentId), eq(documents.hospitalId, context.hospitalId), or(isNull(documents.ownerId), eq(documents.ownerId, context.session.user.id)))).returning({ id: documents.id });
    if (!gone) throw new ORPCError("NOT_FOUND", { message: `No document ${input.documentId} in your library` });
    return gone;
  }),
};
