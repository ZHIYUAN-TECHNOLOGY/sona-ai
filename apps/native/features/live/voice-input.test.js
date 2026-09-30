import { expect, test } from "bun:test";
import { turnEnd } from "./turn";

test("a tap's turn ends on a pause after speaking, gives up on silence, and stops at the cap", () => {
  expect(turnEnd({ spoke: true, quietFor: 1400, elapsed: 4000 })).toBe("send");
  expect(turnEnd({ spoke: true, quietFor: 600, elapsed: 4000 })).toBeUndefined();
  expect(turnEnd({ spoke: false, quietFor: 0, elapsed: 7100 })).toBe("drop");
  expect(turnEnd({ spoke: false, quietFor: 0, elapsed: 3000 })).toBeUndefined();
  expect(turnEnd({ spoke: true, quietFor: 0, elapsed: 30_100 })).toBe("send");
});
