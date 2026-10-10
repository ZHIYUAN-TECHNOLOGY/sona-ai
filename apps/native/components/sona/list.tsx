import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useReduceMotionPreference } from "./accessibility";
import { Text } from "./text";
import { palette, type, radius } from "./theme";
import { Icon } from "./ui";

/** A row's meaning colour: red must not wait, amber soon or blocked, green done or ready, blue in progress, grey otherwise. */
export type RowTone = "urgent" | "soon" | "good" | "next" | "calm";
const INK: Record<RowTone, string> = { urgent: palette.red, soon: palette.amber, good: palette.green, next: palette.blue, calm: palette.muted };
const HAIRLINE = "rgba(20,28,40,0.06)";

/** A white grouped list: rows separated by hairlines, corners rounded once. */
export function List({ children }: { children: ReactNode }) {
  return <View style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, overflow: "hidden" }}>{children}</View>;
}

/**
 * One list row for people and things to act on (patients, visits, Sona's answers): a leading avatar
 * (initials, amber when something is soon or blocked) or a status dot, the title, the reason in its
 * meaning colour, an optional trailing value, and a chevron when it opens something. Inside `List`,
 * pass `divider` for every row but the first; in a virtualised list, pass `edges` so the row draws
 * its own part of the group.
 */
export function ListRow({ title, detail, detailLines = 2, tone = "calm", initials, trailing, badge, onPress, accessibilityLabel, accessibilityHint, divider = false, edges }: {
  /** `detailLines`: how many lines the reason may take before it is cut (0 shows it whole). */
  title: string; detail?: string; detailLines?: number; tone?: RowTone; initials?: string; trailing?: string; badge?: ReactNode; onPress?: () => void;
  accessibilityLabel?: string; accessibilityHint?: string; divider?: boolean; edges?: { first: boolean; last: boolean };
}) {
  const ink = INK[tone];
  const shape: ViewStyle = edges ? { backgroundColor: palette.white, borderTopLeftRadius: edges.first ? radius.group : 0, borderTopRightRadius: edges.first ? radius.group : 0, borderBottomLeftRadius: edges.last ? radius.group : 0, borderBottomRightRadius: edges.last ? radius.group : 0, borderCurve: "continuous" } : {};
  const base: ViewStyle = { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: divider || (edges && !edges.first) ? 1 : 0, borderColor: HAIRLINE, ...shape };
  const content = <>
    {initials ? <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: tone === "soon" ? "rgba(196,120,20,0.16)" : "rgba(36,91,204,0.14)", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ ...type.caption, fontWeight: "700", color: tone === "soon" ? palette.amber : palette.blue }}>{initials}</Text>
    </View> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ink }} />}
    <View style={{ flex: 1, gap: 2 }}>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{title}{badge}</Text>
      {detail ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {initials && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ink }} />}
        <Text numberOfLines={detailLines || undefined} style={{ ...type.caption, flex: 1, fontWeight: "500", color: ink }}>{detail}</Text>
      </View> : null}
    </View>
    {trailing ? <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{trailing}</Text> : null}
    {onPress && <Icon name="chevron.right" size={12} color={palette.muted} />}
  </>;
  const label = accessibilityLabel ?? [title, trailing, detail].filter(Boolean).join(", ");
  if (!onPress) return <View accessible accessibilityLabel={label} style={base}>{content}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} onPress={onPress}
    style={({ pressed }) => ({ ...base, backgroundColor: pressed ? "rgba(240,242,246,1)" : edges ? palette.white : "transparent" })}>{content}</Pressable>;
}

/**
 * Questions to ask Sona next (Related under an evidence answer, "Also ask" at the end of a visit, the
 * other questions in the ask sheet): one row each, ✦ then the question, tapping asks it.
 */
export function QuestionList({ title, questions, onAsk }: { title?: string; questions: { key: string; text: string }[]; onAsk: (key: string) => void }) {
  const reduced = useReduceMotionPreference();
  if (!questions.length) return null;
  return <View style={{ gap: 8 }}>
    {title && <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted, paddingHorizontal: 4 }}>{title}</Text>}
    <List>
      {questions.map((q, i) => <Pressable key={q.key} accessibilityRole="button" accessibilityLabel={q.text} accessibilityHint="Asks Sona" onPress={() => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); onAsk(q.key); }}>
        {({ pressed }) => <Animated.View style={{ minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderColor: HAIRLINE, backgroundColor: pressed ? "rgba(240,242,246,1)" : "transparent", transform: [{ scale: pressed && !reduced ? 0.98 : 1 }], transitionProperty: "transform", transitionDuration: 120 }}>
          <Text style={{ ...type.footnote, color: palette.blue }}>✦</Text>
          <Text style={{ ...type.callout, flex: 1, color: palette.ink }}>{q.text}</Text>
          <Icon name="arrow.up.right" size={11} color={palette.muted} />
        </Animated.View>}
      </Pressable>)}
    </List>
  </View>;
}
