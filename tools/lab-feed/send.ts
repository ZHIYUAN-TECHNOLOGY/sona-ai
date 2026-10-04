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
 */
const [server, patientId = "SYN-1086", test = "Potassium", value = "2.6", unit = "mmol/L"] = process.argv.slice(2);
const secret = process.env.LAB_FEED_SECRET;
if (!server || !secret) {
  console.error("Usage: LAB_FEED_SECRET=... bun tools/lab-feed/send.ts <server URL> [patientId test value unit]");
  process.exit(2);
}

const res = await fetch(new URL("/lab/results", server), {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
  body: JSON.stringify({ patientId, test, value, unit }),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
