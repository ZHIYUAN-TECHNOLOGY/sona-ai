import type { ReactNode } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { rise } from "@/features/doses";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { pillStyle } from "@/lib/ui";

/**
 * The kit's vertical timeline (Schedule, past check-ins): a 1 pt hairline on the left with a dot per stop,
 * blue for the next, grey for the rest, a green check once done, and each stop's card beside it. Stops
 * rise in 40 ms apart (ease-out); still under Reduce Motion.
 */
export function Timeline({ children, line = true }: { children: ReactNode; line?: boolean }) {
  return <View style={{ gap: 12 }}>
    {line && <View pointerEvents="none" style={{ position: "absolute", left: 8.5, top: 30, bottom: 30, width: 1, backgroundColor: "#E7E7E5" }} />}
    {children}
  </View>;
}

export function Stop({ index, still, done, lead, children }: { index: number; still: boolean; done: boolean; lead: boolean; children: ReactNode }) {
  return <Animated.View entering={rise(still, index)} style={{ flexDirection: "row", gap: 12 }}>
    <View style={{ width: 18, alignItems: "center", paddingTop: 23 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {done ? <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: palette.success }}>
        <Svg width={11} height={11} viewBox="0 0 24 24"><Path d="M20 6L9 17l-5-5" fill="none" stroke={palette.white} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </View>
        : <View style={{ width: 14, height: 14, marginTop: 2, borderRadius: 7, backgroundColor: lead ? palette.info : palette.pale, borderWidth: 2, borderColor: palette.canvas }} />}
    </View>
    <View style={{ flex: 1 }}>{children}</View>
  </Animated.View>;
}

/** The kit's white time capsule ("8:30 AM", "Mon 28 Sep"). */
export function Capsule({ children }: { children: string }) {
  return <View style={[pillStyle, { alignSelf: "flex-start", minHeight: 28, paddingHorizontal: 11, justifyContent: "center", flexShrink: 1 }]}>
    <Text maxFontSizeMultiplier={1.4} style={{ ...type.footnote, fontWeight: "600", color: palette.muted, fontVariant: ["tabular-nums"] }}>{children}</Text>
  </View>;
}

/** A stop's title: the kit's 18 pt SemiBold. */
export const STOP_TITLE = { fontSize: 18, lineHeight: 24, letterSpacing: -0.4, fontWeight: "600", color: palette.ink } as const;
