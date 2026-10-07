/**
 * The scan review on a server, the way the upload screens do it, as the synthetic test doctor: a scanned PDF is
 * refused by library.addPdf as a scan, library.readScan reads its pages (and the photos given) without saving, the
 * pages are printed with the words MedGemma was unsure of, then library.addScan saves them as checked, into the
 * doctor's own scope ("me") so no one else sees them. `--remove` deletes them again afterwards.
 *
 *   bun apps/server/test/scan-upload.ts <server url> <scanned.pdf> [page.jpg ...] [--remove]
 * Box ③ (MedGemma) must be up, or the server answers that the scan reader is starting.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { TEST_DOCTOR } from "../../../packages/db/src/seed";

const args = process.argv.slice(2), files = args.filter(a => !a.startsWith("--")), server = files.shift();
if (!server || !files.length) { console.error("Usage: bun apps/server/test/scan-upload.ts <server url> <scanned.pdf> [page.jpg ...] [--remove]"); process.exit(1); }

const res = await fetch(new URL("/api/auth/sign-in/email", server), {
  method: "POST", headers: { "Content-Type": "application/json", Origin: server }, body: JSON.stringify({ email: TEST_DOCTOR.email, password: TEST_DOCTOR.password }),
});
if (!res.ok) throw new Error(`Sign-in failed: ${res.status} ${await res.text()}`);
const cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
// oRPC's RPC protocol by hand (the server has no client package): POST /rpc/<router>/<procedure> with {"json": input}.
const call = async (path: string, input?: unknown): Promise<any> => {
  const r = await fetch(new URL(`/rpc/${path}`, server), { method: "POST", headers: { "Content-Type": "application/json", cookie, origin: server }, body: JSON.stringify({ json: input }) });
  const body = await r.json() as { json: any };
  if (!r.ok) throw Object.assign(new Error(`${r.status} ${body.json?.message ?? ""}`), { reason: body.json?.data?.reason });
  return body.json;
};
const b64 = (path: string) => readFileSync(path).toString("base64");
const timed = async <T>(what: string, run: () => Promise<T>) => {
  const t = Date.now();
  try { const out = await run(); console.log(`${what}: ${((Date.now() - t) / 1000).toFixed(1)} s`); return out; }
  catch (e) { console.log(`${what}: FAILED after ${((Date.now() - t) / 1000).toFixed(1)} s: ${(e as Error).message}`); return undefined; }
};
type Read = { pages: { text: string; unsure: string[]; image: string; contentType: string }[]; model: string; source: "pdf" | "photo" };
const show = (read: Read) => read.pages.forEach((p, i) => {
  console.log(`  page ${i + 1} (${p.contentType}, ${Math.round(p.image.length * 3 / 4 / 1024)} KB): ${p.text.replace(/\s+/g, " ").slice(0, 160)}`);
  if (p.unsure.length) console.log(`    unsure of: ${p.unsure.join(", ")}`);
});

const pdfs = files.filter(f => f.endsWith(".pdf")), images = files.filter(f => !f.endsWith(".pdf"));
const added: string[] = [];
for (const pdf of pdfs) {
  const refused = await call("library/addPdf", { requestId: crypto.randomUUID(), scope: "me", title: "x", dataBase64: b64(pdf) }).then(() => "saved it!", e => e.reason);
  console.log(`addPdf on the scan ${basename(pdf)}: ${refused === "scan" ? "refused as a scan, as it should" : "WRONG: " + refused}`);
  const read = await timed(`readScan ${basename(pdf)}`, (): Promise<Read> => call("library/readScan", { pdf: { dataBase64: b64(pdf) } }));
  if (!read) continue;
  show(read);
  const saved = await timed("addScan", () => call("library/addScan", { requestId: crypto.randomUUID(), scope: "me", title: `Scan test: ${basename(pdf)}`, source: read.source, model: read.model, pages: read.pages.map(p => p.text) }));
  if (saved) { added.push(saved.id); console.log(`  ${JSON.stringify(saved)}`); }
}
if (images.length) {
  const read = await timed(`readScan ${images.length} photos`, (): Promise<Read> => call("library/readScan", { images: images.map(f => ({ dataBase64: b64(f), contentType: f.endsWith(".png") ? "image/png" : "image/jpeg" })) }));
  if (read) {
    show(read);
    const saved = await timed("addScan", () => call("library/addScan", { requestId: crypto.randomUUID(), scope: "me", title: `Scan test: ${images.length} photos`, source: read.source, model: read.model, pages: read.pages.map(p => p.text) }));
    if (saved) { added.push(saved.id); console.log(`  ${JSON.stringify(saved)}`); }
  }
}
const mine = (await call("library/list") as { id: string; kind: string; title: string; source: string }[]).filter(d => added.includes(d.id));
for (const d of mine) console.log(`listed: ${d.kind} | ${d.title} | ${d.source}`);
if (args.includes("--remove")) for (const id of added) await call("library/remove", { documentId: id }).then(() => console.log(`removed ${id}`));
