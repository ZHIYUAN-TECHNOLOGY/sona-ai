/**
 * The demo's lab system: sends one result to a Sona server from outside the apps, the way a hospital's lab would
 * (POST /lab/results, packages/api/src/routers/day.ts labFeed). Sona Pro's critical banner appears as it lands.
 *
 * SYNTHETIC: the default is a made-up potassium of 2.6 mmol/L (past the call-now limit of 3.0) for Daniel Rahman
 * (SYN-1086), a fictional patient of the fictional demo hospital. Never send a real person's result.
 *
 * The secret is the server's LAB_FEED_SECRET (apps/server/.env.schema); it is read from the environment, never an argument:
 *
 *   LAB_FEED_SECRET=... bun tools/lab-feed/send.ts https://<the server>
 *   LAB_FEED_SECRET=... bun tools/lab-feed/send.ts http://localhost:3000 SYN-1042 Sodium 138 mmol/L
 *   LAB_FEED_SECRET=... bun tools/lab-feed/send.ts http://localhost:3000 SYN-2002 "Urine culture sensitivities" "No growth"
 */
const [server, patientId = "SYN-1086", test, value, unit] = process.argv.slice(2);
// The potassium's unit belongs to the default result only: a named test with no unit (a culture's text), or with "" for one, has none.
const result = test ? { test, value, unit: unit || undefined } : { test: "Potassium", value: "2.6", unit: "mmol/L" };
const secret = process.env.LAB_FEED_SECRET;
if (!server || !secret) {
  console.error("Usage: LAB_FEED_SECRET=... bun tools/lab-feed/send.ts <server URL> [patientId [test value [unit]]]");
  process.exit(2);
}

const res = await fetch(new URL("/lab/results", server), {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
  body: JSON.stringify({ patientId, ...result }),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
