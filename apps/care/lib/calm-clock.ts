import { useEffect } from "react";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";

// One app-wide time base, so two canvases showing at once (a page sliding over another) agree.
const EPOCH = Date.now();

/**
 * A clock (ms) for ambient Skia drawing that redraws at most `fps` times a second and only while `active`. Skia's
 * useClock ticks every frame (60–120 Hz) forever, and each tick redraws its canvas: blurs and shaders on every frame
 * of every mounted canvas, on screen or not, which is what warmed the phone. Slow ambient motion (cycles of many
 * seconds) looks the same at 15–30 fps. Frame callbacks also stop on their own while the app is in the background.
 */
export function useCalmClock(fps: number, active = true) {
  const clock = useSharedValue(Date.now() - EPOCH);
  const pending = useSharedValue(0);
  const step = 1000 / fps;
  const tick = useFrameCallback(f => {
    "worklet";
    pending.value += f.timeSincePreviousFrame ?? 0;
    if (pending.value >= step) { clock.value += pending.value; pending.value = 0; }
  }, false);
  useEffect(() => { tick.setActive(active); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  return clock;
}
