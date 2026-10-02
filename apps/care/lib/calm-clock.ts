import { useEffect } from "react";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";

// One app-wide time base, so two canvases showing at once (a page sliding over another) agree.
const EPOCH = Date.now();

/**
 * Skia's useClock for ambient drawing, but one that can stop: it advances every frame only while `active`. useClock
 * ticks for as long as its canvas is mounted, so a page covered by another (its canvas still mounted under the stack)
 * kept redrawing blurs and shaders nobody could see. Paused, the drawing holds its last frame, so nothing on screen
 * changes. Frame callbacks also stop on their own while the app is in the background.
 */
export function useCalmClock(active = true) {
  const clock = useSharedValue(Date.now() - EPOCH);
  const tick = useFrameCallback(f => {
    "worklet";
    clock.value += f.timeSincePreviousFrame ?? 0;
  }, false);
  useEffect(() => { tick.setActive(active); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  return clock;
}
