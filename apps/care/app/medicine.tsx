import { router, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { changeOf, takeSentence, type Group } from "@/features/discharge/lines";
import { Tag, useDischarge } from "@/features/discharge/row";
import { markTaken, Pill, useNextDose, useNow } from "@/features/doses";
import { dueNow } from "@/features/doses/model";
import "@/features/doses/strings";
import { tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { motion, palette, type } from "@/lib/theme";
import { AccentText, Button, HoldButton, LoadError } from "@/lib/ui";

const GROUPS: Group[] = ["new", "changed", "continue", "stopped"];
const big = { fontSize: 32, lineHeight: 38, fontWeight: "600", letterSpacing: -1.6, color: palette.ink, textAlign: "center" } as const;

/**
 * One medicine as a white sheet (the kit's medicine sheet): the medicine drawn big, its name in the
 * headline gradient, the plan's own line faint, then how to take it as one sentence with the dose and
 * the times in ink, and what the stay did to it as a capsule. If a dose of it is due now, a hold marks
 * it taken right here. Rows spring up 40 ms apart as the sheet rises (after Canopi); Close goes back.
 */
export default function Medicine() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const discharge = useDischarge(), { data, isLoading } = discharge;
  const now = useNow();
  const lang = useLang(), t = tFor(lang);
  const { dose } = useNextDose(now);
  const [took, setTook] = useState<string>();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const plan = data?.status === "discharged" ? data : undefined;
  const group = plan && GROUPS.find(g => plan.medicines[g].some(m => m.name === name));
  const med = group && plan.medicines[group].find(m => m.name === name);
  const due = dose && dose.name === name && dueNow(dose.dueAt, now) ? dose : undefined;
  const close = <View style={{ alignSelf: "stretch", marginTop: 6 }}><Button label={t("common.close")}onPress={() => router.back()} /></View>;
  const pad = { padding: 24, paddingTop: 28, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 14 } as const;
  const rows = (items: ReactNode[]) => <View style={pad}>
    {/* Keyed by position (empty slots kept), so the hold appearing doesn't remount and replay Close. */}
    {items.map((item, i) => item ? <Animated.View key={i} style={{ alignItems: "center" }}
      entering={reduced ? undefined : FadeInDown.springify().duration(motion.spring.duration).dampingRatio(1).delay(60 + i * motion.stagger)}>{item}</Animated.View> : null)}
  </View>;

  if (!med) return rows([
    isLoading ? <ActivityIndicator color={palette.muted} />
      : !data && discharge.error ? <LoadError query={discharge} style={{ alignSelf: "stretch" }} />
      : <Text accessibilityRole="header" style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{name ? t("dose.notInPlan", { name }) : t("dose.thisNotInPlan")} {t("dose.askIfUnsure")}</Text>,
    close,
  ]);

  return rows([
    <Pill name={med.name} size={150} />,
    <View accessible accessibilityRole="header" accessibilityLabel={`${med.name}. ${med.at?.length ? med.line : ""}`} style={{ alignItems: "center", gap: 4 }}>
      <AccentText style={big}>{med.name}</AccentText>
      {/* Without a schedule the sentence below already is the plan line. */}
      {med.at?.length ? <Text style={{ ...type.footnote, color: palette.faint, textAlign: "center" }}>{med.line}</Text> : null}
    </View>,
    <View style={{ alignSelf: "stretch", height: 1, backgroundColor: palette.line }} />,
    <Text style={{ fontSize: 20, lineHeight: 28, letterSpacing: -0.5, color: palette.faint, textAlign: "center" }}>
      {takeSentence(med, lang).map((r, i) => <Text key={i} style={r.bold ? { fontWeight: "600", color: palette.ink } : undefined}>{r.text}</Text>)}
    </Text>,
    <Tag group={group} label={changeOf(group, lang)} />,
    (due || took) && <View style={{ alignSelf: "stretch", marginTop: 6 }}>
      <HoldButton key={due?.key ?? took} done={!!took} label={t("dose.hold")} doneLabel={t("dose.taken", { name: med.name })}
        onDone={() => { if (!due) return; markTaken(due.key); setTook(due.key); }} />
    </View>,
    close,
  ]);
}
