# 03 · Where patient data goes

[Diagram](03-data-privacy.html) · [SVG](03-data-privacy.svg) · [PNG](03-data-privacy.png) · [source](03-data-privacy.archify.json)

**Answers (hospital IT):** what leaves the phone, what each model sees, what is stored, what is deleted, and where it lives.

## What it shows

| Data | Path | Kept? |
| --- | --- | --- |
| Visit audio | Phone records 16 kHz WAV parts, sends each as base64 to `voice.transcribe`; the Worker decodes it in memory and forwards it to `sona-voice`, which diarizes and transcribes from `BytesIO` | **Not stored** on the server or the box. The phone deletes each part after a successful transcribe (`apps/native/features/scribe/live.ts`); a part that failed twice stays on the phone for Retry |
| Transcript turns | Returned to the phone; sent back with `note.draft` | **Stored**: the draft and its `turns` are written to `provenance.output` (`routers/note.ts`) |
| Saved note | `note.save` | Stored in `notes`, one row per revision |
| X-rays, scans, care photos | Bytes to the Worker, then R2 `uploads` | **Stored** in R2. X-ray readings and findings in Postgres; X-ray text indexed as a library document `xray:<visit>` |
| Library scans (`library.readScan`) | Pages read by Sona Vision | Not saved; only the staff-checked text (`library.addScan`) |
| Patient messages, replies, call turns | Text to Sona Med for triage and replies | Stored (`care_messages`, `check_in_replies`, `tasks`) |
| Claim | Codes with their note sentences, frozen at send | Stored in `claims`; shown to the insurer through the link |

## What each model sees

- **De-identified first (Sona Privacy):**
  - Training samples: rules, then the OpenMed model on `sona-pii`, then a leak gate (`routers/training.ts`).
  - Evidence questions: rules only remove the patient's name, name parts and record number from the question, thread and record (`routers/evidence.ts`).
  - Scanned ward notes: only the patient's name text is replaced before MedGemma reads the image (`routers/scan.ts`); the handwriting itself can still name the patient.
- **As written:** the scribe transcript (`draftNote`), note sentences for codes, appeals (with the patient's name), message triage and replies (first name), check-in replies, care answers. Images go as pixels.

## Key decisions

- Audio never touches storage on the server side; the phone owns deletion.
- Every model runs in Malaysia; no model call leaves for a US host while `SAGEMAKER_ENDPOINTS` names every box.
- Sona Privacy is rules first, model second; it replaces name, IC, phone, email and MRN, and keeps addresses and dates of birth on purpose (`packages/api/src/pii-model.ts`).

## Known limits

- The database is in Singapore and the Worker and R2 are on Cloudflare: **patient data is not resident in Malaysia today.** Staging holds synthetic patients only.
- Most model calls are not de-identified (they run inside our own Malaysian endpoints, but the claim "Sona Privacy de-identifies everything" would be false).
- The X-ray library document contains the patient's name and id (`indexXray`, `routers/xray.ts`), and evidence passages are not de-identified, so a film passage can reach Sona Med with the name in it.
- The 999 push body includes the patient's first name (`packages/domain/src/messages.ts`); other pushes carry no clinical text.
- No retention job: nothing deletes R2 objects or old rows except the demo reset (`packages/db/src/reset.ts`).

Checked against code at `cd76571b` on 8 Oct 2026.
