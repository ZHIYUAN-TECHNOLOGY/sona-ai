/** The synthetic demo hospital. Its own module so the Worker never loads the seed. */
export const DEMO_HOSPITAL = "demo";

/**
 * The only accounts that become demo clinicians on first sign-in (the seeded test accounts, see
 * TEST_DOCTOR and the others in seed.ts), each with its role. Anyone else must already be a hospital
 * member; a Sona Care patient or a stray sign-up never is.
 * ponytail: a fixed map for the demo; an admin invite step replaces it.
 */
export const DEMO_CLINICIANS: Record<string, "doctor" | "nurse" | "bed-manager" | "management"> = {
  "doctor@sona.test": "doctor",
  "nurse@sona.test": "nurse",
  "beds@sona.test": "bed-manager",
  "manager@sona.test": "management",
};

/**
 * The seeded Sona Care demo patient's phone (TEST_PATIENT, Amelia): synthetic, never sent an SMS. With
 * DEMO_SIGN_IN=1 (staging only) its sign-in code is always DEMO_SIGN_IN_CODE, and the sign-in screen
 * shows both, so judges can sign in without a phone. No other number is ever affected.
 */
export const DEMO_PATIENT_PHONE = "+601100000000";
export const DEMO_SIGN_IN_CODE = "123456";
