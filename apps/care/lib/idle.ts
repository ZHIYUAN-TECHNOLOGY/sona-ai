import { useSyncExternalStore } from "react";

/*
 * Whether the patient has left the screen alone for a while (no touch, keyboard or return to the app for IDLE_MS).
 * Ambient motion (the moving background, the Sona orb in the dock and on Ask) comes to rest while idle, and starts
 * again on the next touch. Measured on 2 Oct (as in Sona Pro): any motion made iOS recomposite every blur and glass
 * layer every frame; idle on Home that was 14% app and 29% render-server CPU in the simulator.
 * The root layout reports activity (`poke`).
 */
export const IDLE_MS = 8000;

/** One idle clock: `poke` on activity; idle once `ms` pass without one. Its own factory, so a test runs it on a short clock. */
export function createIdle(ms = IDLE_MS) {
  let idle = false, timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => { if (idle !== next) { idle = next; listeners.forEach(l => l()); } };
  const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => set(true), ms); };
  return {
    poke() { set(false); arm(); },
    isIdle: () => idle,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    start: arm,
  };
}

const clock = createIdle();
clock.start();
/** Activity: a touch anywhere, the keyboard, the app coming back to the front. */
export const poke = clock.poke;
export const useIdle = () => useSyncExternalStore(clock.subscribe, clock.isIdle);

/**
 * Screens and sheets mid-transition (by route key), each until its transition ends or SLIDE_MAX_MS pass (a held swipe
 * back). While any is, the canvas and the orb hold their frame, as Sona Pro's wash and orb do: the page sliding in is
 * focused from the first frame, so its full-screen blurred aurora and the dock's orb redrew on every frame of the slide.
 * A frame held for a 350 ms slide is not seen; the motion carries on from it after. The root stack reports transitions (`slide`).
 */
export const SLIDE_MAX_MS = 1000;
export function createSlides(max = SLIDE_MAX_MS) {
  const keys = new Set<string>(), listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sliding = false;
  const update = () => { if (sliding !== keys.size > 0) { sliding = !sliding; listeners.forEach(l => l()); } };
  return {
    slide(key: string, start: boolean) {
      if (start) { keys.add(key); if (timer) clearTimeout(timer); timer = setTimeout(() => { keys.clear(); update(); }, max); }
      else keys.delete(key);
      update();
    },
    isSliding: () => sliding,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

const slides = createSlides();
export const slide = slides.slide;
export const useSliding = () => useSyncExternalStore(slides.subscribe, slides.isSliding);
