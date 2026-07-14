// Regression: Release-launch crash "Invalid environment variables" (Jul 2026).
// babel-preset-expo inlines ONLY static `process.env.EXPO_PUBLIC_*` member
// expressions into production bundles; passing the whole `process.env` object
// as t3-env's runtimeEnv ships an empty object to Hermes and kills the app at
// startup. This test transforms packages/env/src/native.ts exactly as Metro
// would for a Release build and asserts the value is inlined.
//   npx tsx lib/envInline.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const babel = require("@babel/core") as typeof import("@babel/core");

const envPath = resolve(__dirname, "../../../packages/env/src/native.ts");
process.env.EXPO_PUBLIC_SERVER_URL = "http://inline-test.local:3000";
process.env.NODE_ENV = "production";

const out = babel.transformSync(readFileSync(envPath, "utf8"), {
  filename: envPath,
  presets: ["babel-preset-expo"],
  caller: { name: "metro", platform: "ios", isDev: false, supportsStaticESM: false },
})?.code;

assert.ok(out, "babel transform produced no output");
assert.ok(
  out.includes("http://inline-test.local:3000"),
  "EXPO_PUBLIC_SERVER_URL was NOT inlined — runtimeEnv must use static process.env.EXPO_PUBLIC_* member access",
);
assert.ok(
  !/runtimeEnv:\s*process\.env\s*[,}]/.test(out),
  "runtimeEnv passes the whole process.env object — empty at runtime in Release",
);

console.log("ok - EXPO_PUBLIC_SERVER_URL inlined into production bundle");
