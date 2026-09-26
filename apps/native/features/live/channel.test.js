import { expect, test } from "bun:test";
import { rereads } from "./channel-routing";

test("a change re-reads only what it touches", () => {
  expect(rereads({ topic: "results" })).toEqual(["day"]);
  expect(rereads({ topic: "claim", encounterId: "visit-1042" })).toEqual(["visit", "ward"]);
  expect(rereads({ topic: "discharge", encounterId: "visit-1042" })).toEqual(["visit", "ward", "day", "checkIns"]);
  expect(rereads({ topic: "checkIns", encounterId: "visit-1042" })).toEqual(["day", "checkIns"]);
  expect(rereads({ topic: "findings" })).toEqual(["ward", "day", "findings"]);
  expect(rereads({ topic: "handover" })).toEqual(["handover"]);
  // A Sona Care message (or the care team's reply) re-reads My Day and the patient's thread.
  expect(rereads({ topic: "messages" })).toEqual(["day", "messages"]);
});

test("after a reconnect everything is re-read, since changes may have been missed", () => {
  expect(rereads("resync")).toEqual(["visit", "ward", "day", "checkIns", "findings", "handover", "messages"]);
});
