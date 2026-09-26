import { admissions, claims, encounters, guaranteeLetters, patients } from "@sona-ai/db/schema/clinical";
import { CODES, EMPTY_CLAIM, claimChecks, noteFor, type ClaimState } from "@sona-ai/domain/claim";
import { eq } from "drizzle-orm";

import type { Context } from "./context";

/**
 * The insurer's side of the final guarantee letter: a page reached by an unguessable link (emailed
 * to the insurer's inbox) showing the packet, where the insurer approves or asks a question. It
 * replaces the timed mock insurer. The token is the only credential, so it expires a week after
 * sending and decides once.
 */
type Db = Context["db"];
const LINK_DAYS = 7;

/** 24 random bytes as URL-safe base64 (32 characters). */
export function newReviewToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const reviewUrl = (publicUrl: string, token: string) => `${publicUrl.replace(/\/$/, "")}/insurer/${token}`;
const ringgit = (cents: number) => `RM ${(cents / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;

export async function reviewTokenOf(db: Db, encounterId: string) {
  const [row] = await db.select({ token: claims.reviewToken }).from(claims).where(eq(claims.encounterId, encounterId));
  return row?.token ?? "";
}

async function claimByToken(db: Db, token: string) {
  if (!token) return undefined;
  const [row] = await db.select({ claim: claims, patient: patients.name, state: encounters.state, patientId: patients.id, hospitalId: encounters.hospitalId }).from(claims)
    .innerJoin(encounters, eq(encounters.id, claims.encounterId)).innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(eq(claims.reviewToken, token));
  return row;
}
const expired = (sentAt: Date | null, now: Date) => !sentAt || now.getTime() > sentAt.getTime() + LINK_DAYS * 24 * 3600_000;

export type ReviewPacket = NonNullable<Awaited<ReturnType<typeof reviewPacket>>>;

/** What the insurer reviews: the patient, the estimate, each code with the note sentence behind it, and the criteria. */
export async function reviewPacket(db: Db, token: string, now: Date) {
  const row = await claimByToken(db, token);
  if (!row) return undefined;
  const state: ClaimState = { ...EMPTY_CLAIM, ...((row.state as { claim?: Partial<ClaimState> }).claim ?? {}) };
  const note = noteFor(state);
  return {
    token, patient: row.patient, insurer: row.claim.insurer, estimate: ringgit(row.claim.estimateCents), status: row.claim.status,
    sentAt: row.claim.sentAt, decidedAt: row.claim.decidedAt, query: row.claim.insurerNote, expired: expired(row.claim.sentAt, now),
    codes: row.claim.codes.map(c => ({ ...c, label: CODES.find(k => k.code === c.code)?.label ?? c.code, kind: CODES.find(k => k.code === c.code)?.kind ?? "Secondary", evidence: note.find(s => s.id === c.evidence)?.text ?? "" })),
    criteria: claimChecks(state),
  };
}

/** Approval closes the claim and marks the admission's guarantee letter received, which the discharge checks. */
export async function approveClaimRows(db: Db, claimId: string, patientId: string, at: Date) {
  await db.update(claims).set({ status: "approved", approvedAt: at, decidedAt: at }).where(eq(claims.id, claimId));
  const admitted = await db.select({ id: admissions.id }).from(admissions).where(eq(admissions.patientId, patientId));
  for (const a of admitted) await db.update(guaranteeLetters).set({ status: "received", receivedAt: at }).where(eq(guaranteeLetters.admissionId, a.id));
}

/** The insurer's decision, once per link: approve, or query with the question for the doctor. */
export async function decideReview(db: Db, token: string, decision: "approve" | "query", note: string, now: Date) {
  const row = await claimByToken(db, token);
  if (!row) return { ok: false as const, reason: "Unknown link" };
  if (expired(row.claim.sentAt, now)) return { ok: false as const, reason: "This link has expired" };
  if (row.claim.status !== "sent") return { ok: false as const, reason: `Already decided: ${row.claim.status}` };
  if (decision === "query") {
    const question = note.trim();
    if (!question) return { ok: false as const, reason: "Write the question for the doctor" };
    await db.update(claims).set({ status: "queried", insurerNote: question.slice(0, 1000), decidedAt: now }).where(eq(claims.id, row.claim.id));
    return { ok: true as const, status: "queried" as const, hospitalId: row.hospitalId, encounterId: row.claim.encounterId };
  }
  await approveClaimRows(db, row.claim.id, row.patientId, now);
  return { ok: true as const, status: "approved" as const, hospitalId: row.hospitalId, encounterId: row.claim.encounterId };
}

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The review page: plain server-rendered HTML with two forms, readable on any phone or laptop. */
export function renderReviewPage(p: ReviewPacket, notice?: string) {
  const decided = p.status !== "sent";
  const outcome = p.status === "approved" ? `Approved${p.decidedAt ? ` · ${p.decidedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}` : p.status === "queried" ? `Queried: ${p.query ?? ""}` : "";
  const rows = p.codes.map(c => `<tr><td><b>${escape(c.code)}</b></td><td>${escape(c.label)}<div class="muted">${escape(c.kind)} · “${escape(c.evidence)}”</div></td></tr>`).join("");
  const checks = p.criteria.map(c => `<li class="${c.status === "passed" ? "ok" : "no"}">${c.status === "passed" ? "✓" : "✗"} ${escape(c.label)} <span class="muted">${escape(c.detail)}</span></li>`).join("");
  const actions = p.expired ? `<p class="notice">This link has expired.</p>` : decided ? `<p class="outcome">${escape(outcome)}</p>` : `
    <form method="post"><input type="hidden" name="decision" value="approve"><button class="primary">Approve guarantee letter</button></form>
    <form method="post"><input type="hidden" name="decision" value="query"><textarea name="note" rows="3" placeholder="Question for the doctor"></textarea><button>Send question</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Guarantee letter review · ${escape(p.patient)}</title>
<style>body{margin:0;background:#F5F6F8;color:#1D1F23;font:16px/1.5 -apple-system,system-ui,sans-serif}main{max-width:640px;margin:0 auto;padding:24px 16px 48px}
.card{background:#fff;border-radius:22px;padding:20px;margin-top:14px;box-shadow:0 6px 20px rgba(24,32,48,.06)}h1{font-size:24px;margin:4px 0}.muted{color:#59616B;font-size:14px}
table{width:100%;border-collapse:collapse}td{padding:8px 4px;border-top:1px solid #eef0f3;vertical-align:top}ul{padding:0;list-style:none;margin:0}li{padding:6px 0}.ok{color:#0F6E66}.no{color:#A23E3E}
button{width:100%;min-height:46px;border-radius:23px;border:1px solid #D8DBE0;background:#E9EEF6;font:600 16px system-ui;margin-top:10px}.primary{background:#1D1F23;color:#fff;border-color:#1D1F23}
textarea{width:100%;box-sizing:border-box;border-radius:14px;border:1px solid #D8DBE0;padding:12px;font:16px system-ui;margin-top:14px}.outcome{font-weight:600;color:#0F6E66}.notice{color:#A23E3E;font-weight:600}.tag{font:700 11px system-ui;letter-spacing:.8px;text-transform:uppercase;color:#245BCC}</style></head>
<body><main><div class="tag">Final guarantee letter · synthetic demo</div><h1>${escape(p.patient)}</h1><div class="muted">${escape(p.insurer)} · estimated ${escape(p.estimate)}</div>
${notice ? `<p class="notice">${escape(notice)}</p>` : ""}
<div class="card"><b>Codes and the note behind each</b><table>${rows}</table></div>
<div class="card"><b>Insurer criteria</b><ul>${checks}</ul></div>
<div class="card">${actions}</div>
<p class="muted">Synthetic patient and fictional insurer. No real person or policy is involved.</p></main></body></html>`;
}
