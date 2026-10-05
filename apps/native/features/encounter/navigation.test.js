import { expect, mock, test } from "bun:test";

// The navigation calls, in the order they were made.
const calls = [];
mock.module("expo-router", () => ({ router: { push: to => calls.push(["push", to]), replace: to => calls.push(["replace", to]), dismiss: n => calls.push(["back", n]) }, useFocusEffect: () => {}, useNavigation: () => ({}) }));
const { backTo, openPage, openSession, openSessionFromSheet, openVisitFromCard, underVisit } = await import("./navigation");
const sheet = { goBack: () => calls.push(["close sheet"]) };

test("a sheet's pick closes it and opens the visit in the same moment, placed under the sheet without its own slide", () => {
  calls.length = 0;
  openSessionFromSheet(sheet, "SYN-1086");
  expect(calls).toEqual([["close sheet"], ["push", { pathname: "/session/[patientId]", params: { patientId: "SYN-1086", quiet: "1" } }]]);
});

test("a patient card opens the visit over itself; switching leaves the pages over the open visit and replaces it", () => {
  const on = (...routes) => ({ getState: () => ({ routes: routes.map(name => ({ name })) }) });
  calls.length = 0;
  openVisitFromCard(on("index", "patients/index", "patients/[id]"), "SYN-1086", { view: "recording" });
  expect(calls).toEqual([["push", { pathname: "/session/[patientId]", params: { patientId: "SYN-1086", view: "recording" } }]]);
  calls.length = 0;
  openVisitFromCard(on("index", "session/[patientId]", "patients/index", "patients/[id]"), "SYN-1086", { next: "briefing" }, true);
  expect(calls.map(c => c[0])).toEqual(["back", "replace"]);
  expect(calls[0][1]).toBe(2);
});

test("a visit opened anywhere else slides in as usual", () => {
  calls.length = 0;
  openSession("SYN-1086", { next: "briefing" });
  expect(calls).toEqual([["push", { pathname: "/session/[patientId]", params: { patientId: "SYN-1086", next: "briefing" } }]]);
});

test("only a screen with a visit pushed over it may rest; the visit under the recorder and Today under sheets keep rendering", () => {
  const stack = (...names) => names.map((name, i) => ({ key: `${name}-${i}`, name }));
  const recording = stack("index", "session/[patientId]", "recording");
  expect(underVisit(recording, "index-0")).toBe(true);
  expect(underVisit(recording, "session/[patientId]-1")).toBe(false);
  expect(underVisit(stack("index", "patients/index", "source"), "index-0")).toBe(false);
  expect(underVisit(stack("index", "session/[patientId]", "session/[patientId]", "note"), "session/[patientId]-1")).toBe(true);
});

test("the note's Open consultation returns to the consultation under it, and opens one only when none is open", () => {
  const on = (...routes) => ({ getState: () => ({ routes: routes.map(r => typeof r === "string" ? { name: r } : r) }) });
  calls.length = 0;
  openPage(on("index", "session/[patientId]", "recording", "note"), "/recording");
  openPage(on("index", "session/[patientId]", "discharge", "claim", "note"), "/recording");
  openPage(on("index", "session/[patientId]", "note", "recording"), "/recording");
  expect(calls).toEqual([["back", 1], ["push", "/recording"], ["push", "/recording"]]);
  calls.length = 0;
  const visits = on("index", { name: "session/[patientId]", params: { patientId: "A" } }, "inbox/index", "inbox/[patientId]");
  expect([backTo(visits, "session/[patientId]", "B"), backTo(visits, "session/[patientId]", "A")]).toEqual([false, true]);
  expect(calls).toEqual([["back", 2]]);
});
