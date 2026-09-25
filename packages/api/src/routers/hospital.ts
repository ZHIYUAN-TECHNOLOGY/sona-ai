import { DEMO_HOSPITAL } from "@sona-ai/db/seed";

// ponytail: every signed-in user belongs to the demo hospital; read it from a membership row once there is more than one.
export const hospitalOf = (_session: unknown) => DEMO_HOSPITAL;
