import { expect, test } from "bun:test";
import { decideFollowUp, type FollowUp } from "./check-in-agent";
import { checkInSchedule, type CheckIn, type Reply } from "./check-ins";

// Amelia, discharged Saturday 26 Sep at 15:40 in Kuala Lumpur: check-ins on day 2 (Mon 28 Sep) and day 7 (Sat 3 Oct), 10:00.
const out = new Date("2026-09-26T15:40:00+08:00");
const visit = { hospitalId: "demo", encounterId: "visit-1042", patientId: "SYN-1042", dischargedAt: out };
const kl = (local: string) => new Date(`${local}+08:00`);
const DAY2 = kl("2026-09-28T10:00:00"), DAY2_SENT = kl("2026-09-28T10:01:00");

function rows(days: number[] = [2, 7], over: Record<number, Partial<CheckIn>> = {}): CheckIn[] {
  return checkInSchedule(out, days).map(({ day, dueAt }) => ({
    id: `check-in:visit-1042:${day}`, patientId: "SYN-1042", encounterId: "visit-1042", day, language: "ms", message: "Hai Amelia…", dueAt, sentAt: null, replies: [], ...over[day],
  }));
}
const reply = (id: string, label: Reply["label"], text: string, at: Date, flagged?: string): Reply =>
  ({ id, text, label, source: "fixture", receivedAt: at, task: flagged ? { id, title: `Amelia: ${flagged} after discharge`, completed: false } : null });
/** The day-2 check-in sent at 10:01, with these replies. */
const sentDay2 = (...replies: Reply[]) => rows([2, 7], { 2: { sentAt: DAY2_SENT, replies } });
const texts = (f: FollowUp) => f.timeline.map(e => e.text);

test("at discharge the agent says what it will follow and sleeps until the day-2 check-in", () => {
  const d = decideFollowUp(undefined, visit, rows(), out);
  expect(d.followUp.timeline).toEqual([{ at: out.toISOString(), text: "Following up: check-ins on day 2 and day 7", tone: "neutral" }]);
  expect(d.followUp.next).toEqual({ at: DAY2.toISOString(), text: "Day-2 check-in" });
  expect(d.wakeAt).toEqual(DAY2);
  expect([d.reask, d.bringForward, d.call999]).toEqual([undefined, undefined, []]);
});

test("a sent check-in is logged once and asked again once, after 2 h without a reply", () => {
  const start = decideFollowUp(undefined, visit, rows(), out).followUp;
  const sent = decideFollowUp(start, visit, sentDay2(), DAY2_SENT);
  expect(texts(sent.followUp)).toEqual(["Following up: check-ins on day 2 and day 7", "Sent day-2 check-in"]);
  expect(sent.followUp.next).toEqual({ at: kl("2026-09-28T12:01:00").toISOString(), text: "Ask again if no reply" });

  expect(decideFollowUp(sent.followUp, visit, sentDay2(), kl("2026-09-28T12:00:00")).reask).toBeUndefined();
  const asked = decideFollowUp(sent.followUp, visit, sentDay2(), kl("2026-09-28T12:01:00"));
  expect(asked.reask).toEqual({ checkInId: "check-in:visit-1042:2", day: 2 });
  expect(asked.followUp.timeline.at(-1)).toEqual({ at: kl("2026-09-28T12:01:00").toISOString(), text: "No reply after 2 h; asked again", tone: "neutral" });
  expect(asked.followUp.next?.text).toBe("Day-7 check-in");
  // Asking again is a push: without a phone the timeline says so (and it is not tried again).
  const noPhone = decideFollowUp(sent.followUp, visit, sentDay2(), kl("2026-09-28T12:01:00"), false);
  expect([noPhone.followUp.timeline.at(-1)?.text, noPhone.followUp.schedule[0]?.reaskedAt]).toEqual(["No reply after 2 h; no phone registered to ask again", kl("2026-09-28T12:01:00").toISOString()]);

  // Never twice, and nothing is logged again.
  const later = decideFollowUp(asked.followUp, visit, sentDay2(), kl("2026-09-28T15:00:00"));
  expect(later.reask).toBeUndefined();
  expect(later.followUp.timeline).toEqual(asked.followUp.timeline);
});

