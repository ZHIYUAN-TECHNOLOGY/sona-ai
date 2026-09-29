import type { ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { Text } from "./text";
import { palette, type } from "./theme";
import { Icon } from "./ui";

/** A row's meaning colour: red must not wait, amber soon or blocked, green done or ready, blue in progress, grey otherwise. */
export type RowTone = "urgent" | "soon" | "good" | "next" | "calm";
const INK: Record<RowTone, string> = { urgent: palette.red, soon: palette.amber, good: palette.green, next: palette.blue, calm: palette.muted };
const HAIRLINE = "rgba(20,28,40,0.06)";

/** A white grouped list: rows separated by hairlines, corners rounded once. */
export function List({ children }: { children: ReactNode }) {
  return <View style={{ borderRadius: 20, borderCurve: "continuous", backgroundColor: palette.white, overflow: "hidden" }}>{children}</View>;
}

/**
 * One list row for people and things to act on (patients, visits, Sona's answers): a leading avatar
 * (initials, amber when something is soon or blocked) or a status dot, the title, the reason in its
 * meaning colour, an optional trailing value, and a chevron when it opens something. Inside `List`,
 * pass `divider` for every row but the first; in a virtualised list, pass `edges` so the row draws
 * its own part of the group.
 */
export function ListRow({ title, detail, tone = "calm", initials, trailing, badge, onPress, accessibilityLabel, accessibilityHint, divider = false, edges }: {
  title: string; detail?: string; tone?: RowTone; initials?: string; trailing?: string; badge?: ReactNode; onPress?: () => void;
  accessibilityLabel?: string; accessibilityHint?: string; divider?: boolean; edges?: { first: boolean; last: boolean };
}) {
  const ink = INK[tone];
  const shape: ViewStyle = edges ? { backgroundColor: palette.white, borderTopLeftRadius: edges.first ? 20 : 0, borderTopRightRadius: edges.first ? 20 : 0, borderBottomLeftRadius: edges.last ? 20 : 0, borderBottomRightRadius: edges.last ? 20 : 0, borderCurve: "continuous" } : {};
  const base: ViewStyle = { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: divider || (edges && !edges.first) ? 1 : 0, borderColor: HAIRLINE, ...shape };
  const content = <>
    {initials ? <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: tone === "soon" ? "rgba(196,120,20,0.16)" : "rgba(36,91,204,0.14)", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: tone === "soon" ? palette.amber : palette.blue }}>{initials}</Text>
    </View> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ink }} />}
    <View style={{ flex: 1, gap: 2 }}>
      <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{title}{badge}</Text>
      {detail ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {initials && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ink }} />}
        <Text numberOfLines={2} style={{ ...type.caption, flex: 1, fontWeight: "500", color: ink }}>{detail}</Text>
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
