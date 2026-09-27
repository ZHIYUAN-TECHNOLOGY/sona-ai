import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { accentSplit, CHANGE, takeSentence, type Group } from "@/features/discharge/lines";
import { useDischarge } from "@/features/discharge/row";
import { markTaken, Pill, useNextDose, useNow } from "@/features/doses";
import { dueNow } from "@/features/doses/model";
import { palette, type } from "@/lib/theme";
import { AccentText, Button, HoldButton } from "@/lib/ui";

const GROUPS: Group[] = ["new", "changed", "continue", "stopped"];
const big = { fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.9, color: palette.ink } as const;

/**
 * One medicine as a sheet (Lumi kit): the medicine drawn big, its name with the accent, what the stay
 * did to it, how to take it in one sentence and the full plan line. If a dose of it is due now, a hold
 * marks it taken right here; Close goes back to the list.
 */
export default function Medicine() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const { data, isLoading } = useDischarge();
  const now = useNow();
  const { dose } = useNextDose(now);
  const [took, setTook] = useState<string>();
  const insets = useSafeAreaInsets();
  const plan = data?.status === "discharged" ? data : undefined;
  const group = plan && GROUPS.find(g => plan.medicines[g].some(m => m.name === name));
  const med = group && plan.medicines[group].find(m => m.name === name);
  const due = dose && dose.name === name && dueNow(dose.dueAt, now) ? dose : undefined;
  const close = <View style={{ alignSelf: "stretch" }}><Button label="Close" onPress={() => router.back()} /></View>;
  const pad = { padding: 24, paddingTop: 32, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 14, alignItems: "center" } as const;

  if (!med) return <View style={pad}>
    {isLoading ? <ActivityIndicator color={palette.muted} />
      : <Text accessibilityRole="header" style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{name ? `${name} isn't in your plan.` : "This medicine isn't in your plan."} Ask your care team if you're unsure.</Text>}
    {close}
  </View>;

  const [head, tail] = accentSplit(med.name);
  const sentence = takeSentence(med);
  return <View style={pad}>
    <Pill name={med.name} size={150} />
    <View accessible accessibilityRole="header" accessibilityLabel={`${med.name}. ${CHANGE[group]}`} style={{ alignItems: "center", gap: 4 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" }}>
        <Text style={big}>{head}</Text>
        {tail ? <AccentText style={big}>{tail}</AccentText> : null}
      </View>
      <Text style={{ ...type.footnote, color: palette.muted }}>{CHANGE[group]}</Text>
    </View>
    <View style={{ alignSelf: "stretch", height: 1, backgroundColor: palette.line }} />
    <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>
      {sentence.map((r, i) => <Text key={i} style={r.bold ? { fontWeight: "700", color: palette.ink } : undefined}>{r.text}</Text>)}
    </Text>
    {/* Without a schedule the sentence already is the plan line. */}
    {med.at?.length ? <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{med.line}</Text> : null}
    {(due || took) && <View style={{ alignSelf: "stretch", marginTop: 6 }}>
      <HoldButton key={due?.key ?? took} done={!!took} label="Hold to mark as taken" doneLabel={`${med.name} taken`}
        onDone={() => { if (!due) return; markTaken(due.key); setTook(due.key); }} />
    </View>}
    {close}
  </View>;
}
