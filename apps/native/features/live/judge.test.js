import { expect, test } from "bun:test";
import { gateOf, wantsLive } from "./judge";

test("outside the judge build nothing changes: the Settings switch decides, and the gate is always open", () => {
  expect([wantsLive(false, false), wantsLive(false, true)]).toEqual([false, true]);
  for (const settled of [false, true]) for (const signedIn of [false, true]) for (const read of [false, true]) for (const failed of [false, true])
    expect(gateOf({ judge: false, settled, signedIn, read, failed })).toBe("open");
});

test("the judge build is always connected, whatever the remembered switch says", () => {
  expect([wantsLive(true, false), wantsLive(true, true)]).toEqual([true, true]);
});

test("the judge build's gate opens only once someone is signed in and the hospital record has been read", () => {
  const gate = state => gateOf({ judge: true, settled: true, signedIn: true, read: false, failed: false, ...state });
  // The saved sign-in is still being checked: wait, rather than flash the form or the app.
  expect(gate({ settled: false, signedIn: false })).toBe("wait");
  expect(gate({ settled: false, read: true })).toBe("wait");
  // Signed out: ask to sign in, even if an earlier account's record is still held.
  expect(gate({ signedIn: false })).toBe("sign-in");
  expect(gate({ signedIn: false, read: true })).toBe("sign-in");
  expect(gate({})).toBe("reading");
  // The server refused or did not answer: its reason, never a sample.
  expect(gate({ failed: true })).toBe("failed");
  expect(gate({ read: true })).toBe("open");
  // A later re-read that fails leaves the record already read on screen.
  expect(gate({ read: true, failed: true })).toBe("open");
});
