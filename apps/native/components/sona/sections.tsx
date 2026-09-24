import { Text } from "@/components/sona/text";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { palette, type } from "./theme";
import { Icon, surfaceStyle } from "./ui";
import { MarkedText } from "./marked-text";
import { SourceScope, SourcesPill, useCapturedSource, type SourceKind } from "./sources";

/** A generated answer section: bold heading, one-line framing, then its visual block. */
const TONE = {
  blue: { wash: "rgba(36,91,204,0.11)", ink: "#245BCC" },
  teal: { wash: "rgba(20,140,130,0.13)", ink: "#0F6E66" },
  amber: { wash: "rgba(196,120,20,0.15)", ink: "#8B5518" },
  violet: { wash: "rgba(110,80,210,0.12)", ink: "#5A3DB8" },
} as const;

/**
 * A generated answer section. The header is the landmark: a tinted icon tile, the title, and on
 * the right one quiet pill for every source cited inside (links inside register instead of
 * drawing themselves). A short rule separates the header from its content.
 */
export function Section({ title, subtitle, icon, tone = "blue", children }: { title: string; subtitle?: string; icon?: string; tone?: keyof typeof TONE; children: ReactNode }) {
  return <SourceScope>{sources => <View style={{ gap: 14 }}>
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {icon && <View style={{ width: 30, height: 30, borderRadius: 9, borderCurve: "continuous", backgroundColor: TONE[tone].wash, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={15} color={TONE[tone].ink} /></View>}
        <Text accessibilityRole="header" style={{ flex: 1, ...type.heading, color: palette.ink }}>{title}</Text>
        <SourcesPill sources={sources} />
      </View>
      {subtitle && <Text selectable style={{ ...type.callout, color: palette.muted }}>{subtitle}</Text>}
    </View>
    {children}
  </View>}</SourceScope>;
}

/** Full-bleed horizontal row that keeps the page gutter. */
export function Shelf({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginVertical: -12 }} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 18, gap: 10 }}>{children}</ScrollView>;
}

export function GlanceTile({ value, label, caption, glyph }: { value: string; label: string; caption: string; glyph?: string }) {
  return <View accessible accessibilityLabel={`${label}, ${value}. ${caption}`} style={{ width: 112, gap: 8 }}>
    <View style={{ height: 96, ...surfaceStyle, borderRadius: 20, alignItems: "center", justifyContent: "center", gap: 2 }}>
      {glyph && <Text style={{ fontSize: 18 }}>{glyph}</Text>}
      <Text selectable numberOfLines={1} adjustsFontSizeToFit style={{ ...type.heading, fontSize: 21, color: palette.ink, fontVariant: ["tabular-nums"], paddingHorizontal: 8 }}>{value}</Text>
    </View>
    <View style={{ gap: 1, paddingHorizontal: 2 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink }}>{label}</Text>
      <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 16, color: palette.muted }}>{caption}</Text>
    </View>
  </View>;
}

/** Icon, title and caption, as in Monogram's "what changes" lists. */
export function IconRow({ icon, title, detail, sourceLabel, sourceKind, onSource }: { icon: string; title: string; detail: string; sourceLabel?: string; sourceKind?: SourceKind; onSource?: () => void }) {
  const captured = useCapturedSource(onSource ? { label: sourceLabel ?? `${title} source`, kind: sourceKind, onPress: onSource } : undefined);
  return <View style={{ flexDirection: "row", gap: 14 }}>
    <View style={{ width: 24, paddingTop: 1, alignItems: "center" }}><Icon name={icon} size={19} color={palette.ink} /></View>
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={{ fontSize: 16, fontWeight: "600", color: palette.ink }}>{title}</Text>
      <MarkedText text={detail} style={{ ...type.callout, color: palette.muted }} />
      {onSource && !captured && <Pressable accessibilityRole="button" accessibilityLabel={sourceLabel ?? `${title} source`} onPress={onSource} hitSlop={{ top: 12, bottom: 12, left: 4, right: 24 }} style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "500", color: palette.blue }}>Source</Text><Icon name="arrow.up.right" size={10} color={palette.blue} />
      </Pressable>}
    </View>
  </View>;
}
