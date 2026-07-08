import { StyleSheet, Text, type TextStyle } from "react-native";

import { colors, font } from "@/lib/theme";

/**
 * Big editorial serif (Fraunces) display heading used in screen bodies —
 * Home ("Consults"), Complete, etc. Distinct from the compact TopBar title.
 */
export function SerifTitle({
  children,
  size = "h1",
  color = colors.ink,
  style,
}: {
  children: string;
  size?: "hero" | "h1" | "h2" | "h3";
  color?: string;
  style?: TextStyle;
}) {
  return <Text style={[styles[size], { color }, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  hero: font.hero,
  h1: font.h1,
  h2: font.h2,
  h3: font.h3,
});
