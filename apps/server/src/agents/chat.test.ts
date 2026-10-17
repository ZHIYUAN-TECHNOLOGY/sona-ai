import { careLinks } from "@sona-ai/db/schema/clinical";
import { DEMO_HOSPITAL } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, mock, test } from "bun:test";
import { Hono } from "hono";

// Bun has no workerd: the SDK's classes and the Worker's database and sign-in stand in, so the route itself runs.
const db = await createTestDb();
await db.insert(careLinks).values({ userId: "u-amelia", hospitalId: DEMO_HOSPITAL, patientId: "SYN-1042" });
const reached: [unknown, string][] = [];
mock.module("agents", () => ({
  getAgentByName: async (namespace: unknown, name: string) => ({ fetch: async () => { reached.push([namespace, name]); return new Response(`agent ${name}`); } }),
}));
mock.module("@cloudflare/ai-chat", () => ({ AIChatAgent: class {} }));
mock.module("../services", () => ({
  getDb: () => db,
  // The session is whoever the test's cookie names.
  createAuth: async () => ({ api: { getSession: async ({ headers }: { headers: Headers }) => {
    const id = /session=([\w-]+)/.exec(headers.get("cookie") ?? "")?.[1];
    return id ? { user: { id } } : null;
  } } }),
}));
const { chatRoute } = await import("./chat");

const app = new Hono();
app.get("/agents/sona-chat-agent/:id", chatRoute);
app.get("/agents/sona-chat-agent/:id/get-messages", chatRoute);
const env = { CHAT: "CHAT namespace" };
const ask = (path: string, user?: string, socket = true) => app.request(path, {
  headers: { ...socket && { upgrade: "websocket" }, ...user && { cookie: `session=${user}` } },
}, env);

test("the chat agent is the signed-in patient's own: named from her care link, never from the path", async () => {
  const res = await ask("/agents/sona-chat-agent/u-amelia", "u-amelia");
  expect([res.status, await res.text()]).toEqual([200, "agent demo/SYN-1042"]);
  // Her stored conversation, which the app reads on opening, is behind the same check.
  expect(await (await ask("/agents/sona-chat-agent/u-amelia/get-messages", "u-amelia", false)).text()).toBe("agent demo/SYN-1042");
  expect(reached).toEqual([["CHAT namespace", "demo/SYN-1042"], ["CHAT namespace", "demo/SYN-1042"]]);
});

test("anyone else is refused before an agent is reached", async () => {
  reached.length = 0;
  const refused = async (path: string, user?: string, socket?: boolean) => { const res = await ask(path, user, socket); return [res.status, await res.text()]; };
  expect(await refused("/agents/sona-chat-agent/u-amelia")).toEqual([401, "Sign in first"]);
  expect(await refused("/agents/sona-chat-agent/u-amelia", "u-other")).toEqual([403, "This is another account's conversation"]);
  expect(await refused("/agents/sona-chat-agent/u-amelia/get-messages", "u-other", false)).toEqual([403, "This is another account's conversation"]);
  // Signed in, but not a Sona Care patient (a clinician, or before joining with the discharge code).
  expect(await refused("/agents/sona-chat-agent/u-staff", "u-staff")).toEqual([403, "Join with the code on your discharge paper first"]);
  expect(await refused("/agents/sona-chat-agent/u-amelia", "u-amelia", false)).toEqual([426, "Expected a WebSocket"]);
  expect(reached).toEqual([]);
});
