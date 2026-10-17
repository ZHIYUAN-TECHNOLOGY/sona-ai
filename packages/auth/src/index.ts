import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import type { Database } from "@sona-ai/db";
import { DEMO_PATIENT_PHONE, DEMO_SIGN_IN_CODE } from "@sona-ai/db/demo";
import * as schema from "@sona-ai/db/schema/auth";
import { betterAuth } from "better-auth";
import { phoneNumber } from "better-auth/plugins";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  // Sona Care sign-in providers; each stays off until its values are set.
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  APPLE_APP_BUNDLE_IDENTIFIER?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** "1" on staging only: the seeded demo phone's code is the fixed demo code (see DEMO_PATIENT_PHONE). */
  DEMO_SIGN_IN?: string;
};

/** Sends one SMS. Without one, createAuth logs the code to the Worker log instead. */
export type SendSms = (to: string, text: string) => Promise<void>;
const OTP_SECONDS = 5 * 60;

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
  // ponytail: no SMS provider yet; a Twilio / Malaysian SMS gateway sender plugs in here.
  sendSms?: SendSms,
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      ...desktopOrigins,
      "sona-ai://",
      "sona-care://", // Sona Care, the patient app (apps/care)
      "exp://",
      "http://localhost:8081",
      "https://appleid.apple.com", // Sign in with Apple posts back from here
    ],
    // Three characters: the demo accounts (DEMO_ACCOUNTS in @sona-ai/db/seed) are synthetic and shown to audiences as `doctor / 123`.
    emailAndPassword: { enabled: true, minPasswordLength: 3 },
    socialProviders: {
      // A native iOS sign-in (expo-apple-authentication) sends an idToken whose audience is the app's bundle id.
      ...(env.APPLE_CLIENT_ID && {
        apple: {
          clientId: env.APPLE_CLIENT_ID,
          clientSecret: env.APPLE_CLIENT_SECRET || undefined,
          appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER || "ai.zhiyuantech.sona.care",
        },
      }),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && {
        google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      }),
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Every API call reads the session: a signed copy in a cookie answers it for 5 minutes without the database
    // (so a signed-out or revoked session can last up to that long; membership and role are still read on every call).
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [
      expo(),
      // Sona Care: sign in with a one-time SMS code; the first verified code creates the account.
      phoneNumber({
        otpLength: 6,
        expiresIn: OTP_SECONDS,
        allowedAttempts: 3,
        sendOTP: async ({ phoneNumber, code }, ctx) => {
          // The seeded synthetic demo number is never texted. With the demo switch on, its stored code is
          // replaced by the fixed demo code (same expiry and attempt limit); every other number is untouched.
          if (phoneNumber === DEMO_PATIENT_PHONE) {
            if (env.DEMO_SIGN_IN !== "1" || !ctx) return console.log(`[sona-care otp] ${phoneNumber} ${code}`);
            const adapter = ctx.context.internalAdapter;
            await adapter.deleteVerificationByIdentifier(phoneNumber);
            await adapter.createVerificationValue({ identifier: phoneNumber, value: `${DEMO_SIGN_IN_CODE}:0`, expiresAt: new Date(Date.now() + OTP_SECONDS * 1000) });
            return;
          }
          if (sendSms) return sendSms(phoneNumber, `Your Sona Care code is ${code}`);
          console.log(`[sona-care otp] ${phoneNumber} ${code}`);
        },
        signUpOnVerification: {
          getTempEmail: phone => `${phone.replace(/\D/g, "")}@phone.sona.invalid`,
          getTempName: phone => phone,
        },
      }),
    ],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
