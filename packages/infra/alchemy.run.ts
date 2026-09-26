import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

import type { EncounterState } from "../../apps/server/src/encounter-state";

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
    UPLOADS: uploads,
    // Cloudflare Email Service. Sending needs a domain onboarded under Email Service > Email Sending;
    // until EMAIL_FROM and INSURER_EMAIL are set, the review link is only shown in the app.
    EMAIL: Cloudflare.Email.SendEmail("EMAIL"),
    EMAIL_FROM: Config.String("EMAIL_FROM").pipe(Config.withDefault("")),
    INSURER_EMAIL: Config.String("INSURER_EMAIL").pipe(Config.withDefault("")),
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
