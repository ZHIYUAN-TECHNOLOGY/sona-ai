import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { Text } from "@/components/sona/text";
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Orb } from "./orb";
import { Glass, IconButton } from "./ui";
import { palette } from "./theme";

/** Native layout owns growing response bounds; animate visual reveals inside them. */
export function ResponseFrame({ pending, partial, phase, onCancel, onSource, children }: { pending: boolean; partial: boolean; phase?: string; onCancel: () => void; onSource: () => void; children: ReactNode }) {
  const reduce = useReduceMotionPreference();
  return <View collapsable={false} style={{ gap: 12 }}>
    {pending ? <Glass style={{ borderRadius: 22, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Orb active compact /><View style={{ flex: 1, gap: 5 }}><Text style={{ fontSize: 15, color: palette.ink, fontWeight: "500" }}>{phase ?? "Preparing your response"}</Text><Text style={{ fontSize: 12, color: palette.muted }}>Reading the encounter…</Text></View><IconButton name="stop.fill" label="Cancel response" onPress={onCancel} />
    </Glass> : <>
      <Animated.View key={partial ? "source-preview" : "source-chip"} entering={reduce ? undefined : FadeIn.duration(160)} exiting={reduce ? undefined : FadeOut.duration(100)}>
        {partial ? <View style={{ backgroundColor: "#E6EEF9", borderRadius: 16, padding: 12, gap: 4 }}><Text style={{ color: palette.blue, fontSize: 12 }}>Reading history · observations · source context</Text><Text style={{ color: palette.muted, fontSize: 12 }}>Only completed sections appear below.</Text></View> : null}
      </Animated.View>
      {children}
    </>}
  </View>;
}
