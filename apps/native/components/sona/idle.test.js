import { expect, test } from "bun:test";
import { createIdle, createSlides } from "./idle";

const sleep = ms => new Promise(r => setTimeout(r, ms));

test("idle after the quiet spell; a poke wakes it at once and restarts the spell", async () => {
  const idle = createIdle(40);
  let changes = 0;
  idle.subscribe(() => changes++);
  idle.start();
  expect(idle.isIdle()).toBe(false);
  await sleep(60);
  expect(idle.isIdle()).toBe(true);
  idle.poke();
  expect(idle.isIdle()).toBe(false);
  await sleep(25);
  idle.poke(); // activity inside the spell pushes it back
  await sleep(25);
  expect(idle.isIdle()).toBe(false);
  await sleep(40);
  expect(idle.isIdle()).toBe(true);
  expect(changes).toBe(3); // idle, awake, idle: repeated pokes while awake don't notify
});

test("sliding while any screen is mid-transition; a transition that never ends lets go after the cap", async () => {
  const slides = createSlides(40);
  let changes = 0;
  slides.subscribe(() => changes++);
  slides.slide("visit", true); slides.slide("today", true); // a push starts both screens' transitions
  expect(slides.isSliding()).toBe(true);
  slides.slide("today", false);
  expect(slides.isSliding()).toBe(true); // the visit is still sliding in
  slides.slide("visit", false);
  expect(slides.isSliding()).toBe(false);
  slides.slide("sheet", true); // and never ends (a held swipe back)
  await sleep(60);
  expect(slides.isSliding()).toBe(false);
  expect(changes).toBe(4);
});
