import * as Haptics from "expo-haptics";
import { useState } from "react";
import { AccessibilityInfo, Modal, Pressable, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, SlideInDown, SlideOutDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/lib/icons";
import { LANGS, setLang, tFor, translate, useLang, type Lang } from "@/lib/i18n";
import "@/lib/strings";
import { AnimatedText, Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { AccentText, Button } from "@/lib/ui";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const OUT_MS = 220;

/** Home's quiet row beside Sign out: "Language · Bahasa Melayu", opening the three choices. */
export function LanguageRow() {
  const lang = useLang(), t = tFor(lang);
  const [open, setOpen] = useState(false);
  const name = LANGS.find(l => l.id === lang)!.label;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t("lang.row")}: ${name}`} accessibilityHint={t("lang.hint")} onPress={() => setOpen(true)}
      style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{t("lang.row")} · <Text style={{ color: palette.blue }}>{name}</Text></Text>
    </Pressable>
    <LanguageSheet open={open} onClose={() => setOpen(false)} />
  </>;
}

/**
 * The language choices as the kit's white sheet (40 pt corners, a grabber, the centred light-then-gradient
 * head), springing up with its rows 40 ms apart like the + sheet. Motion after 60fps "Craft Background
 * Preset Selection Sheet" (https://60fps.design/shots/craft-background-preset-selection-sheet): a tap
 * applies the choice at once, so the screen behind (dock labels, titles) changes under the open sheet
 * as a live preview, while the sheet's own words crossfade into the new language and the ink check
 * moves to the chosen row (ease-out, no spring: a calm, medium-length fade). Done closes it.
 * Reduce Motion: the sheet fades in and out, and words change without a crossfade.
 */
function LanguageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const lang = useLang(), t = tFor(lang);
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    setLeaving(true);
    setTimeout(() => { setLeaving(false); onClose(); }, still ? 0 : OUT_MS);
  };
  // Words that change language crossfade in place (keyed on the language).
  const fade = still ? undefined : FadeIn.duration(260).easing(EASE_OUT);
  const shown = open && !leaving;

  return <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
    {shown && <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(OUT_MS)} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(31,31,31,0.28)" }}>
      <Pressable accessible={false} onPress={close} style={{ flex: 1 }} />
    </Animated.View>}
    {shown && <Animated.View accessibilityViewIsModal
      entering={still ? FadeIn.duration(200) : SlideInDown.springify().duration(460).dampingRatio(0.82)}
      exiting={still ? FadeOut.duration(150) : SlideOutDown.duration(OUT_MS).easing(EASE_OUT)}
      style={{ position: "absolute", left: 8, right: 8, bottom: Math.max(insets.bottom, 8), borderRadius: 40, borderCurve: "continuous", backgroundColor: palette.white, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, gap: 6 }}>
      <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "#E5E5E5" }} />
      <Animated.View key={`head-${lang}`} entering={fade} accessible accessibilityRole="header" accessibilityLabel={`${t("lang.light")} ${t("lang.bold")}`} style={{ alignItems: "center", paddingTop: 18, paddingBottom: 4, gap: 2 }}>
        <Text style={{ fontSize: 20, lineHeight: 26, letterSpacing: -0.6, color: palette.muted, textAlign: "center" }}>{t("lang.light")}</Text>
        <AccentText style={{ fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -1.9, color: palette.ink, textAlign: "center" }}>{t("lang.bold")}</AccentText>
      </Animated.View>
      <AnimatedText key={`line-${lang}`} entering={fade} style={{ ...type.footnote, color: palette.faint, textAlign: "center", paddingBottom: 8 }}>{t("lang.line")}</AnimatedText>
      <LanguageChoices stagger />
      <View style={{ marginTop: 10 }}><Button label={t("common.done")} onPress={close} /></View>
    </Animated.View>}
  </Modal>;
}

/**
 * The three languages as radio rows, in the sheet and in place on Settings: a tap applies the choice at once,
 * so the screen around it changes language as a live preview, and the ink check moves to the chosen row. In the sheet
 * (`stagger`) the rows rise 40 ms apart; on a pushed page they arrive with the page.
 */
export function LanguageChoices({ stagger = false }: { stagger?: boolean }) {
  const still = useReducedMotion();
  const lang = useLang();
  const pick = (to: Lang) => {
    if (to === lang) return;
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    setLang(to);
    AccessibilityInfo.announceForAccessibility(LANGS.find(l => l.id === to)!.label);
  };
  const fade = still ? undefined : FadeIn.duration(260).easing(EASE_OUT);
  return <>
    {LANGS.map((l, i) => {
      const on = l.id === lang;
      return <Animated.View key={l.id} entering={still || !stagger ? undefined : FadeInDown.duration(260).delay(140 + i * 40).easing(EASE_OUT)}>
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={l.label} onPress={() => pick(l.id)}
          style={({ pressed }) => ({ minHeight: 60, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, borderRadius: 22, borderCurve: "continuous",
            backgroundColor: on ? palette.card : "transparent", borderWidth: 1, borderColor: on ? palette.line : "transparent", transform: [{ scale: pressed ? 0.97 : 1 }] })}>
          <View style={{ flex: 1, gap: 1 }}>
            {/* Each language in its own words, so a patient finds theirs whatever is on screen now. */}
            <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: on ? "600" : "500", color: palette.ink }}>{l.label}</Text>
            {l.id !== lang && <Text style={{ ...type.footnote, color: palette.faint }}>{translate(l.id, "lang.title")}</Text>}
          </View>
          <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: on ? 0 : 1.5, borderColor: "#DADADA" }}>
            {on && <Animated.View entering={fade} style={{ position: "absolute", inset: 0, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark }}>
              <Icon name="check" size={15} color={palette.white} />
            </Animated.View>}
          </View>
        </Pressable>
      </Animated.View>;
    })}
  </>;
}
