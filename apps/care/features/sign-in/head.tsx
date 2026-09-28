import { View } from "react-native";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText } from "@/lib/ui";

/** The kit's centred onboarding head ("Please scan / your code"): a light grey line over a bold one in the headline gradient. */
export function Head({ light, bold, size = 28 }: { light: string; bold: string; size?: number }) {
  return <View accessible accessibilityRole="header" accessibilityLabel={`${light} ${bold}`} style={{ alignItems: "center", gap: 2 }}>
    <Text lineBreakStrategyIOS="standard" style={{ fontSize: 20, lineHeight: 26, letterSpacing: -0.6, color: palette.faint, textAlign: "center" }}>{light}</Text>
    <AccentText style={{ fontSize: size, lineHeight: size + 6, letterSpacing: -size * 0.065, fontWeight: "600", color: palette.ink, textAlign: "center" }}>{bold}</AccentText>
  </View>;
}

/** A field's label (the kit's 14 pt grey over a #FAFAFA field). */
export function Label({ children }: { children: string }) {
  return <Text style={{ ...type.footnote, fontWeight: "500", color: palette.muted, marginLeft: 4 }}>{children}</Text>;
}
