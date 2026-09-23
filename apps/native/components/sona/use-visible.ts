import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

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
