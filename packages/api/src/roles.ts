/**
 * Clinician roles and what each may call: the one permission table, enforced by the API middleware
 * (packages/api/src/index.ts) and read by the app to hide or explain what a role cannot do. Pure
 * data with no server imports, so the app can import it too.
 *
 * Design: every clinician route is listed here with the roles allowed and what it does in plain
 * words. A route missing from the table is refused for everyone (fail closed); roles.test.ts walks
 * the router so a new route cannot ship unlisted. Reads are listed like writes: clinical detail
 * (notes, results, messages) is for doctors, nurses and management (read only); bed managers see
 * the ward, beds, tasks and discharge status, not clinical notes.
 */
export const ROLES = ["doctor", "nurse", "bed-manager", "management"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = { doctor: "Doctor", nurse: "Nurse", "bed-manager": "Bed manager", management: "Management" };
const PLURAL: Record<Role, string> = { doctor: "Doctors", nurse: "Nurses", "bed-manager": "Bed managers", management: "Management" };

const ALL = ROLES;
const DOCTOR = ["doctor"] as const;
const CARE = ["doctor", "nurse"] as const; // hands-on care
const CLINICAL_READ = ["doctor", "nurse", "management"] as const; // clinical detail, read only for management
const WARD = ["doctor", "nurse", "bed-manager"] as const; // bed flow: blocker owners
const OVERSIGHT = ["doctor", "management"] as const; // coding audit, access trail, hospital library
const MANAGEMENT = ["management"] as const; // the hospital's data stewardship (training data)

/** Route path ("discharge.request") → who may call it, and what it does (for the refusal). */
export const PERMISSIONS: Record<string, readonly [readonly Role[], string]> = {
  privateData: [ALL, "see your account"],
  "clinician.me": [ALL, "see your role"],
  "accessLog.list": [OVERSIGHT, "see who opened a record"],
  "demo.status": [ALL, "read the demo clock"],
  "demo.jump": [ALL, "move the demo clock"],
  "ops.get": [ALL, "see the ops counter"],
  "ward.beds": [ALL, "see the ward"],
  "ward.assignOwner": [WARD, "assign a blocker owner"],
  "ward.forecast": [ALL, "see the bed forecast"],
  "patients.list": [ALL, "see the patient list"],
  "patients.trends": [CLINICAL_READ, "see a patient's trends"],
  "day.list": [ALL, "see the day's visits"],
  "tasks.list": [ALL, "see tasks"],
  "tasks.complete": [CARE, "complete a task"],
  "tasks.create": [CARE, "create a task"],
  "claim.status": [ALL, "see the claim status"],
  "claim.update": [DOCTOR, "change the claim"],
  "claim.send": [DOCTOR, "send a claim"],
  "claim.appealDraft": [OVERSIGHT, "draft an appeal against a denied guarantee letter"],
  "claim.appeal": [OVERSIGHT, "appeal a denied guarantee letter"],
  "discharge.update": [DOCTOR, "change the discharge plan"],
  "discharge.request": [DOCTOR, "approve a discharge"],
  "encounter.get": [CLINICAL_READ, "open the visit"],
  "encounter.briefing": [CLINICAL_READ, "read the briefing"],
  "encounter.timeline": [CLINICAL_READ, "read the timeline"],
  "encounter.reasoning": [DOCTOR, "ask for clinical reasoning"],
  "discharge.draft": [CARE, "draft the discharge summary"],
  "discharge.plan": [CLINICAL_READ, "read the discharge plan"],
  "claim.suggestCodes": [OVERSIGHT, "suggest claim codes"],
  "ward.huddle": [ALL, "hear the huddle brief"],
  "bookings.slots": [ALL, "see free clinic slots"],
  "bookings.list": [CARE, "see booking requests"],
  "bookings.decide": [CARE, "confirm or decline a booking request"],
  "encounter.edit": [DOCTOR, "edit the visit record"],
  "encounter.recordReview": [DOCTOR, "record a medication review"],
  "prescribing.review": [DOCTOR, "run a prescribing check"],
  "prescribing.simulate": [DOCTOR, "prescribe"],
  "prescribing.amend": [DOCTOR, "amend a prescription"],
  "note.get": [CLINICAL_READ, "read the note"],
  "note.save": [DOCTOR, "write the note"],
  "note.draft": [DOCTOR, "draft the note from the consultation"],
  "evidence.ask": [CARE, "ask for evidence"],
  "evidence.stream": [CARE, "ask for evidence"],
  "adherence.get": [CLINICAL_READ, "see doses taken"],
  "results.list": [CLINICAL_READ, "see results"],
  "results.receive": [CARE, "record a result"],
  "results.acknowledge": [DOCTOR, "acknowledge a result"],
  "handover.list": [CLINICAL_READ, "read the handover"],
  "handover.accept": [CARE, "accept a handover"],
  "handover.receivers": [CARE, "see who can take a handover"],
  "xray.read": [CLINICAL_READ, "see the X-ray"],
  "xray.image": [CLINICAL_READ, "see the X-ray"],
  "xray.upload": [DOCTOR, "add an X-ray"],
  "scan.upload": [DOCTOR, "scan a handwritten note"],
  "scan.read": [DOCTOR, "read a scanned note"],
  "scan.apply": [DOCTOR, "add a scanned note to the record"],
  "findings.list": [CLINICAL_READ, "see findings"],
  "findings.detect": [DOCTOR, "read an X-ray for findings"],
  "findings.status": [CLINICAL_READ, "see who read the X-ray for findings"],
  "findings.track": [DOCTOR, "track a finding"],
  "findings.addToVisit": [DOCTOR, "add a finding to a visit"],
  "findings.dismiss": [DOCTOR, "dismiss a finding"],
  "checkIns.list": [CLINICAL_READ, "see check-ins"],
  "checkIns.followUp": [CLINICAL_READ, "see Sona's follow-up"],
  "checkIns.tick": [CARE, "send due check-ins"],
  "checkIns.reply": [CARE, "record a check-in reply"],
  "checkIns.bookIn": [DOCTOR, "book a patient in"],
  "messages.list": [CLINICAL_READ, "read care messages"],
  "messages.reply": [CARE, "reply to a care message"],
  "messages.inbox": [CLINICAL_READ, "see the care inbox"],
  "messages.thread": [CLINICAL_READ, "read care messages"],
  "messages.draft": [CARE, "draft a reply to a care message"],
  "messages.handle": [CARE, "mark a care message handled"],
  "messages.photo": [CARE, "see a patient's medicine photo"],
  "messages.resolveMedicinePhoto": [CARE, "add or decline a medicine from a patient's photo"],
  "review.list": [CARE, "see what is waiting for review"],
  "review.approve": [DOCTOR, "approve what a patient will read"],
  "review.dismiss": [DOCTOR, "dismiss a drafted summary"],
  "care.code": [CARE, "give a Sona Care code"],
  "audit.list": [OVERSIGHT, "see the coding audit"],
  "audit.run": [OVERSIGHT, "run the coding audit"],
  "audit.query": [OVERSIGHT, "query a coding audit item"],
  "library.list": [ALL, "see the library"],
  "library.add": [OVERSIGHT, "add to the library"],
  "library.addPdf": [OVERSIGHT, "add to the library"],
  "library.readScan": [OVERSIGHT, "add to the library"],
  "library.addScan": [OVERSIGHT, "add to the library"],
  "library.previewArticle": [OVERSIGHT, "add to the library"],
  "library.importArticle": [OVERSIGHT, "add to the library"],
  "library.remove": [OVERSIGHT, "remove from the library"],
  "library.reindex": [MANAGEMENT, "re-index the library"],
  "training.status": [MANAGEMENT, "see the training data"],
  "training.setContributes": [MANAGEMENT, "change whether the hospital contributes training data"],
  "training.samples": [MANAGEMENT, "review training samples"],
  "training.decide": [MANAGEMENT, "approve or exclude a training sample"],
  "training.export": [MANAGEMENT, "export a training dataset"],
  "tasks.update": [CARE, "reassign or redate a task"],
  "ward.unassignOwner": [WARD, "clear a blocker owner"],
  "voice.transcribe": [ALL, "speak to Sona"],
  "ask.route": [ALL, "ask Sona"],
  "ask.free": [ALL, "ask Sona"],
  // Watches answer from results and tasks, so they follow results.list.
  "watches.list": [CLINICAL_READ, "see your watches"],
  "watches.create": [CLINICAL_READ, "ask Sona to keep watching"],
  "watches.remove": [CLINICAL_READ, "remove a watch"],
};

export const can = (role: Role, path: string) => PERMISSIONS[path]?.[0].includes(role) ?? false;

const WHO: Record<Role, string> = { doctor: "a doctor", nurse: "a nurse", "bed-manager": "a bed manager", management: "management" };
/** "a doctor", "a doctor or a nurse", "a doctor, a nurse or management". */
const anyOf = (allowed: readonly Role[]) => allowed.map(r => WHO[r]).join(", ").replace(/, ([^,]*)$/, " or $1");

/** Who to ask instead, e.g. "Ask the attending doctor." or "Ask a doctor or a nurse." */
const askInstead = (allowed: readonly Role[]) => allowed.length === 1 && allowed[0] === "doctor" ? "Ask the attending doctor." : `Ask ${anyOf(allowed)}.`;

/** Why this role is refused, in plain words; undefined when allowed. */
export function refusal(role: Role, path: string) {
  const rule = PERMISSIONS[path];
  if (!rule) return "This isn't open to any role yet.";
  if (rule[0].includes(role)) return undefined;
  return `${PLURAL[role]} can't ${rule[1]}. ${askInstead(rule[0])}`;
}

/** The short reason on a locked button, e.g. "Needs a doctor" or "Needs a doctor or a nurse". */
export function needs(path: string) {
  const allowed = PERMISSIONS[path]?.[0] ?? [];
  return allowed.length ? `Needs ${anyOf(allowed)}` : "Not available";
}
