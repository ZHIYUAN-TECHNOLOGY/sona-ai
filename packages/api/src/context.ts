import type { Session } from "@sona-ai/auth";
import type { FollowUp } from "@sona-ai/domain/check-in-agent";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

import type { Baseten } from "./baseten-models";
import type { EncounterEdit, RecordReview, RetrievalHit, SearchInput } from "./contracts";
import type { Change } from "./events";
import type { Models } from "./models";
import type { EncounterSnapshot } from "./routers/encounter";
import type { Watches } from "./watches";

export type EncounterStore = {
  edit(hospitalId: string, edit: EncounterEdit): Promise<EncounterSnapshot>;
  recordReview(hospitalId: string, review: RecordReview): Promise<EncounterSnapshot>;
};

export type Context = {
  session: Session | null;
  /** Any drizzle Postgres database: Neon in the Worker, PGlite in tests. */
  db: PgAsyncDatabase<any, any>;
  /** The Worker passes the encounter's Durable Object so edits go through the live state; tests write Postgres directly. */
  encounters?: EncounterStore;
  /** The clock; tests pass a fixed one so time-based rules (the mock insurer) are deterministic. */
  now?: () => Date;
  /** The model seam; stubModels (fixtures) until the Baseten boxes come off hold. */
  models?: Models;
  /** Image storage: the Worker passes its R2 bucket; tests pass an in-memory one. */
  uploads?: Uploads;
  /** Outbound HTTP (PubMed); tests pass a fake so nothing leaves the machine. */
  fetch?: typeof fetch;
  /** The Worker's public address, for links that open outside the app (the insurer's review page). */
  publicUrl?: string;
  /** Outbound email (Cloudflare Email Service); absent until a sending domain and the inboxes are configured. */
  mail?: Mail;
  /** Live updates: tells the hospital's connected apps what a write changed (see ./events). */
  announce?: (hospitalId: string, change: Change) => Promise<void>;
  /** The retrieval library: the Worker passes packages/retrieval's ingest and search, which import this package, so they come in here. */
  library?: Library;
  /** BiomedCLIP on the embedder's box (packages/infra/aws/embed): films and film queries as vectors, for xray.similar. Absent, that route is unavailable. */
  imageEmbedder?: ImageEmbedder;
  /** DEMO_SIGN_IN=1 (staging only): Sona Care's sign-in shows the seeded demo phone and its fixed code (care.demoSignIn). */
  demoSignIn?: boolean;
  /** The Baseten key (and, in tests, a fake fetch) for routes that call a box directly: ask.route (Laya), ask.free (Gemma). Absent: they answer fixture. */
  baseten?: Baseten;
  /** Sona's follow-up after discharge: the Worker's check-in agents, one per visit. Absent (tests), due check-ins are sent directly. */
  followUps?: FollowUps;
  /** The clinicians' own watch agents, one per clinician (./watches). Absent, nobody has watches. */
  watches?: Watches;
  /** The Worker's waitUntil: work that finishes after the answer is sent (the access trail). Absent (tests), it is awaited. */
  waitUntil?: (promise: Promise<unknown>) => void;
};

/** Images (the uploaded bytes) and text queries to BiomedCLIP's shared 512-d space, normalised, so either compares by cosine. */
export type ImageEmbedder = {
  images(bytes: Uint8Array[]): Promise<number[][]>;
  text(queries: string[]): Promise<number[][]>;
};

export type { FollowUp };
/** A discharged visit's check-in agent, by visit (apps/server/src/agents/check-in.ts; tests run it in memory). */
export type FollowUps = {
  /** Wakes the agent: it acts on whatever is due by the hospital's clock, reads new replies and sets its next alarm. */
  tick(hospitalId: string, encounterId: string): Promise<{ sent: number }>;
  /** What it remembers and did, for the clinician; null before its first wake or for another hospital. */
  get(hospitalId: string, encounterId: string): Promise<FollowUp | null>;
};

/** Email as the routes use it: who sends, the insurer's inbox, and the send itself. */
export type Mail = {
  from: string;
  insurer: string;
  send(message: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
};

/** A library document; hospitalId empty is the shared library, set is one hospital's own; ownerId set is one doctor's private source. */
export type LibraryDocument = { id: string; hospitalId: string | null; title: string; source: string; year: number; license?: string | null; uploadedBy?: string | null; ownerId?: string | null; kind?: "text" | "pdf" | "pubmed" | "leaflet" | "scan" | "xray" };
export type Library = {
  /** Stores the document and its sections; re-ingesting the same ID replaces them. Returns the section count. */
  ingest(doc: LibraryDocument, text: string): Promise<number>;
  /** Hybrid search over the shared library, the caller's hospital and the caller's own private sources; with `patient`, over the hospital's patient leaflets alone. Patients' films only for the visits in `films`. */
  search(input: SearchInput): Promise<RetrievalHit[]>;
  /** Re-embeds the shared library and the hospital's sources (after the embedding model changes). Returns the chunk count. */
  reindex(hospitalId: string): Promise<number>;
};

/** The slice of an R2 bucket the routes use. */
export type Uploads = {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
};

export const clockOf = (context: Pick<Context, "now">) => context.now?.() ?? new Date();
