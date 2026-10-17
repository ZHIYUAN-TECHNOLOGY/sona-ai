import type { ReactNode, Ref } from "react";
import { ActivityIndicator, Pressable, View, type TextInput as RNTextInput } from "react-native";
import Animated from "react-native-reanimated";
import { Icon } from "@/lib/icons";
import { TextInput } from "@/lib/text";
import { useT } from "@/lib/i18n";
import "@/lib/strings";
import { palette } from "@/lib/theme";

/**
 * The kit's composer card (Ask Nomi): a white-ish 24 pt card on the hairline, the field, and one round
 * button on the right: send (ink) once there is text, else `idle` (voice mode in Ask Sona Care). Shared
 * by Ask Sona Care and the care-team thread. The emergency line sits under it on both screens. `pill`
 * (dictation) takes the field's place and grows with the live words (the hidden field stays mounted, out of
 * flow, so focus and text survive); the words fade back in once it goes. `finishing`: the field holds the
 * dictated words, dimmed and read-only, while the whole recording is read. `alongside` (a check-in reply's mic)
 * stays beside send even with text, so spoken words can be added to typed ones (ChatGPT's and Claude's composers).
 */

export function Composer({ value, onChangeText, placeholder, label, onSend, canSend, busy, idle, alongside, inputRef, pill, finishing, autoFocus }: {
  value: string; onChangeText: (t: string) => void; placeholder: string; label: string; onSend: () => void; canSend: boolean; busy?: boolean; idle?: ReactNode; alongside?: ReactNode; autoFocus?: boolean; inputRef?: Ref<RNTextInput>; pill?: ReactNode; finishing?: boolean;
}) {
  const t = useT();
  const typed = !!value.trim();
  return <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, borderRadius: 24, borderCurve: "continuous", padding: 6, paddingLeft: 16,
    backgroundColor: "rgba(255,255,255,0.88)", borderWidth: 1, borderColor: palette.line, boxShadow: "0 12px 28px -20px rgba(40,30,90,0.35)" }}>
    <View style={{ flex: 1, alignSelf: "stretch", justifyContent: "flex-end" }}>
      <Animated.View pointerEvents={pill ? "none" : "auto"} accessibilityElementsHidden={!!pill} importantForAccessibility={pill ? "no-hide-descendants" : "auto"}
        style={[!!pill && { position: "absolute", left: 0, right: 0, bottom: 0 }, { opacity: pill ? 0 : finishing ? 0.55 : 1, transitionProperty: "opacity", transitionDuration: 200 }]}>
        <TextInput ref={inputRef} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.pale} maxLength={1000} multiline autoFocus={autoFocus} editable={!finishing}
          returnKeyType="send" submitBehavior="submit" onSubmitEditing={onSend} accessibilityLabel={label} accessibilityState={{ busy: finishing }}
          style={{ fontSize: 17, lineHeight: 22, color: palette.ink, paddingTop: 13, paddingBottom: 13, maxHeight: 140 }} />
      </Animated.View>
      {pill}
    </View>
    {alongside}
    {typed || !idle
      ? <Pressable accessibilityRole="button" accessibilityLabel={t("common.send")}accessibilityState={{ disabled: !canSend, busy }} disabled={!canSend} onPress={onSend}
        style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark, opacity: canSend ? 1 : 0.35, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
        {busy ? <ActivityIndicator color={palette.white} /> : <Icon name="arrowUp" color={palette.white} size={20} weight="bold" />}
      </Pressable>
      : idle}
  </View>;
}

