import type { Database } from "@sona-ai/db";
import { user } from "@sona-ai/db/schema/auth";
import { DEMO_SIGN_IN_CODE } from "@sona-ai/db/demo";
import { seedDemo, seedTestPatient, TEST_PATIENT } from "@sona-ai/db/seed";
import { createTestDb } from "@sona-ai/db/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createAuth } from "./index";

const config = { BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-chars", CORS_ORIGIN: "http://localhost:3001" };

test("the seeded test patient signs in by email, and by the demo phone with the fixed demo code only while DEMO_SIGN_IN is on", async () => {
  const db = await createTestDb();
  await seedDemo(db);
  const id = await seedTestPatient(db);
  const sent: string[] = [];
  const sms = async (to: string) => { sent.push(to); };
  const off = createAuth(config, db as unknown as Database, [], sms), on = createAuth({ ...config, DEMO_SIGN_IN: "1" }, db as unknown as Database, [], sms);
  const phoneNumber = TEST_PATIENT.phone;
  const tryCode = (auth: typeof on, phone: string) => auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code: DEMO_SIGN_IN_CODE } }).then(r => r.user.id, () => "refused");

  expect((await off.api.signInEmail({ body: { email: TEST_PATIENT.email, password: TEST_PATIENT.password } })).user.id).toBe(id);
  // Switched off: the demo number gets a random code, never an SMS, and the demo code does not work.
  await off.api.sendPhoneNumberOTP({ body: { phoneNumber } });
  expect(await tryCode(off, phoneNumber)).toBe("refused");
  // Switched on: the fixed code signs in to the seeded account, already linked to Amelia.
  await on.api.sendPhoneNumberOTP({ body: { phoneNumber } });
  expect(await tryCode(on, phoneNumber)).toBe(id);
  // Any other number is untouched by the switch: it is texted its own code, and the demo code is refused.
  await on.api.sendPhoneNumberOTP({ body: { phoneNumber: "+60123456789" } });
  expect(await tryCode(on, "+60123456789")).toBe("refused");
  expect(sent).toEqual(["+60123456789"]);
});

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
