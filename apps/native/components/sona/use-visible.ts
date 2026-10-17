import { useIsFocused } from "expo-router";
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { AppState, Dimensions, type View } from "react-native";

// Set while a full-screen overlay (the attachments menu and its camera) hides the screen, so the
// ambient wash, the orb and other idle loops stop redrawing under it.
let covered = false;
const coverListeners = new Set<() => void>();
export function setScreenCovered(on: boolean) { if (covered !== on) { covered = on; coverListeners.forEach(l => l()); } }
const subscribeCover = (l: () => void) => { coverListeners.add(l); return () => { coverListeners.delete(l); }; };

/** True while this screen is focused, uncovered and the app is in the foreground; drives pausing idle loops. */
export function useVisible() {
  const focused = useIsFocused();
  const isCovered = useSyncExternalStore(subscribeCover, () => covered);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => setForeground(state === "active"));
    return () => sub.remove();
  }, []);
  return focused && foreground && !isCovered;
}

/**
 * True once the view has scrolled into sight (its top clear of the voice dock, 280 pt above the
 * bottom edge), so a one-time reveal plays where it can be seen instead of below the fold.
 * ponytail: polls the view's window position every 200 ms until it is seen (only while the screen is visible); no global scroll wiring.
 */
export function useSeenOnce(ref: RefObject<View | null>, skip = false) {
  const [seen, setSeen] = useState(skip);
  // Nothing can come into sight while the screen is hidden or the app is away, so the polling waits.
  const visible = useVisible();
  useEffect(() => {
    if (seen || !visible) return;
    const id = setInterval(() => ref.current?.measureInWindow((_x, y, _w, h) => {
      if (h > 0 && y < Dimensions.get("window").height - 280 && y + h > 0) setSeen(true);
    }), 200);
    return () => clearInterval(id);
  }, [seen, ref, visible]);
  return seen;
}
