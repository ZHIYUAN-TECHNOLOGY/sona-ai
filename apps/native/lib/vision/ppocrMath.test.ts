// Pure tests for the PP-OCRv6 client math. No device.
//   npx tsx lib/vision/ppocrMath.test.ts

import assert from "node:assert/strict";

import {
  ctcDecode,
  dbnetBoxes,
  lineBreaksOf,
  pickDetBucket,
  pickRecBucket,
  rgbaToDetTensor,
  rgbaToRecTensor,
  sortReadingOrder,
} from "./ppocrMath";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

ok("det bucket: square-ish picks smallest fitting square", () => {
  assert.equal(pickDetBucket(600, 500).method, "detect_640");
  assert.equal(pickDetBucket(900, 900).method, "detect_960");
  assert.equal(pickDetBucket(2000, 1400).method, "detect_1280");
});

ok("det bucket: tall page picks portrait 640x1280", () => {
  const b = pickDetBucket(800, 1400);
  assert.equal(b.method, "detect_640x1280");
  assert.equal(b.w, 640);
  assert.equal(b.h, 1280);
});

ok("rec bucket: smallest width that fits", () => {
  assert.equal(pickRecBucket(150).method, "recognize_160");
  assert.equal(pickRecBucket(400).method, "recognize_480");
  assert.equal(pickRecBucket(2000).method, "recognize_1280");
});

ok("det normalization: white pixel maps to imagenet-normalized values", () => {
  const rgba = new Uint8Array([255, 255, 255, 255]);
  const t = rgbaToDetTensor(rgba, 1, 1);
  assert.ok(Math.abs(t[0] - (1 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs(t[2] - (1 - 0.406) / 0.225) < 1e-5);
});

ok("rec normalization: 0→-1, 255→+1", () => {
  const rgba = new Uint8Array([0, 255, 128, 255]);
  const t = rgbaToRecTensor(rgba, 1, 1);
  assert.ok(Math.abs(t[0] + 1) < 1e-5);
  assert.ok(Math.abs(t[1] - 1) < 1e-5);
});

ok("dbnet: two separated blobs → two boxes, reading order", () => {
  const w = 40, h = 20;
  const prob = new Float32Array(w * h);
  const paint = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) prob[y * w + x] = 0.9;
  };
  paint(2, 2, 14, 6);   // top-left word
  paint(20, 2, 36, 6);  // top-right word
  paint(2, 12, 30, 16); // second line
  const boxes = dbnetBoxes(prob, w, h);
  assert.equal(boxes.length, 3);
  assert.ok(boxes[0].x < boxes[1].x, "same line sorted left→right");
  assert.ok(boxes[2].y > boxes[0].y, "second line last");
  assert.ok(boxes[0].score > 0.8);
  const breaks = lineBreaksOf(boxes);
  assert.deepEqual(breaks, [false, false, true]);
});

ok("dbnet: sub-threshold and tiny specks are dropped", () => {
  const w = 20, h = 10;
  const prob = new Float32Array(w * h);
  prob[5] = 0.9; // 1px speck
  for (let x = 2; x <= 8; x++) prob[5 * w + x] = 0.2; // below thresh
  assert.equal(dbnetBoxes(prob, w, h).length, 0);
});

ok("dbnet: unclip expands the raw component bbox", () => {
  const w = 60, h = 30;
  const prob = new Float32Array(w * h);
  for (let y = 10; y <= 14; y++) for (let x = 10; x <= 49; x++) prob[y * w + x] = 0.95;
  const [box] = dbnetBoxes(prob, w, h);
  assert.ok(box.w > 40 && box.h > 5, `not expanded: ${JSON.stringify(box)}`);
});

ok("sortReadingOrder groups by line centres", () => {
  const boxes = [
    { x: 50, y: 0, w: 10, h: 10, score: 1 },
    { x: 0, y: 2, w: 10, h: 10, score: 1 },
    { x: 0, y: 30, w: 10, h: 10, score: 1 },
  ];
  const sorted = sortReadingOrder(boxes);
  assert.equal(sorted[0].x, 0);
  assert.equal(sorted[1].x, 50);
  assert.equal(sorted[2].y, 30);
});

ok("ctc: greedy decode dedupes repeats and skips blanks", () => {
  const charset = ["a", "b", "c"];
  const C = 4; // blank + 3
  const steps = [1, 1, 0, 2, 2, 3, 0, 0]; // → "ab c"? no: a,a,_,b,b,c,_,_ → "abc"
  const T = steps.length;
  const logits = new Float32Array(T * C).fill(-10);
  steps.forEach((s, t) => (logits[t * C + s] = 10));
  const r = ctcDecode(logits, T, C, charset);
  assert.equal(r.text, "abc");
  assert.ok(r.score > 0.99, `score ${r.score}`);
});

ok("ctc: repeated char across a blank is kept twice", () => {
  const charset = ["x"];
  const C = 2;
  const steps = [1, 0, 1];
  const logits = new Float32Array(steps.length * C).fill(-10);
  steps.forEach((s, t) => (logits[t * C + s] = 10));
  assert.equal(ctcDecode(logits, steps.length, C, charset).text, "xx");
});

console.log(`\n${passed} passed`);
