import { createRouterClient } from "@orpc/server";
import type { Session } from "@sona-ai/auth";
import { encounters, imageVectors } from "@sona-ai/db/schema/clinical";
import { seedDemo } from "@sona-ai/db/seed";
import { addClinician, createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { asc, like } from "drizzle-orm";

import type { Context, ImageEmbedder } from "../context";
import { appRouter } from "./index";

const session = {
  user: { id: "dr-aisyah", name: "Dr Aisyah", email: "aisyah@demo.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  session: { id: "s1", userId: "dr-aisyah", token: "t", expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date() },
} as unknown as Session;

/** A unit vector at `angle` radians in the first two of 512 dimensions, so cosines between films are known. */
const at = (angle: number) => [Math.cos(angle), Math.sin(angle), ...Array.from({ length: 510 }, () => 0)];
// A fake BiomedCLIP: a film's one byte is its angle in tenths of a radian; a phrase with "effusion" sits near film 15.
const embedder: ImageEmbedder = {
  images: async bytes => bytes.map(b => at(b[0]! / 10)),
  text: async queries => queries.map(q => at(q.includes("effusion") ? 1.4 : 0)),
};
const uploads = { put: async () => {}, get: async () => null };

async function signedIn(extra: Partial<Context> = {}) {
  const db = await createTestDb();
  await seedDemo(db, new Date("2026-09-26T09:00:00+08:00"));
  await addClinician(db, "dr-aisyah");
  const api = createRouterClient(appRouter, { context: { db, session, now: () => new Date("2026-09-26T10:00:00+08:00"), uploads, ...extra } });
  const film = (encounterId: string, byte: number) => api.xray.upload({ encounterId, contentType: "image/png", dataBase64: Buffer.from([byte]).toString("base64") });
  return { db, api, film };
}

test("an upload stores the film's vector, one per visit; similar films rank by cosine and never include the visit's own", async () => {
  const { db, api, film } = await signedIn({ imageEmbedder: embedder });
  const [ward] = await db.select({ id: encounters.id }).from(encounters).where(like(encounters.id, "visit-20%")).orderBy(asc(encounters.id)).limit(1);
  await film("visit-1042", 0);
  await film("visit-1086", 3);
  await film(ward!.id, 15);
  const { key } = await film("visit-1042", 1); // a second film replaces the first in the index
  const rows = await db.select({ key: imageVectors.key, encounterId: imageVectors.encounterId, patientId: imageVectors.patientId, embedding: imageVectors.embedding }).from(imageVectors).orderBy(asc(imageVectors.encounterId));
  expect(rows.map(r => [r.encounterId, r.patientId, r.embedding.length])).toEqual([["visit-1042", "SYN-1042", 512], ["visit-1086", "SYN-1086", 512], [ward!.id, expect.any(String), 512]]);
  expect(rows[0]!.key).toBe(key);

  const like1042 = await api.xray.similar({ encounterId: "visit-1042" });
  expect(like1042.indexed).toBe(true);
  expect(like1042.films.map(f => [f.encounterId, f.score.toFixed(3), f.findings])).toEqual([["visit-1086", Math.cos(0.2).toFixed(3), []], [ward!.id, Math.cos(1.4).toFixed(3), []]]);
  expect(like1042.films[0]).toMatchObject({ patientId: "SYN-1086", patientName: expect.any(String), uploadedAt: new Date("2026-09-26T10:00:00+08:00") });
  // Findings read on a film come with it.
  await api.findings.detect({ encounterId: "visit-1042" });
  const like1086 = await api.xray.similar({ encounterId: "visit-1086", k: 1 });
  expect(like1086.films.map(f => [f.encounterId, f.findings.sort()])).toEqual([["visit-1042", ["9 mm nodule, right upper zone", "Borderline heart size"]]]);
});

test("a phrase finds the films nearest it; a visit with no film, or a film uploaded while the embedder was down, is not indexed", async () => {
  const { api, film } = await signedIn({ imageEmbedder: embedder });
  await film("visit-1042", 0);
  await film("visit-1086", 15);
  const effusion = await api.xray.similar({ text: "effusion on the left", k: 1 });
  expect(effusion.films.map(f => f.encounterId)).toEqual(["visit-1086"]);
  expect(await api.xray.similar({ encounterId: "visit-1042", k: 1 })).toMatchObject({ films: [{ encounterId: "visit-1086" }], indexed: true });
  await expect(api.xray.similar({ encounterId: "visit-1042", text: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

  const down = await signedIn({ imageEmbedder: { ...embedder, images: async () => { throw new Error("box down"); } } });
  expect(await down.film("visit-1042", 0)).toMatchObject({ key: expect.stringContaining("/xray/visit-1042/") }); // still uploads
  expect(await down.api.xray.similar({ encounterId: "visit-1042" })).toEqual({ films: [], indexed: false });
});

test("without an image embedder, similar films are unavailable", async () => {
  const { api, film } = await signedIn();
  await film("visit-1042", 0);
  await expect(api.xray.similar({ encounterId: "visit-1042" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
});
