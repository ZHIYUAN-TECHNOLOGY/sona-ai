import { Text } from "@/components/sona/text";
import { router, useLocalSearchParams } from "expo-router";
import { Fragment, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { riseIn } from "@/components/sona/motion";
import { Body, Card, Icon, Insight, Screen, Tone, useAccessibleEffects } from "@/components/sona/ui";
import { palette, type } from "@/components/sona/theme";
import { defaultMedications } from "./clinical-state";
import { flagsFor, PatientSheet, type Go } from "./patient-sheet";
import { useEncounter } from "./store";
import { openSession } from "./navigation";

export function PatientScreen() {
  const { patients, patient, encounter, encounters, updateEncounter } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const { next, view, prompt, switch: switching } = useLocalSearchParams<{ next?: string; view?: string; prompt?: string; switch?: string }>();
  const [open, setOpen] = useState<string>();
  const [query, setQuery] = useState("");
  const filtered = patients.filter(p => `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase()));
  const select = (id: string, go: Go = {}) => {
    // Choosing a patient opens their session (switching from a session replaces it); a pending
    // question or tool page is carried along and runs once the visit is open.
    const proceed = () => { router.back(); setTimeout(() => go.to ? router.push(go.to) : openSession(id, { next: go.next ?? next, prompt: go.next ? undefined : prompt, view: go.view ?? view }, switching === "1"), 250); };
    if (id !== patient?.id && (encounter?.recording === "recording" || encounter?.recording === "paused")) {
      Alert.alert("Stop this consultation?", "Stop the current playback before switching patients. Your transcript and note will be kept.", [{ text: "Keep this patient", style: "cancel" }, { text: "Stop & switch", onPress: () => { updateEncounter(current => ({ ...current, recording: "stopped" })); proceed(); } }]);
    } else proceed();
  };
  // One line per patient; tapping opens the patient sheet with what needs attention and the actions.
  const status = (p: typeof patients[number]) => encounters[p.id]?.requests.length ? { label: "In progress", color: palette.blue } : p.incomplete ? { label: "History to complete", color: palette.amber } : { label: p.subtitle, color: palette.muted };
  const chosen = patients.find(p => p.id === open);
  // Insight: the same attention flags the sheet shows, and the first visit not yet started.
  const attention = patients.filter(p => flagsFor(p, (encounters[p.id]?.medicationEntries ?? defaultMedications(p)).filter(m => !m.confirmed).length).length).length;
  const upNext = [...patients].sort((x, y) => x.time.localeCompare(y.time)).find(p => !encounters[p.id]?.requests.length);
  const insight = [patients.length ? `${patients.length} ${patients.length === 1 ? "visit" : "visits"} today` : "No visits today", attention ? <Tone key="attention" of="urgent">{attention} {attention === 1 ? "needs" : "need"} attention</Tone> : null, upNext ? <Fragment key="next">next <Tone of="next">{upNext.name.split(" ")[0]} at {upNext.time}</Tone></Fragment> : null].filter(Boolean);
  return <View style={{ flex: 1 }}><Screen><Insight>{insight.map((part, i) => [i ? " · " : "", part])}</Insight>
    <View style={{ borderRadius: 18, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}><Icon name="magnifyingglass" color={palette.muted} size={18} /><TextInput accessibilityLabel="Search patients" placeholder="Name or patient ID" value={query} onChangeText={setQuery} placeholderTextColor={palette.muted} style={{ flex: 1, minHeight: 52, color: palette.ink, fontSize: 16 }} autoCorrect={false} /></View>
    {!filtered.length && <Card title="No matching patients"><Body muted>Try a different name or patient ID.</Body></Card>}
    {filtered.length > 0 && <View style={{ borderRadius: 22, borderCurve: "continuous", backgroundColor: palette.white, overflow: "hidden" }}>
      {[...filtered].sort((x, y) => x.time.localeCompare(y.time)).map((p, i) => { const s = status(p); return <Animated.View key={p.id} entering={reducedMotion ? undefined : riseIn({ delay: i * 50, distance: 8, duration: 300 })}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.time}, ${s.label}`} accessibilityHint="Shows the patient summary and actions" onPress={() => setOpen(p.id)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: "rgba(20,28,40,0.06)", backgroundColor: pressed ? "rgba(20,28,40,0.04)" : "transparent" })}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.incomplete ? "rgba(196,120,20,0.16)" : "rgba(36,91,204,0.14)", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 13, fontWeight: "700", color: p.incomplete ? palette.amber : palette.blue }}>{p.initials}</Text></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.subhead, fontWeight: "600", color: palette.ink }}>{p.name}{patient?.id === p.id ? <Text style={{ fontWeight: "500", color: palette.blue }}>  · current</Text> : null}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.color }} /><Text numberOfLines={1} style={{ flex: 1, ...type.caption, color: s.color === palette.muted ? palette.muted : s.color, fontWeight: "500" }}>{s.label}</Text></View>
          </View>
          <Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{p.time}</Text>
          <Icon name="chevron.right" size={12} color={palette.muted} />
        </Pressable>
      </Animated.View>; })}
    </View>}
  </Screen>
  {chosen && <PatientSheet key={chosen.id} patient={chosen} onClose={() => setOpen(undefined)} onGo={go => select(chosen.id, go)} />}
  </View>;
}
