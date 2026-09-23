import { Text } from "@/components/sona/text";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { Action, Body, Card, Icon, Label, Screen, SourceLink } from "@/components/sona/ui";
import { palette } from "@/components/sona/theme";
import { useEncounter } from "./store";
import { capabilitySchema } from "./state";

export function PatientScreen() {
  const { patients, patient, encounter, selectPatient, updateEncounter, request } = useEncounter();
  const { next, view, prompt } = useLocalSearchParams<{ next?: string; view?: string; prompt?: string }>();
  const [expanded, setExpanded] = useState<string>();
  const [empty, setEmpty] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = (empty ? [] : patients).filter(p => `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase()));
  const select = (id: string) => {
    const proceed = () => { selectPatient(id); router.back(); if (view === "recording" || view === "xray" || view === "note" || view === "tasks") setTimeout(() => router.push(`/${view}`), 250); else { const parsed = capabilitySchema.safeParse(next); if (parsed.success) request(parsed.data, prompt); } };
    if (id !== patient?.id && (encounter?.recording === "recording" || encounter?.recording === "paused")) {
      Alert.alert("Stop this consultation?", "Stop the current playback before switching patients. Your transcript and note will be kept.", [{ text: "Keep this patient", style: "cancel" }, { text: "Stop & switch", onPress: () => { updateEncounter(current => ({ ...current, recording: "stopped" })); proceed(); } }]);
    } else proceed();
  };
  return <Screen><Label>Hospital outpatient · demo records</Label><Body muted>Choose the patient for this conversation. All records here are fictional.</Body>
    <View style={{ borderRadius: 18, backgroundColor: palette.surface, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}><Icon name="magnifyingglass" color={palette.muted} size={18} /><TextInput accessibilityLabel="Search patients" placeholder="Name or patient ID" value={query} onChangeText={setQuery} placeholderTextColor={palette.muted} style={{ flex: 1, minHeight: 52, color: palette.ink, fontSize: 16 }} autoCorrect={false} /></View>
    {!filtered.length && <Card title={empty ? "No records loaded" : "No matching patients"}><Body muted>{empty ? "The demo records are hidden for this empty-state preview." : "Try a different name or synthetic patient ID."}</Body>{empty && <Action label="Load demo records" secondary onPress={() => setEmpty(false)} />}</Card>}
    {filtered.map(p => <Card key={p.id}><View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}><View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: "#E1EAF8", alignItems: "center", justifyContent: "center" }}><Text style={{ color: palette.blue, fontWeight: "600" }}>{p.initials}</Text></View><View style={{ flex: 1, gap: 4 }}><Text style={{ fontSize: 19, fontWeight: "600", color: palette.ink }}>{p.name}</Text><Text style={{ color: palette.muted, fontSize: 13 }}>{p.age} years · {p.sex} · {p.id}</Text></View><Text style={{ color: palette.muted, fontSize: 12 }}>{p.time}</Text></View><Body>{p.subtitle}</Body><Action label={expanded === p.id ? "Hide patient details" : "Patient details"} secondary onPress={() => setExpanded(expanded === p.id ? undefined : p.id)} />{expanded === p.id && <View style={{ gap: 12 }}><Label>22 Sep 2026 · {p.time}</Label><Body>{p.complaint}</Body><Body>Medical: {p.history.join(". ")}</Body><Body>Family: {p.family}</Body><Body>Social: {p.social}</Body><Body>Allergies: {p.allergies ?? "Not documented"}</Body><Body>Medicines: {p.medicines.join("; ")}</Body><Body>Observations: {p.vitals.length ? p.vitals.map(v => `${v.label} ${v.value}`).join(" · ") : "Not recorded"}</Body><SourceLink label="Patient history source" onPress={() => router.push({ pathname: "/source", params: { id: "history", patientId: p.id } })} /></View>}<Action label={patient?.id === p.id ? "Continue encounter" : "Open encounter"} secondary onPress={() => select(p.id)} /></Card>)}
    {!empty && <Action label="Preview no records loaded" secondary onPress={() => setEmpty(true)} />}
  </Screen>;
}
