import { Text } from "@/components/sona/text";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { palette } from "./theme";
import { Icon, surfaceStyle } from "./ui";

/** A generated answer section: bold heading, one-line framing, then its visual block. */
export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <View style={{ gap: 14 }}>
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ fontSize: 19, lineHeight: 24, fontWeight: "600", letterSpacing: -0.35, color: palette.ink }}>{title}</Text>
      {subtitle && <Text selectable style={{ fontSize: 15, lineHeight: 21, color: palette.muted }}>{subtitle}</Text>}
    </View>
    {children}
  </View>;
}

/** Full-bleed horizontal row that keeps the page gutter. */
export function Shelf({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginVertical: -12 }} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 18, gap: 10 }}>{children}</ScrollView>;
}

export function GlanceTile({ value, label, caption, glyph }: { value: string; label: string; caption: string; glyph?: string }) {
  return <View accessible accessibilityLabel={`${label}, ${value}. ${caption}`} style={{ width: 112, gap: 8 }}>
    <View style={{ height: 96, ...surfaceStyle, borderRadius: 20, alignItems: "center", justifyContent: "center", gap: 2 }}>
      {glyph && <Text style={{ fontSize: 18 }}>{glyph}</Text>}
      <Text selectable numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 21, fontWeight: "600", letterSpacing: -0.4, color: palette.ink, fontVariant: ["tabular-nums"], paddingHorizontal: 8 }}>{value}</Text>
    </View>
    <View style={{ gap: 1, paddingHorizontal: 2 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink }}>{label}</Text>
      <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 16, color: palette.muted }}>{caption}</Text>
    </View>
  </View>;
}

/** Icon, title and caption, as in Monogram's "what changes" lists. */
export function IconRow({ icon, title, detail, sourceLabel, onSource }: { icon: string; title: string; detail: string; sourceLabel?: string; onSource?: () => void }) {
  return <View style={{ flexDirection: "row", gap: 14 }}>
    <View style={{ width: 24, paddingTop: 1, alignItems: "center" }}><Icon name={icon} size={19} color={palette.ink} /></View>
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={{ fontSize: 16, fontWeight: "600", color: palette.ink }}>{title}</Text>
      <Text selectable style={{ fontSize: 15, lineHeight: 21, color: palette.muted }}>{detail}</Text>
      {onSource && <Pressable accessibilityRole="button" accessibilityLabel={sourceLabel ?? `${title} source`} onPress={onSource} hitSlop={{ top: 12, bottom: 12, left: 4, right: 24 }} style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: palette.blue }}>Source</Text><Icon name="arrow.up.right" size={10} color={palette.blue} />
      </Pressable>}
    </View>
  </View>;
}
