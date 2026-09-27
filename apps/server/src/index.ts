import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { appRouter } from "@sona-ai/api/routers/index";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { announcer, createContext } from "./context";
import { ENV } from "./env.server";
import { createAuth, getDb } from "./services";
import { runNightlyAudit } from "@sona-ai/api/audit-job";
import { decideReview, renderReviewPage, reviewPacket } from "@sona-ai/api/insurer";
import { sendDueCheckIns } from "@sona-ai/api/routers/check-ins";
import { hospitals } from "@sona-ai/db/schema/clinical";
import { hospitalOf } from "@sona-ai/api/routers/hospital";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => (await createAuth()).handler(c.req.raw));

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

// The insurer's review page (claims sent for a final guarantee letter): the unguessable link is the credential.
app.get("/insurer/:token", async (c) => {
  const packet = await reviewPacket(await getDb(), c.req.param("token"), new Date());
  if (!packet) return c.text("This review link is not valid.", 404);
  return c.html(renderReviewPage(packet), 200, { "cache-control": "no-store", "referrer-policy": "no-referrer" });
});
app.post("/insurer/:token", async (c) => {
  const db = await getDb(), token = c.req.param("token");
  const form = await c.req.parseBody();
  const decision = form.decision === "query" ? "query" : "approve";
  const result = await decideReview(db, token, decision, typeof form.note === "string" ? form.note : "", new Date());
  if (result.ok) {
    await announcer(c.env as Env)?.(result.hospitalId, { topic: "claim", encounterId: result.encounterId }).catch(() => {});
    return c.redirect(`/insurer/${token}`, 303);
  }
  const packet = await reviewPacket(db, token, new Date());
  if (!packet) return c.text("This review link is not valid.", 404);
  return c.html(renderReviewPage(packet, result.reason), 400, { "cache-control": "no-store" });
});

// Live updates: a signed-in app opens one WebSocket here and joins its hospital's channel.
app.get("/live", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.text("Expected a WebSocket", 426);
  const db = await getDb();
  const session = await (await createAuth(db)).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.text("Sign in first", 401);
  // A Sona Care (patient) account has no clinician channel; hospitalOf refuses it.
  const hospitalId = await hospitalOf(db, session.user).catch(() => undefined);
  if (!hospitalId) return c.text("Not a clinician account", 403);
  const env = c.env as Env;
  return env.CHANNELS.get(env.CHANNELS.idFromName(hospitalId)).fetch(c.req.raw);
});

app.get("/", (c) => {
  return c.text("OK");
});

export { EncounterState } from "./encounter-state";
export { HospitalChannel } from "./hospital-channel";

/** Matches the hourly cron in packages/infra/alchemy.run.ts. */
const CHECK_IN_CRON = "0 * * * *";

export default {
  fetch: app.fetch,
  // ponytail: the nightly coding audit (flow 5) plugs in here; until then the cron only logs that it fired.
  /** For every hospital: the hourly check-in send (flow 7), else the nightly coding audit (see packages/api/src/audit-job.ts). */
  async scheduled(controller) {
    const db = await getDb();
    const at = new Date(controller.scheduledTime);
    for (const { id } of await db.select({ id: hospitals.id }).from(hospitals)) {
      if (controller.cron === CHECK_IN_CRON) {
        const { sent } = await sendDueCheckIns(db, id, at);
        console.log(`check-ins ${controller.cron}: ${id} sent ${sent}`);
        continue;
      }
      const { raised } = await runNightlyAudit(db, id, at);
      console.log(`coding audit ${controller.cron}: ${id} raised ${raised}`);
    }
  },
} satisfies ExportedHandler<Env>;
