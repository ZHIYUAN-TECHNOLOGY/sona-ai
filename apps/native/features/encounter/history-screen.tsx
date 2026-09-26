import { Text } from "@/components/sona/text";
import { Host, Switch } from "@expo/ui";
import { router } from "expo-router";
import { Alert, View } from "react-native";
import { Action, Body, Card, Label, Notice, Screen } from "@/components/sona/ui";
import { palette } from "@/components/sona/theme";
import { TermLegend } from "@/components/sona/marked-text";
import { setLive, useLive } from "@/features/live";
import { useEncounter } from "./store";
import { openSession } from "./navigation";

export function HistoryScreen() {
  const { patients, encounters, simulateFailure, setSimulateFailure, reset, encounter, voiceInput, setVoiceInput, compactResponses, setCompactResponses, simulateInvalid, setSimulateInvalid, showDemoControls, setShowDemoControls } = useEncounter();
  return <Screen><Label>Your workspace</Label><Card title="Recent encounters">{patients.filter(p => encounters[p.id]?.requests.length).map(p => <View key={p.id} style={{ gap: 8, paddingVertical: 10 }}><Text style={{ fontSize: 18, color: palette.ink, fontWeight: "500" }}>{p.name}</Text><Body muted>22 Sep 2026 · {p.time} · {p.id} · {encounters[p.id]!.requests.length} requests</Body><Action label={`Resume ${p.name}`} secondary onPress={() => { if ((encounter?.recording === "recording" || encounter?.recording === "paused")) { Alert.alert("Consultation in progress", "Stop the current playback before opening another encounter."); return; } router.back(); setTimeout(() => openSession(p.id), 250); }} /></View>)}{!patients.some(p => encounters[p.id]?.requests.length) && <Body muted>Your encounters will appear here after your first request.</Body>}</Card><Card title="Input & responses"><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Allow short voice commands" value={voiceInput} onValueChange={setVoiceInput} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Collapse earlier responses" value={compactResponses} onValueChange={setCompactResponses} /></Host><Body muted>Text entry stays available. Voice input uses a labelled fixture sample. Text size follows your iPhone setting.</Body></Card><LiveCard /><Card title="Colour key"><TermLegend /><Body muted>Key words in answers and cards are tinted so the eye lands on them first. Red is anything that must not be missed: allergies, severe disease and abnormal results.</Body></Card><Card title="About this workspace"><Body>This is a synthetic demonstration. Conversations, notes and tasks stay in this app session and reset when the app reloads.</Body><Body muted>English clinical output. The consultation includes an optional authored Manglish sample.</Body><Notice>Accessibility follows your iPhone's text size, Reduce Motion and Reduce Transparency settings.</Notice></Card><Card label="Developer fixture controls" title="Rehearse an interruption"><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Show demo controls in answers" value={showDemoControls} onValueChange={setShowDemoControls} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Interrupt response stream" value={simulateFailure} onValueChange={setSimulateFailure} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Unsupported response component" value={simulateInvalid} onValueChange={setSimulateInvalid} /></Host><Action label="Preview unavailable evidence" secondary onPress={() => router.push({ pathname: "/source", params: { id: "missing", patientId: patients[0]!.id } })} /><Body muted>When enabled, the next request will show the failure and retry experience. Turn it off to resume normal fixture responses.</Body><Action label="Reset demo session" secondary onPress={() => Alert.alert("Reset this demo?", "This clears all local transcripts, notes, results and tasks in this session.", [{ text: "Keep session", style: "cancel" }, { text: "Reset demo", style: "destructive", onPress: () => { reset(); router.back(); } }])} /></Card></Screen>;
}

/** Switches the discharge, guarantee-letter, ward and audit screens to the live server. */
function LiveCard() {
  const { wanted, user } = useLive();
  return <Card label="Backend" title="Live backend">
    <Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Use the live backend" value={wanted} onValueChange={setLive} /></Host>
    <Body muted>{user ? `Signed in as ${user.email}. Discharge, guarantee letter, ward owners and the coding audit use the server; everything else stays on fixtures.` : "Sign in first; until then every screen stays on fixtures."}</Body>
    {!user && <Action label="Sign in" secondary onPress={() => router.push("/account")} />}
  </Card>;
}
