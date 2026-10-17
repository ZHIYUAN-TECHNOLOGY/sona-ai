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

/** A one-page PDF of the given page resources and content stream, plus any further objects (numbered from 5). */
function onePagePdf(resources: string, content: string, extra: string[]) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 4 2] /Resources ${resources} /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...extra,
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((o, i) => { const at = body.length; body += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(body, c => c.charCodeAt(0));
}
/** A page whose only content is a 4x2 RGB image: a scan, with no text layer. */
function scannedPdf() {
  const pixels = Array.from({ length: 4 * 2 * 3 }, (_, i) => (i * 10) % 256);
  return onePagePdf("<< /XObject << /Im1 5 0 R >> >>", "q 4 0 0 2 0 0 cm /Im1 Do Q",
    [`<< /Type /XObject /Subtype /Image /Width 4 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${String.fromCharCode(...pixels)}\nendstream`]);
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const pdf = b64(scannedPdf());
const textPdf = b64(onePagePdf("<< /Font << /F1 5 0 R >> >>", "BT /F1 1 Tf 0 0 Td (Rest) Tj ET", ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]));
const photo = { dataBase64: btoa("not really a jpeg, but read all the same"), contentType: "image/jpeg" as const };

/** A fake MedGemma that reads every page as `text`, doubting `unsure`, and tracks how many pages it reads at once. */
function reader(text: string, unsure: string[] = []) {
  const state = { inFlight: 0, most: 0, pages: [] as { image: Uint8Array; contentType: string }[] };
  const readDocumentPage: Models["readDocumentPage"] = async page => {
    state.pages.push(page);
    state.most = Math.max(state.most, ++state.inFlight);
    await new Promise(r => setTimeout(r, 5));
    state.inFlight--;
    return { text, unsure, source: "model", model: "medgemma-1.5-4b" };
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

test("a scanned PDF is read page by page and handed back beside each page's picture, and nothing is saved", async () => {
  const { state, models } = reader("## Dosing\nTake one tablet at night.", ["night"]);
  const { api, ingested } = await signedIn(models);
  const read = await api.library.readScan({ pdf: { dataBase64: pdf } });
  const [png] = (await pdfPageImages(scannedPdf())).images;
  expect(read).toEqual({ source: "pdf", model: "medgemma-1.5-4b", pages: [{ text: "## Dosing\nTake one tablet at night.", unsure: ["night"], image: b64(png!), contentType: "image/png" }] });
  expect(state.pages[0]!.contentType).toBe("image/png");
  expect(ingested).toEqual([]);
});

test("a PDF with text is not read as a scan, and a scan is not added as a PDF", async () => {
  const { api, ingested } = await signedIn(reader("Take one tablet.").models);
  await expect(api.library.readScan({ pdf: { dataBase64: textPdf } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This PDF has text; add it as a PDF.", data: { reason: "has-text" } });
  await expect(api.library.addPdf({ requestId: "r1", scope: "me", title: "Leaflet", dataBase64: pdf })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This PDF is a scan. Sona will read it for you to check first.", data: { reason: "scan" } });
  expect(await api.library.addPdf({ requestId: "r2", scope: "me", title: "Leaflet", dataBase64: textPdf })).toMatchObject({ kind: "pdf", source: "PDF, 1 page", pages: 1 });
  expect(ingested.map(i => i.text)).toEqual(["# Page 1\nRest"]);
});

test("while the reader is starting, the scan is refused with when to try again", async () => {
  const { api } = await signedIn({ ...stubModels, readDocumentPage: async () => ({ text: "", unsure: [], source: "fixture", waking: 12 }) });
  await expect(api.library.readScan({ pdf: { dataBase64: pdf } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "The scan reader is starting. Try again in about 12 min.", data: { reason: "reader-off" } });
  const stub = await signedIn(stubModels);
  await expect(stub.api.library.readScan({ images: [photo] })).rejects.toMatchObject({ data: { reason: "reader-off" } });
});

test("a scan the model found no words on is refused", async () => {
  const { api } = await signedIn(reader("").models);
  await expect(api.library.readScan({ pdf: { dataBase64: pdf } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "No text could be read from this scan.", data: { reason: "no-text" } });
});

test("photos of a leaflet are read two at a time, one page each, each shown back as itself, and at most ten are taken", async () => {
  const { state, models } = reader("Ubat ini diambil selepas makan.");
  const { api, ingested } = await signedIn(models);
  const read = await api.library.readScan({ images: [photo, photo, photo] });
  expect(read.source).toBe("photo");
  expect(read.pages).toHaveLength(3);
  expect(read.pages[0]).toEqual({ text: "Ubat ini diambil selepas makan.", unsure: [], image: photo.dataBase64, contentType: "image/jpeg" });
  expect(state.most).toBe(2);
  expect(ingested).toEqual([]);
  await expect(api.library.readScan({ images: Array(11).fill(photo) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("a scan staff checked is saved as a scan, one section per page with words, and a scan with none is refused", async () => {
  const { api, ingested } = await signedIn(stubModels);
  const saved = await api.library.addScan({ requestId: "r1", scope: "hospital", title: "Ubat darah tinggi", source: "photo", model: "medgemma-1.5-4b", pages: ["Ambil selepas makan.", "  ", "Simpan di tempat sejuk."] });
  expect(saved).toMatchObject({ kind: "scan", source: "Photo, 3 pages, read by medgemma-1.5-4b, checked by staff", pages: 3, scope: "hospital" });
  expect(ingested[0]!.text).toBe("# Page 1\nAmbil selepas makan.\n\n# Page 3\nSimpan di tempat sejuk.");
  await expect(api.library.addScan({ requestId: "r2", scope: "me", title: "Blank", source: "pdf", model: "medgemma-1.5-4b", pages: ["", " "] })).rejects.toMatchObject({ code: "BAD_REQUEST", data: { reason: "no-text" } });
});
