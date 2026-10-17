import { beforeEach, expect, test } from "bun:test";
import { contentTypeOf, readingOf, resetUploads, scanOf, sendXray, uploadOf } from "./upload";

beforeEach(resetUploads);

/** A fake server: every upload gets the next key, and `sent` lists what was stored, in order. */
function server({ fail = false } = {}) {
  const sent = [], stored = [];
  let n = 0;
  return { sent, stored, deps: {
    read: async uri => (uri.includes("unreadable") ? Promise.reject(new Error("gone")) : `bytes-of-${uri}`),
    upload: async input => { if (fail) throw new Error("offline"); sent.push(input); return { key: `key-${++n}` }; },
    errorText: e => e.message, stored: (encounterId, key) => stored.push(`${encounterId}:${key}`),
  } };
}

test("an image attached by URI alone (the visit's dock) is read from its file and stored, and its findings are detected once", async () => {
  const { sent, stored, deps } = server();
  const sending = sendXray("visit-1", { uri: "file:///a.png" }, deps);
  expect(uploadOf("visit-1", "file:///a.png")).toEqual({ uri: "file:///a.png", state: "uploading" });
  expect(await sending).toEqual({ uri: "file:///a.png", state: "uploaded", key: "key-1" });
  expect(sent).toEqual([{ encounterId: "visit-1", contentType: "image/png", dataBase64: "bytes-of-file:///a.png" }]);
  expect(stored).toEqual(["visit-1:key-1"]);
  // The picker's own bytes and type are used when it gave them.
  await sendXray("visit-2", { uri: "file:///b.jpg", base64: "abc", mimeType: "image/webp" }, deps);
  expect(sent[1]).toEqual({ encounterId: "visit-2", contentType: "image/webp", dataBase64: "abc" });
  expect(contentTypeOf({ uri: "file:///shot" })).toBe("image/jpeg");
});

test("the same image attached twice is stored once, while in flight and after", async () => {
  const { sent, deps } = server();
  const first = sendXray("visit-1", { uri: "file:///a.jpg" }, deps), again = sendXray("visit-1", { uri: "file:///a.jpg" }, deps);
  expect(await again).toEqual(await first);
  await sendXray("visit-1", { uri: "file:///a.jpg" }, deps);
  expect(sent.length).toBe(1);
});

test("an image another has since replaced is stored again, so it is the server's latest once more; sends keep their order", async () => {
  const { sent, deps } = server();
  void sendXray("visit-1", { uri: "file:///a.jpg" }, deps);
  void sendXray("visit-1", { uri: "file:///b.jpg" }, deps);
  const back = await sendXray("visit-1", { uri: "file:///a.jpg" }, deps);
  expect(sent.map(s => s.dataBase64)).toEqual(["bytes-of-file:///a.jpg", "bytes-of-file:///b.jpg", "bytes-of-file:///a.jpg"]);
  expect(back.key).toBe("key-3");
  expect(uploadOf("visit-1", "file:///b.jpg")?.key).toBe("key-2");
});

test("a failed upload says why, and attaching again retries it", async () => {
  const down = server({ fail: true });
  expect(await sendXray("visit-1", { uri: "file:///a.jpg" }, down.deps)).toEqual({ uri: "file:///a.jpg", state: "failed", error: "offline" });
  expect(down.stored).toEqual([]);
  expect((await sendXray("visit-1", { uri: "file:///unreadable.jpg" }, down.deps)).error).toBe("The image could not be read for upload");
  const up = server();
  expect((await sendXray("visit-1", { uri: "file:///a.jpg" }, up.deps)).state).toBe("uploaded");
});

test("a card shows only its own image's reading: it waits for the upload, says a failure, and drops any other image's", () => {
  const mine = { live: true, loading: false, data: { key: "key-1", source: "model", findings: ["Clear lungs"] } };
  const asking = { live: true, loading: false };
  // Never sent (demo mode, a refused role, a previous session): nothing was read.
  expect(readingOf(undefined, mine)).toBeUndefined();
  expect(readingOf({ uri: "a", state: "uploaded", key: "key-1" }, { ...mine, live: false })).toBeUndefined();
  expect(readingOf({ uri: "a", state: "uploading" }, asking)).toEqual({ live: true, loading: true, saving: true });
  const failed = readingOf({ uri: "a", state: "failed", error: "offline" }, mine);
  expect(failed).toEqual({ live: true, loading: false, failed: true, error: "the upload failed (offline)" });
  expect(readingOf({ uri: "a", state: "uploaded", key: "key-1" }, mine)).toBe(mine);
  // The server read the visit's latest image, and that is not this card's.
  const other = readingOf({ uri: "a", state: "uploaded", key: "key-0" }, mine);
  expect(other.data).toBeUndefined();
  expect(other.error).toBe("a newer image was added to this visit");
});

test("the film scans only while the image model reads it, and settles only on a model's reading", () => {
  expect(scanOf(undefined)).toBe("off");
  // Saving is not reading: the model has not been asked yet.
  expect(scanOf({ live: true, loading: true, saving: true })).toBe("off");
  expect(scanOf({ live: true, loading: true })).toBe("reading");
  expect(scanOf({ live: true, loading: false, data: { source: "model" } })).toBe("read");
  // A sample (the model starting or late) and a failure are not a reading.
  expect(scanOf({ live: true, loading: false, data: { source: "fixture" } })).toBe("off");
  expect(scanOf({ live: true, loading: false, error: "offline" })).toBe("off");
});
