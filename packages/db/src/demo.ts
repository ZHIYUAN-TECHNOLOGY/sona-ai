/** The synthetic demo hospital. Its own module so the Worker never loads the seed. */
export const DEMO_HOSPITAL = "demo";

/**
 * The only accounts that become demo clinicians on first sign-in (the seeded test doctor). Anyone
 * else must already be a hospital member; a Sona Care patient or a stray sign-up never is.
 * ponytail: a fixed list while the demo has one clinician; an admin invite step replaces it.
 */
export const DEMO_CLINICIANS = ["dr.test@sona.test"];