test("only the latest check-in is asked again, and a silence older than a day is left to the next check-in", () => {
  const start = decideFollowUp(undefined, visit, sentDay2(), DAY2_SENT).followUp;
  // A demo jump to day 7: both are sent, day 2 still unanswered; day 7 was just sent, so no one is asked again yet.
  const day7 = kl("2026-10-03T10:01:00");
  const both = decideFollowUp(start, visit, rows([2, 7], { 2: { sentAt: DAY2_SENT }, 7: { sentAt: day7 } }), day7);
  expect(both.reask).toBeUndefined();
  expect(both.followUp.next).toEqual({ at: kl("2026-10-03T12:01:00").toISOString(), text: "Ask again if no reply" });
  // 25 hours of silence: too late to ask again; the agent waits for day 7.
  const quiet = decideFollowUp(start, visit, sentDay2(), kl("2026-09-29T11:01:00"));
  expect(quiet.reask).toBeUndefined();
  expect(quiet.followUp.next?.text).toBe("Day-7 check-in");
});

test("a fine reply keeps the plan; worse brings tomorrow's check-in in; urgent tells her to call 999", () => {
  const start = decideFollowUp(undefined, visit, sentDay2(), DAY2_SENT).followUp;
  const replied = kl("2026-09-28T10:30:00");

  const fine = decideFollowUp(start, visit, sentDay2(reply("r1", "fine", "Sudah sihat", replied)), replied);
  expect(fine.followUp.timeline.at(-1)).toEqual({ at: replied.toISOString(), text: "Reply read as fine; next check-in on day 7", tone: "green" });
  expect([fine.bringForward, fine.call999, fine.followUp.next?.text]).toEqual([undefined, [], "Day-7 check-in"]);

  const worse = decideFollowUp(start, visit, sentDay2(reply("r2", "worse", "demam balik", replied, "fever returned")), replied);
  expect(worse.followUp.timeline.at(-1)).toEqual({ at: replied.toISOString(), text: "Reply read as worse: fever returned; task for the care team; next check-in tomorrow", tone: "amber" });
  expect(worse.bringForward).toEqual({ day: 3, dueAt: kl("2026-09-29T10:00:00") });
  expect(worse.followUp.next).toEqual({ at: kl("2026-09-29T10:00:00").toISOString(), text: "Day-3 check-in" });
  expect(worse.wakeAt).toEqual(kl("2026-09-29T10:00:00"));
  // Tomorrow already planned: nothing to add.
  const planned = decideFollowUp(start, visit, rows([2, 3, 7], { 2: { sentAt: DAY2_SENT, replies: [reply("r3", "worse", "demam balik", replied, "fever returned")] } }), replied);
  expect([planned.bringForward, planned.followUp.timeline.at(-1)?.text]).toEqual([undefined, "Reply read as worse: fever returned; task for the care team; next check-in tomorrow"]);

  const urgent = decideFollowUp(start, visit, sentDay2(reply("r4", "urgent", "sakit dada", replied, "chest pain")), replied);
  expect(urgent.call999).toEqual([{ replyId: "r4", language: "ms" }]);
  expect(urgent.followUp.timeline.at(-1)).toEqual({ at: replied.toISOString(), text: "Reply read as urgent: chest pain; told to call 999 now; urgent task for the care team", tone: "red" });

  // Each reply is read and acted on once.
  const again = decideFollowUp(urgent.followUp, visit, sentDay2(reply("r4", "urgent", "sakit dada", replied, "chest pain")), kl("2026-09-28T11:00:00"));
  expect([again.call999, again.followUp.timeline]).toEqual([[], urgent.followUp.timeline]);
});

test("a reply older than a day is history (logged, not acted on); a new discharge starts a new follow-up", () => {
  const replied = kl("2026-09-28T10:30:00");
  // An agent that first wakes two days later (an existing visit) does not send a 999 message about it now.
  const late = decideFollowUp(undefined, visit, sentDay2(reply("r1", "urgent", "sakit dada", replied, "chest pain")), kl("2026-09-30T10:30:00"));
  expect(late.call999).toEqual([]);
  expect(texts(late.followUp)).toEqual(["Following up: check-ins on day 2 and day 7", "Sent day-2 check-in", "Reply read as urgent: chest pain; urgent task for the care team"]);

  const rerun = { ...visit, dischargedAt: kl("2026-10-01T09:00:00") };
  const fresh = decideFollowUp(late.followUp, rerun, checkInSchedule(rerun.dischargedAt).map(({ day, dueAt }) => ({ ...rows()[0]!, id: `check-in:visit-1042:${day}`, day, dueAt })), kl("2026-10-01T09:00:00"));
  expect(texts(fresh.followUp)).toEqual(["Following up: check-ins on day 2 and day 7"]);
  expect(fresh.followUp.schedule.every(s => !s.sentAt && !s.replies.length)).toBe(true);
});
