/** The synthetic demo hospital. Its own module so the Worker never loads the seed. */
export const DEMO_HOSPITAL = "demo";

/**
 * The only accounts that become demo clinicians on first sign-in (the seeded test accounts, see
 * TEST_DOCTOR and the others in seed.ts), each with its role. Anyone else must already be a hospital
 * member; a Sona Care patient or a stray sign-up never is.
 * ponytail: a fixed map for the demo; an admin invite step replaces it.
 */
export const DEMO_CLINICIANS: Record<string, "doctor" | "nurse" | "bed-manager" | "management"> = {
  "dr.test@sona.test": "doctor",
  "nurse.test@sona.test": "nurse",
  "beds.test@sona.test": "bed-manager",
  "manager.test@sona.test": "management",
};
