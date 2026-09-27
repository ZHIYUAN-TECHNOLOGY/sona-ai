import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import type { Database } from "@sona-ai/db";
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
};

/** Sends one SMS. Without one, createAuth logs the code to the Worker log instead. */
export type SendSms = (to: string, text: string) => Promise<void>;

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
    emailAndPassword: { enabled: true },
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
        expiresIn: 5 * 60,
        allowedAttempts: 3,
        sendOTP: async ({ phoneNumber, code }) => {
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
