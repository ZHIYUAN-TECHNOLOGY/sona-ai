import { Text as NativeText, useWindowDimensions, type TextProps } from "react-native";

/** Remount the native text node when Dynamic Type changes so cached measurements
 * cannot retain the previous line height. The surrounding feature/draft stays mounted. */
export function Text(props: TextProps) {
  const { fontScale } = useWindowDimensions();
  return <NativeText key={fontScale} lineBreakStrategyIOS="push-out" {...props} />;
}
