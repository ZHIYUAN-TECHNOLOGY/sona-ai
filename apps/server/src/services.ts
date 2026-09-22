import { createAuth as createConfiguredAuth } from "@sona-ai/auth";
import { type Database, createDb } from "@sona-ai/db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? (await getDb()));
}
