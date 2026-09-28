import { expect, mock, test } from "bun:test";

// The server's dose log, and whether it can be reached.
let server = [], online = true;
mock.module("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => {} }));
mock.module("@/utils/orpc", () => ({ client: { care: { doses: {
  take: async ({ key }) => { if (!online) throw new Error("offline"); if (!server.includes(key)) server.push(key); return { key }; },
  list: async () => { if (!online) throw new Error("offline"); return [...server]; },
} } } }));
const { markTaken, syncTaken, takenNow } = await import("./log");
const serverAfterSync = async () => { await syncTaken(); return [...server]; };

test("a dose the server forgot (a demo reset) is not sent back; one taken offline is", async () => {
  markTaken("Azithromycin@2026-09-29T00:00:00.000Z");
  await Bun.sleep(0);
  expect(server).toEqual(["Azithromycin@2026-09-29T00:00:00.000Z"]);

  server = []; // the demo reset clears the server's log
  expect(await serverAfterSync()).toEqual([]);

  online = false;
  markTaken("Cetirizine@2026-09-29T13:00:00.000Z");
  online = true;
  expect(await serverAfterSync()).toEqual(["Cetirizine@2026-09-29T13:00:00.000Z"]);
  expect(takenNow()).toEqual(["Cetirizine@2026-09-29T13:00:00.000Z"]);
});
