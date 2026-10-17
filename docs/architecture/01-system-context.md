# 01 · System context

[Diagram](01-system-context.html) · [SVG](01-system-context.svg) · [PNG](01-system-context.png) · [source](01-system-context.archify.json)

**Answers:** who uses Sona, through which app, and which outside systems the server talks to.

## What it shows

- **Hospital staff** (roles `doctor`, `nurse`, `bed-manager`, `management`, `packages/api/src/roles.ts:12`) use **Sona Pro** on iPhone (`apps/native`) or the web at `/pro` (`apps/web/src/routes/pro`). Staff sign in with email and password (`packages/auth/src/index.ts`).
- **Patients** use **Sona Care** on iPhone (`apps/care`) or the web at `/care`. They sign in by phone OTP, Apple or Google, and are linked to a hospital record through `care_links` (`packages/api/src/index.ts`, `patientProcedure`).
- **Insurers** have no login. `claim.send` creates a 24-byte bearer link `/insurer/<token>`, valid 7 days and good for one decision (`packages/api/src/insurer.ts`). The link is emailed through Cloudflare Email when `EMAIL`, `EMAIL_FROM` and `INSURER_EMAIL` are set (`packages/api/src/routers/claim.ts`). The review page is HTML served by the Worker, not by `apps/web` (`apps/server/src/index.ts`).
- **Sona server**: one Cloudflare Worker (Hono, oRPC at `/rpc`, Better Auth, `/live` WebSocket, voice-call agent route). It writes a PDPA access log for every staff call that names a patient (`packages/api/src/access.ts`).
- **Outside systems**: Sona models in AWS Malaysia (SigV4-signed calls), Neon Postgres in Singapore (SQL over HTTPS, `@neondatabase/serverless`), PubMed E-utilities (`eutils.ncbi.nlm.nih.gov`), Expo push (`exp.host`, patients only), and a lab feed endpoint `POST /lab/results` guarded by `LAB_FEED_SECRET`.

## Key decisions

- One Worker serves the API and both web portals (static assets for `/pro*` and `/care*`, `packages/infra/alchemy.run.ts`), so the web uses the same origin and cookies as the API.
- Insurers never get an account: the link is the only credential, it expires, and it decides once.

## Known limits

- Staging only, synthetic patients (`Demo General Hospital (synthetic)`, `SYN-` record numbers, `packages/db/src/seed.ts`).
- No real lab, hospital system or insurer is connected. Patient OTP codes are only logged (no SMS provider).
- The Sona Care web portal has no `/live` socket; its screens poll.

Checked against code at `cd76571b` on 8 Oct 2026.
