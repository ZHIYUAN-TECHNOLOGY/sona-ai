import type { ReactNode, Ref } from "react";
import { ActivityIndicator, Pressable, View, type TextInput as RNTextInput } from "react-native";
import Svg, { Path } from "react-native-svg";
import { TextInput } from "@/lib/text";
import { useT } from "@/lib/i18n";
import "@/lib/strings";
import { palette } from "@/lib/theme";

/**
 * The kit's composer card (Ask Nomi): a white-ish 24 pt card on the hairline, the field, and one round
 * button on the right: send (ink) once there is text, else `idle` (voice mode in Ask Sona Care). Shared
 * by Ask Sona Care and the care-team thread. The emergency line sits under it on both screens.
 */
export const GLYPH = {
  up: "M12 19V5m-7 7l7-7l7 7",
  voice: "M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3",
};

export function Composer({ value, onChangeText, placeholder, label, onSend, canSend, busy, idle, inputRef }: {
  value: string; onChangeText: (t: string) => void; placeholder: string; label: string; onSend: () => void; canSend: boolean; busy?: boolean; idle?: ReactNode; inputRef?: Ref<RNTextInput>;
}) {
  const t = useT();
  const typed = !!value.trim();
  return <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, borderRadius: 24, borderCurve: "continuous", padding: 6, paddingLeft: 16,
    backgroundColor: "rgba(255,255,255,0.88)", borderWidth: 1, borderColor: palette.line, boxShadow: "0 12px 28px -20px rgba(40,30,90,0.35)" }}>
    <TextInput ref={inputRef} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.faint} maxLength={1000} multiline
      returnKeyType="send" submitBehavior="submit" onSubmitEditing={onSend} accessibilityLabel={label}
      style={{ flex: 1, fontSize: 17, lineHeight: 22, color: palette.ink, paddingTop: 13, paddingBottom: 13, maxHeight: 140 }} />
    {typed || !idle
      ? <Pressable accessibilityRole="button" accessibilityLabel={t("common.send")}accessibilityState={{ disabled: !canSend, busy }} disabled={!canSend} onPress={onSend}
        style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark, opacity: canSend ? 1 : 0.35, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
        {busy ? <ActivityIndicator color={palette.white} /> : <Glyph d={GLYPH.up} color={palette.white} size={20} />}
      </Pressable>
      : idle}
  </View>;
}

export function Glyph({ d, color, size = 18, width = 1.9 }: { d: string; color: string; size?: number; width?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
