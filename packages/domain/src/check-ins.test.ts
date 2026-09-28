import { expect, test } from "bun:test";
import { checkInMessage, checkInSchedule, readReply, replyFlag } from "./check-ins";

test("check-ins go out on day 2 and day 7 after discharge, at 10:00 Malaysian time", () => {
  // Discharged Saturday 26 Sep at 15:40 (+08:00): Monday 28 Sep and Saturday 3 Oct.
  expect(checkInSchedule(new Date("2026-09-26T15:40:00+08:00")).map(c => [c.day, c.dueAt.toISOString()])).toEqual([
    [2, "2026-09-28T02:00:00.000Z"], [7, "2026-10-03T02:00:00.000Z"],
  ]);
  // 23:30 UTC on the 26th is already the 27th in Malaysia, so the days count from the 27th.
  expect(checkInSchedule(new Date("2026-09-26T23:30:00Z")).map(c => c.dueAt.toISOString())).toEqual(["2026-09-29T02:00:00.000Z", "2026-10-04T02:00:00.000Z"]);
});

test("the message greets the patient by first name in the leaflet's language and points emergencies to 999", () => {
  expect(checkInMessage("Amelia", "en")).toBe("Hi Amelia, this is Demo General Hospital checking in after your discharge. How are you feeling today? Reply here; for an emergency call 999.");
  expect(checkInMessage("Amelia", "ms")).toBe("Hai Amelia, ini Demo General Hospital bertanya khabar selepas anda keluar wad. Bagaimana keadaan anda hari ini? Balas di sini; jika kecemasan, hubungi 999.");
  expect(checkInMessage("Amelia", "zh")).toBe("Amelia您好，这里是Demo General Hospital，出院后回访。您今天感觉怎么样？请在此回复；如有紧急情况，请拨打999。");
});

test("a fine reply is logged quietly; worse and urgent replies are flagged by what the patient said, urgent above worse", () => {
  expect(replyFlag("Amelia", "fine", "Sudah sihat, terima kasih")).toBeUndefined();
  const worse = replyFlag("Amelia", "worse", "demam balik");
  const urgent = replyFlag("Amelia", "urgent", "Sakit dada sejak pagi");
  expect(worse).toMatchObject({ title: "Amelia: fever returned after discharge", label: "worse" });
  expect(urgent).toMatchObject({ title: "Amelia: chest pain after discharge", label: "urgent" });
  expect(urgent!.score).toBeGreaterThan(worse!.score);
  expect(replyFlag("Amelia", "worse", "sesak nafas")?.title).toBe("Amelia: breathing worse after discharge");
  expect(replyFlag("Amelia", "worse", "tidak berapa baik")?.title).toBe("Amelia: feeling worse after discharge");
});

test("Sona Care's quick answers read as the patient meant them, in each language", () => {
  expect(["Worse", "Lebih teruk", "更差"].map(readReply)).toEqual(["worse", "worse", "worse"]);
  expect(["Better", "About the same", "Lebih baik", "Sama", "好一些", "差不多"].map(readReply)).toEqual(["fine", "fine", "fine", "fine", "fine", "fine"]);
});

test("a Malay reply saying the chest hurts, in either word order, is urgent", () => {
  expect(replyFlag("Amelia", "urgent", "Dada saya sakit sejak pagi")).toMatchObject({ title: "Amelia: chest pain after discharge", label: "urgent" });
});
