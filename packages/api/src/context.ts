import type { Session } from "@sona-ai/auth";
import type { Database } from "@sona-ai/db";

export type Context = {
  session: Session | null;
  db: Database;
};
