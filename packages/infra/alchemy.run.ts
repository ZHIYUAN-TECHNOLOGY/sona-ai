import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import "varlock/auto-load";

import type { CheckInAgent } from "../../apps/server/src/agents/check-in";
import type { SonaLiveAgent } from "../../apps/server/src/agents/live";
import type { SonaVoiceAgent } from "../../apps/server/src/agents/voice";
import type { WatchAgent } from "../../apps/server/src/agents/watch";
import type { EncounterState } from "../../apps/server/src/encounter-state";
import type { HospitalChannel } from "../../apps/server/src/hospital-channel";

/** Audio and X-ray uploads (presigned URLs from the Worker). */
export const uploads = Cloudflare.R2.Bucket("uploads");

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  // The web app (apps/web, built by the deploy script) on the same origin. Everything runs the Worker first
  // except the app's own paths, which the asset layer serves: a file if one matches, otherwise index.html.
  assets: {
    directory: "../../apps/web/dist",
    notFoundHandling: "single-page-application",
    runWorkerFirst: ["/*", "!/pro", "!/pro/*", "!/care", "!/care/*", "!/assets/*"],
  },
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
    // A clinician's own watches: one watch agent (Cloudflare Agents, SQLite-backed) per clinician.
    WATCH_AGENTS: Cloudflare.DurableObject<WatchAgent>("WATCH_AGENTS", { className: "WatchAgent" }),
    // Sona Care's live voice: one voice agent (Cloudflare Agents, SQLite-backed: it keeps the conversation) per patient.
    VOICE: Cloudflare.DurableObject<SonaVoiceAgent>("VOICE", { className: "SonaVoiceAgent" }),
    // The same call on MiniCPM-o (box ④): voiceRoute sends patients to it instead once SONA_LIVE_URL names the box's
    // WebSocket (wss://model-<id>.api.baseten.co/environments/production/websocket). Empty keeps today's call.
    LIVE: Cloudflare.DurableObject<SonaLiveAgent>("LIVE", { className: "SonaLiveAgent" }),
    SONA_LIVE_URL: Config.String("SONA_LIVE_URL").pipe(Config.withDefault("")),
    // Who writes her answers on that call: "own" (box ④ itself) or "gemma" (Gemma writes, box ④ only says it).
    SONA_LIVE_BRAIN: Config.String("SONA_LIVE_BRAIN").pipe(Config.withDefault("own")),
    SONA_LIVE_EAR: Config.String("SONA_LIVE_EAR").pipe(Config.withDefault("box2")),
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
    // The lab system's shared secret for POST /lab/results. Empty keeps that route closed.
    LAB_FEED_SECRET: Config.Redacted("LAB_FEED_SECRET").pipe(Config.withDefault(Redacted.make(""))),
    // The hosted models (packages/infra/baseten). Empty keeps every model answer on the labelled fixtures.
    BASETEN_API_KEY: Config.Redacted("BASETEN_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
    // Boxes moved to SageMaker in Malaysia (packages/infra/aws, packages/api/src/sagemaker.ts). Empty keeps them on Baseten.
    SAGEMAKER_ENDPOINTS: Config.String("SAGEMAKER_ENDPOINTS").pipe(Config.withDefault("")),
    SAGEMAKER_REGION: Config.String("SAGEMAKER_REGION").pipe(Config.withDefault("ap-southeast-5")),
    AWS_ACCESS_KEY_ID: Config.String("AWS_ACCESS_KEY_ID").pipe(Config.withDefault("")),
    AWS_SECRET_ACCESS_KEY: Config.Redacted("AWS_SECRET_ACCESS_KEY").pipe(Config.withDefault(Redacted.make(""))),
    AWS_SESSION_TOKEN: Config.Redacted("AWS_SESSION_TOKEN").pipe(Config.withDefault(Redacted.make(""))),
    // Workers AI: EmbeddingGemma embeds the library (packages/api/src/workers-models.ts).
    AI: Cloudflare.Workers.AI(),
  },
  // Nightly coding audit (flow 5), 02:00 Malaysia time; after-discharge check-ins (flow 7) go out hourly.
  crons: ["0 18 * * *", "0 * * * *"],
  dev: {
    // SONA_DEV_PORT moves a second local server (a worktree, the e2e suite) off the main checkout's 3000.
    port: Number(process.env.SONA_DEV_PORT) || 3000,
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
