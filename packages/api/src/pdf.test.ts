import { expect, test } from "bun:test";

import { crc32, png, shrink } from "./pdf";

const inflate = async (bytes: Uint8Array) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());

test("a PNG carries its size in a checked header and inflates back to the scanlines it was given", async () => {
  const data = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => i * 7);
  const out = await png({ data, width: 3, height: 2, channels: 4 });
  expect([...out.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(out.buffer);
  expect(new TextDecoder().decode(out.subarray(12, 16))).toBe("IHDR");
  expect([view.getUint32(16), view.getUint32(20), out[24], out[25]]).toEqual([3, 2, 8, 6]);
  expect(view.getUint32(29)).toBe(crc32(out.subarray(12, 29)));
  const idatLength = view.getUint32(33);
  const raw = await inflate(out.subarray(41, 41 + idatLength));
  // Each scanline opens with filter 0 (none), then the row's pixels as given.
  expect([...raw]).toEqual([0, ...data.subarray(0, 12), 0, ...data.subarray(12)]);
});

test("a large page is shrunk to 1,600 px on its long side, each pixel its box's average", () => {
  const big = shrink({ data: new Uint8Array(3200 * 2).map((_, i) => i % 2 ? 200 : 100), width: 3200, height: 2, channels: 1 }, 1600);
  expect([big.width, big.height]).toEqual([1600, 1]);
  expect(big.data[0]).toBe(150);
  const small = { data: new Uint8Array(4), width: 2, height: 2, channels: 1 as const };
  expect(shrink(small, 1600)).toBe(small);
});
