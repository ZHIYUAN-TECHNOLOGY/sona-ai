import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "EXPO_PUBLIC_",
  client: {
    // Default keeps a Release launch alive when no server URL is configured —
    // the app is fully on-device; the cloud path is optional.
    EXPO_PUBLIC_SERVER_URL: z.url().default("http://localhost:3000"),
  },
  // Must be static member accesses: babel-preset-expo only inlines
  // `process.env.EXPO_PUBLIC_*` expressions into release bundles. Passing the
  // whole `process.env` object leaves it empty at runtime and crashes launch.
  runtimeEnv: {
    EXPO_PUBLIC_SERVER_URL: process.env.EXPO_PUBLIC_SERVER_URL,
  },
  emptyStringAsUndefined: true,
});
