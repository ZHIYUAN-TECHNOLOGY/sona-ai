import { expect, test } from "bun:test";
import { timelineLabel } from "./timeline";

test("a recorded event says its time today, the day beside it for yesterday and tomorrow, and its date otherwise", () => {
  const now = new Date(2026, 9, 8, 9, 0), at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute);
  const time = d => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  expect(timelineLabel(at(8, 7, 5), now)).toBe(time(at(8, 7, 5)));
  expect(timelineLabel(at(8, 9, 15), now)).toBe(time(at(8, 9, 15)));
  // By the calendar day, not by hours elapsed: 23:50 last night is yesterday, ten hours ago or not.
  expect(timelineLabel(at(7, 23, 50), now)).toBe(`Yesterday ${time(at(7, 23, 50))}`);
  expect(timelineLabel(at(9, 6, 0), now)).toBe(`Tomorrow ${time(at(9, 6, 0))}`);
  expect(timelineLabel(at(5, 10, 0), now)).toBe(at(5, 10).toLocaleDateString([], { day: "numeric", month: "short" }));
  // The server's times arrive as dates or as text; both read the same.
  expect(timelineLabel(at(8, 7, 5).toISOString(), now)).toBe(time(at(8, 7, 5)));
});
