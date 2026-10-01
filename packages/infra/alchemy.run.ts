import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import "varlock/auto-load";

import type { CheckInAgent } from "../../apps/server/src/agents/check-in";
import type { SonaVoiceAgent } from "../../apps/server/src/agents/voice";
import type { EncounterState } from "../../apps/server/src/encounter-state";
import type { HospitalChannel } from "../../apps/server/src/hospital-channel";

/** Audio and X-ray uploads (presigned URLs from the Worker). */
export const uploads = Cloudflare.R2.Bucket("uploads");

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    DATABASE_URL: Config.Redacted("DATABASE_URL"),
    CORS_ORIGIN: Config.String("CORS_ORIGIN"),
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    ENCOUNTERS: Cloudflare.DurableObject<EncounterState>("ENCOUNTERS", { className: "EncounterState" }),
    // Live updates: one channel per hospital that pushes "what changed" to connected apps.
    CHANNELS: Cloudflare.DurableObject<HospitalChannel>("CHANNELS", { className: "HospitalChannel" }),
    // Sona's follow-up after discharge: one check-in agent (Cloudflare Agents, SQLite-backed) per visit.
    CHECK_IN_AGENTS: Cloudflare.DurableObject<CheckInAgent>("CHECK_IN_AGENTS", { className: "CheckInAgent" }),
    // Sona Care's live voice: one voice agent (Cloudflare Agents, SQLite-backed: it keeps the conversation) per patient.
    VOICE: Cloudflare.DurableObject<SonaVoiceAgent>("VOICE", { className: "SonaVoiceAgent" }),
    UPLOADS: uploads,
    // Cloudflare Email Service. Sending needs a domain onboarded under Email Service > Email Sending;
    // until EMAIL_FROM and INSURER_EMAIL are set, the review link is only shown in the app.
    EMAIL: Cloudflare.Email.SendEmail("EMAIL"),
    EMAIL_FROM: Config.String("EMAIL_FROM").pipe(Config.withDefault("")),
    INSURER_EMAIL: Config.String("INSURER_EMAIL").pipe(Config.withDefault("")),
    // Sona Care sign-in with Apple and Google; each stays off until its values are set.
    APPLE_CLIENT_ID: Config.String("APPLE_CLIENT_ID").pipe(Config.withDefault("")),
    APPLE_CLIENT_SECRET: Config.Redacted("APPLE_CLIENT_SECRET").pipe(Config.withDefault(Redacted.make(""))),
    APPLE_APP_BUNDLE_IDENTIFIER: Config.String("APPLE_APP_BUNDLE_IDENTIFIER").pipe(Config.withDefault("")),
    GOOGLE_CLIENT_ID: Config.String("GOOGLE_CLIENT_ID").pipe(Config.withDefault("")),
    GOOGLE_CLIENT_SECRET: Config.Redacted("GOOGLE_CLIENT_SECRET").pipe(Config.withDefault(Redacted.make(""))),
    // "1" on staging for judges: the seeded synthetic demo phone signs in with a fixed code the app shows. Off by default.
    DEMO_SIGN_IN: Config.String("DEMO_SIGN_IN").pipe(Config.withDefault("")),
    // The hosted models (packages/infra/baseten). Empty keeps every model answer on the labelled fixtures.
    BASETEN_API_KEY: Config.Redacted("BASETEN_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
    // Workers AI: EmbeddingGemma embeds the library (packages/api/src/workers-models.ts).
    AI: Cloudflare.Workers.AI(),
  },
  // Nightly coding audit (flow 5), 02:00 Malaysia time; after-discharge check-ins (flow 7) go out hourly.
  crons: ["0 18 * * *", "0 * * * *"],
  dev: {
    port: 3000,
  },
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "sona-ai",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const serverWorker = yield* server;

    return {
      server: serverWorker.url,
    };
  }),
);
