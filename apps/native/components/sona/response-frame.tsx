import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { Text } from "@/components/sona/text";
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { palette, type, radius } from "./theme";

/** Native layout owns growing response bounds; animate visual reveals inside them. */
export function ResponseFrame({ partial, children }: { partial: boolean; children: ReactNode }) {
  const reduce = useReduceMotionPreference();
  return <View collapsable={false} style={{ gap: 12 }}>
    <Animated.View key={partial ? "source-preview" : "source-chip"} entering={reduce ? undefined : FadeIn.duration(160)} exiting={reduce ? undefined : FadeOut.duration(100)}>
      {partial ? <View style={{ backgroundColor: "#E6EEF9", borderRadius: radius.control, padding: 12, gap: 4 }}><Text style={{ color: palette.blue, ...type.caption }}>Reading history · observations · source context</Text><Text style={{ color: palette.muted, ...type.caption }}>Only completed sections appear below.</Text></View> : null}
    </Animated.View>
    {children}
  </View>;
}
