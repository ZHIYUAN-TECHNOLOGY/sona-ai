import { requireOptionalNativeModule } from "expo";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentType } from "react";
import type { ViewStyle } from "react-native";
import { palette } from "./theme";
import { useAccessibleEffects } from "./ui";

/**
 * Scroll edge under the top bar and above the dock: a progressive blur (expo-backdrop, like iOS 26's
 * scroll edge effect) that sharpens toward the content, with a canvas wash. It needs the native
 * module, so Expo Go and Reduce Transparency get the previous solid gradient instead.
 */
type Props = { edge: "top" | "bottom"; intensity?: number; startOffset?: number; tint?: string; tintColor?: string; style?: ViewStyle };
const Native: ComponentType<Props> | undefined = requireOptionalNativeModule("BlurView")
  ? (require("expo-backdrop") as { ProgressiveBlurView: ComponentType<Props> }).ProgressiveBlurView
  : undefined;

export function EdgeBlur({ edge, style }: { edge: "top" | "bottom"; style: ViewStyle }) {
  const { reducedTransparency } = useAccessibleEffects();
  if (Native && !reducedTransparency) return <Native edge={edge} intensity={edge === "top" ? 40 : 30} startOffset={0.3} tint="systemUltraThinMaterialLight" tintColor="rgba(245,246,248,0.3)" style={{ ...style, pointerEvents: "none" } as ViewStyle} />;
  const solid = [palette.canvas, palette.canvas, "rgba(245,246,248,0)"] as const;
  return <LinearGradient pointerEvents="none" colors={edge === "top" ? solid : [solid[2], "rgba(245,246,248,0.9)", palette.canvas]} locations={edge === "top" ? [0, 0.62, 1] : [0, 0.5, 1]} style={style} />;
}
