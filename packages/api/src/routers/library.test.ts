import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";

import type { LibraryDocument } from "../context";
import { stubModels, type Models } from "../models";
import { pdfPageImages } from "../pdf";
import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;

/** A one-page PDF whose only content is a 4x2 RGB image: a scan, with no text layer. */
function scannedPdf() {
  const pixels = Array.from({ length: 4 * 2 * 3 }, (_, i) => (i * 10) % 256);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 4 2] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 26 >>\nstream\nq 4 0 0 2 0 0 cm /Im1 Do Q\nendstream",
    `<< /Type /XObject /Subtype /Image /Width 4 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${String.fromCharCode(...pixels)}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((o, i) => { const at = body.length; body += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(body, c => c.charCodeAt(0));
}
const pdf = btoa(String.fromCharCode(...scannedPdf()));
const photo = { dataBase64: btoa("not really a jpeg, but read all the same"), contentType: "image/jpeg" as const };

/** A fake MedGemma that reads every page as `text` and tracks how many pages it reads at once. */
function reader(text: string) {
  const state = { inFlight: 0, most: 0, pages: [] as { image: Uint8Array; contentType: string }[] };
  const readDocumentPage: Models["readDocumentPage"] = async page => {
    state.pages.push(page);
    state.most = Math.max(state.most, ++state.inFlight);
    await new Promise(r => setTimeout(r, 5));
    state.inFlight--;
    return { text, source: "model", model: "medgemma-1.5-4b" };
  };
  return { state, models: { ...stubModels, readDocumentPage } };
}

async function signedIn(models: Models) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const ingested: { doc: LibraryDocument; text: string }[] = [];
  const library = { search: async () => [], reindex: async () => 0, ingest: async (doc: LibraryDocument, text: string) => { ingested.push({ doc, text }); return 1; } };
  return { ingested, api: createRouterClient(appRouter, { context: { db, session, library, models } }) };
}

test("a scanned PDF gives its page's picture as a PNG", async () => {
  const { pages, images } = await pdfPageImages(scannedPdf());
  expect([pages, images.length]).toEqual([1, 1]);
  expect(new DataView(images[0]!.buffer).getUint32(16)).toBe(4);
});

test("a scanned PDF is read page by page and saved as a scan", async () => {
  const { state, models } = reader("## Dosing\nTake one tablet at night.");
  const { api, ingested } = await signedIn(models);
  const saved = await api.library.addPdf({ requestId: "r1", scope: "hospital", title: "Warfarin leaflet", dataBase64: pdf });
  expect(saved).toMatchObject({ kind: "scan", source: "Scanned PDF, 1 page, read by medgemma-1.5-4b", pages: 1, read: "scan" });
  expect(state.pages[0]!.contentType).toBe("image/png");
  expect(ingested[0]!.text).toBe("# Page 1\n## Dosing\nTake one tablet at night.");
});

test("while the reader is starting, the scan is refused with when to try again, and nothing is saved", async () => {
  const { api, ingested } = await signedIn({ ...stubModels, readDocumentPage: async () => ({ text: "", source: "fixture", waking: 12 }) });
  const refused = api.library.addPdf({ requestId: "r1", scope: "me", title: "Leaflet", dataBase64: pdf });
  await expect(refused).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "The scan reader is starting. Try again in about 12 min.", data: { reason: "reader-off" } });
  const stub = await signedIn(stubModels);
  await expect(stub.api.library.addImages({ requestId: "r2", scope: "me", title: "Leaflet", images: [photo] })).rejects.toMatchObject({ data: { reason: "reader-off" } });
  expect(ingested).toEqual([]);
});

test("a scan the model found no words on is refused", async () => {
  const { api } = await signedIn(reader("").models);
  await expect(api.library.addPdf({ requestId: "r1", scope: "me", title: "Blank", dataBase64: pdf })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "No text could be read from this scan.", data: { reason: "no-text" } });
});

test("photos of a leaflet are read two at a time, one page each, and at most ten are taken", async () => {
  const { state, models } = reader("Ubat ini diambil selepas makan.");
  const { api, ingested } = await signedIn(models);
  const saved = await api.library.addImages({ requestId: "r1", scope: "me", title: "Ubat darah tinggi", images: [photo, photo, photo] });
  expect(saved).toMatchObject({ kind: "scan", source: "Photo, 3 pages, read by medgemma-1.5-4b", pages: 3, read: "scan" });
  expect(state.most).toBe(2);
  expect(ingested[0]!.text.split("# Page ").length - 1).toBe(3);
  await expect(api.library.addImages({ requestId: "r2", scope: "me", title: "Too many", images: Array(11).fill(photo) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
