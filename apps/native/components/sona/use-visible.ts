import { useIsFocused } from "expo-router";
import { useEffect, useState, type RefObject } from "react";
import { AppState, Dimensions, type View } from "react-native";

/** True while this screen is focused and the app is in the foreground; drives pausing idle loops. */
export function useVisible() {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => setForeground(state === "active"));
    return () => sub.remove();
  }, []);
  return focused && foreground;
}

/**
 * True once the view has scrolled into sight (its top clear of the voice dock, 280 pt above the
 * bottom edge), so a one-time reveal plays where it can be seen instead of below the fold.
 * ponytail: polls the view's window position every 200 ms until it is seen; no global scroll wiring.
 */
export function useSeenOnce(ref: RefObject<View | null>, skip = false) {
  const [seen, setSeen] = useState(skip);
  useEffect(() => {
    if (seen) return;
    const id = setInterval(() => ref.current?.measureInWindow((_x, y, _w, h) => {
      if (h > 0 && y < Dimensions.get("window").height - 280 && y + h > 0) setSeen(true);
    }), 200);
    return () => clearInterval(id);
  }, [seen, ref]);
  return seen;
}
