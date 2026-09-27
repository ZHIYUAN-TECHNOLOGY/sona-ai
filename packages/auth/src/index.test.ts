import type { Database } from "@sona-ai/db";
import { user } from "@sona-ai/db/schema/auth";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createAuth } from "./index";

const config = { BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-chars", CORS_ORIGIN: "http://localhost:3001" };

test("a phone number signs in with its SMS code: a wrong code is refused, the right one creates the account and a session", async () => {
  const db = await createTestDb();
  const sent: { to: string; text: string }[] = [];
  const auth = createAuth(config, db as unknown as Database, [], async (to, text) => { sent.push({ to, text }); });
  const phoneNumber = "+60123456789";

  await auth.api.sendPhoneNumberOTP({ body: { phoneNumber } });
  const code = sent[0]?.text.match(/\d{6}/)?.[0];
  expect(sent[0]?.to).toBe(phoneNumber);
  expect(code).toBeDefined();

  const wrong = code === "000000" ? "111111" : "000000";
  expect(await auth.api.verifyPhoneNumber({ body: { phoneNumber, code: wrong } }).then(() => "accepted", () => "refused")).toBe("refused");

  const { headers, response } = await auth.api.verifyPhoneNumber({ body: { phoneNumber, code: code! }, returnHeaders: true });
  expect(response.token).toBeString();
  const cookie = headers.get("set-cookie")!.split(";")[0]!;
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  expect(session?.user.phoneNumber).toBe(phoneNumber);

  const [row] = await db.select().from(user).where(eq(user.phoneNumber, phoneNumber));
  expect(row).toMatchObject({ id: session!.user.id, phoneNumberVerified: true, email: "60123456789@phone.sona.invalid", name: phoneNumber });
});
