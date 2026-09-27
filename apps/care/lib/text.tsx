import { PlusJakartaSans_300Light, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans";
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";

/**
 * Sona Care's type face, Plus Jakarta Sans (the AI Health Companion kit's style guide): a custom font
 * has one family per weight, so these wrappers read the style's fontWeight and pick the matching face.
 * Screens import Text / TextInput from here instead of react-native; everything else is unchanged.
 */
export const FONTS = { PlusJakartaSans_300Light, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold };

const FACE: Record<string, string> = {
  "100": "PlusJakartaSans_300Light", "200": "PlusJakartaSans_300Light", "300": "PlusJakartaSans_300Light", normal: "PlusJakartaSans_400Regular", "400": "PlusJakartaSans_400Regular",
  "500": "PlusJakartaSans_500Medium", "600": "PlusJakartaSans_600SemiBold", bold: "PlusJakartaSans_700Bold", "700": "PlusJakartaSans_700Bold", "800": "PlusJakartaSans_700Bold", "900": "PlusJakartaSans_700Bold",
};

/** The style with the face for its weight (fontWeight removed so iOS doesn't synthesise a bolder copy). */
export function withFace(style: TextProps["style"]) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (flat.fontFamily) return style;
  const { fontWeight, ...rest } = flat;
  return { ...rest, fontFamily: FACE[String(fontWeight ?? "400")] ?? "PlusJakartaSans_400Regular" };
}

export function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={withFace(style)} />;
}

export function TextInput({ style, ...props }: TextInputProps & { ref?: React.Ref<RNTextInput> }) {
  return <RNTextInput {...props} style={withFace(style) as TextInputProps["style"]} />;
}

/** Reanimated's Text in Plus Jakarta Sans, for entering/exiting and animated styles. */
const AnimatedRNText = Animated.Text;
export function AnimatedText({ style, ...props }: React.ComponentProps<typeof AnimatedRNText>) {
  const flat = StyleSheet.flatten(style as TextProps["style"]) as TextStyle | undefined;
  const face = flat?.fontFamily ? {} : { fontFamily: FACE[String(flat?.fontWeight ?? "400")] ?? "PlusJakartaSans_400Regular", fontWeight: undefined };
  return <AnimatedRNText {...props} style={[style, face]} />;
}
