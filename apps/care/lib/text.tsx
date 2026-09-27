import { Outfit_300Light, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";

/**
 * Sona Care's type face, Outfit (after the Life OS style guide): a custom font has one family per
 * weight, so these wrappers read the style's fontWeight and pick the matching Outfit face. Screens
 * import Text / TextInput from here instead of react-native; everything else about them is unchanged.
 */
export const FONTS = { Outfit_300Light, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold };

const FACE: Record<string, string> = {
  "100": "Outfit_300Light", "200": "Outfit_300Light", "300": "Outfit_300Light", normal: "Outfit_400Regular", "400": "Outfit_400Regular",
  "500": "Outfit_500Medium", "600": "Outfit_600SemiBold", bold: "Outfit_700Bold", "700": "Outfit_700Bold", "800": "Outfit_700Bold", "900": "Outfit_700Bold",
};

/** The style with Outfit's face for its weight (fontWeight removed so iOS doesn't synthesise a bolder copy). */
export function outfit(style: TextProps["style"]) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (flat.fontFamily) return style;
  const { fontWeight, ...rest } = flat;
  return { ...rest, fontFamily: FACE[String(fontWeight ?? "400")] ?? "Outfit_400Regular" };
}

export function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={outfit(style)} />;
}

export function TextInput({ style, ...props }: TextInputProps & { ref?: React.Ref<RNTextInput> }) {
  return <RNTextInput {...props} style={outfit(style) as TextInputProps["style"]} />;
}

/** Reanimated's Text in Outfit, for entering/exiting and animated styles. */
const AnimatedRNText = Animated.Text;
export function AnimatedText({ style, ...props }: React.ComponentProps<typeof AnimatedRNText>) {
  const flat = StyleSheet.flatten(style as TextProps["style"]) as TextStyle | undefined;
  const face = flat?.fontFamily ? {} : { fontFamily: FACE[String(flat?.fontWeight ?? "400")] ?? "Outfit_400Regular", fontWeight: undefined };
  return <AnimatedRNText {...props} style={[style, face]} />;
}
