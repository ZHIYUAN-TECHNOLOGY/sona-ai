import { ActivityIndicator, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withSpring } from "react-native-reanimated";
import type { useListen } from "@/lib/listen";
import { palette } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { Glyph } from "./composer";
import "./strings";

export const MIC = "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3M19 10v2a7 7 0 0 1-14 0v-2M12 19v3";

/**
 * The round mic button: tap to speak, tap again (or just stop talking) to send. While listening it
 * fills azure and a soft ring breathes with the voice's loudness; while the words are read, a spinner.
 */
export function MicButton({ listen, size = 48, label }: { listen: ReturnType<typeof useListen>; size?: number; label?: string }) {
  const t = useT();
  const still = useReducedMotion();
  const on = listen.state === "listening";
  // -60 dB (quiet) to -10 dB (loud) becomes a ring from the button's size to 1.6×.
  const loud = Math.max(0, Math.min(1, (listen.level + 60) / 50));
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: on && !still ? withSpring(1 + loud * 0.6, { duration: 180, dampingRatio: 0.8 }) : 1 }], opacity: on ? 0.35 : 0 }));
  return <Pressable accessibilityRole="button" accessibilityLabel={on ? t("mic.send") : listen.state === "reading" ? t("mic.reading") : label ?? t("mic.speak")}
    accessibilityHint={on ? t("mic.stopHint") : t("mic.hint")} accessibilityState={{ busy: listen.state === "reading" }}
    disabled={listen.state === "reading"} onPress={listen.toggle}
    style={({ pressed }) => ({ width: size, height: size, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: palette.blue }, ring]} />
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: on ? palette.blue : palette.mutedWash }}>
      {listen.state === "reading" ? <ActivityIndicator color={palette.ink} /> : <Glyph d={MIC} color={on ? palette.white : palette.ink} size={size * 0.42} />}
    </View>
  </Pressable>;
}
