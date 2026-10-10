import { user } from "@sona-ai/db/schema/auth";
import { accessLogs } from "@sona-ai/db/schema/clinical";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { clockOf } from "../context";
import { protectedProcedure } from "../index";
import { ROLE_LABEL } from "../roles";

/**
 * The PDPA access trail as clinicians read it (rows written by recordAccess in ../access):
 * "who opened this record, when, through what", for doctors and management.
 */

/** What a route did to the record, as the trail says it ("opened the note"). */
const SEEN_AS: Record<string, string> = {
  "encounter.get": "opened the visit", "encounter.edit": "edited the visit", "encounter.recordReview": "recorded a medication review",
  "note.get": "opened the note", "note.save": "saved the note",
  "discharge.update": "changed the discharge plan", "discharge.request": "approved the discharge",
  "claim.status": "checked the claim", "claim.update": "changed the claim", "claim.send": "sent the claim",
  "claim.appealDraft": "drafted an appeal against the denied claim", "claim.appeal": "sent an appeal against the denied claim",
  "prescribing.review": "ran a prescribing check", "prescribing.simulate": "prescribed",
  "xray.read": "viewed the X-ray", "xray.image": "viewed the X-ray", "xray.upload": "added an X-ray", "xray.similar": "viewed similar films", "findings.list": "viewed findings", "findings.detect": "read the X-ray for findings",
  "scan.upload": "scanned a handwritten note", "scan.read": "read a scanned note", "scan.apply": "added a scanned note to the record",
  "messages.list": "read care messages", "messages.thread": "read care messages", "messages.reply": "replied to a care message",
  "messages.draft": "drafted a reply to a care message", "messages.handle": "marked care messages handled", "messages.photo": "viewed a medicine photo", "messages.resolveMedicinePhoto": "decided a medicine photo",
  "adherence.get": "viewed doses taken", "patients.summary": "exported a health summary", "care.healthSummary": "exported their own health summary",
  "checkIns.list": "viewed check-ins", "evidence.ask": "asked for evidence", "evidence.stream": "asked for evidence", "tasks.create": "created a task",
  "results.receive": "recorded a result", "care.code": "gave a Sona Care code",
  "training.samples": "reviewed training samples", "training.decide": "decided a training sample", "training.export": "exported a training dataset",
};

export const accessLogRouter = {
  /** The latest accesses to one patient's record in the caller's hospital, newest first. */
  list: protectedProcedure.input(z.object({ patientId: z.string().min(1), limit: z.number().int().min(1).max(50).optional() })).handler(async ({ context, input }) => {
    const rows = await context.db.select({ userId: accessLogs.userId, name: user.name, route: accessLogs.route, at: accessLogs.at })
      .from(accessLogs).leftJoin(user, eq(user.id, accessLogs.userId))
      .where(and(eq(accessLogs.hospitalId, context.hospitalId), eq(accessLogs.patientId, input.patientId)))
      .orderBy(desc(accessLogs.at)).limit(200);
    // The app re-reads a visit on every live change, so back-to-back reads by the same person through
    // the same route collapse into one line (the newest). ponytail: collapses within the latest 200 rows only.
    const lines: { userId: string; who: string; did: string; route: string; at: Date; times: number }[] = [];
    for (const r of rows) {
      const last = lines.at(-1);
      if (last && last.userId === r.userId && last.route === r.route) { last.times++; continue; }
      lines.push({ userId: r.userId, who: r.name ?? "A clinician", did: SEEN_AS[r.route] ?? "opened the record", route: r.route, at: r.at, times: 1 });
    }
    // `now` is the hospital's (demo) clock the rows were stamped with, so the app's "5 min ago" agrees.
    return { now: clockOf(context), lines: lines.slice(0, input.limit ?? 10) };
  }),
};

export const clinicianRouter = {
  /** Who is signed in and what they may do (the app hides or explains what the role cannot). */
  me: protectedProcedure.handler(({ context }) => ({ userId: context.session.user.id, name: context.session.user.name, email: context.session.user.email, role: context.role, label: ROLE_LABEL[context.role] })),
};
