import { Text } from "@/components/sona/text";
import { Host, Switch } from "@expo/ui";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { Action, Body, Card, Label, Notice, Screen } from "@/components/sona/ui";
import { palette } from "@/components/sona/theme";
import { TermLegend } from "@/components/sona/marked-text";
import { simulateCriticalResult } from "@/features/critical";
import { errorText, setLive, useLive } from "@/features/live";
import { EMPTY_CLAIM } from "@sona-ai/domain/claim";
import { EMPTY_DISCHARGE } from "@sona-ai/domain/discharge";
import { DEMO_PATIENT } from "@sona-ai/domain/ward";
import { insurerDenies } from "@/features/claim/appeal";
import { useLiveStatus } from "@/features/live/channel";
import { DemoClockCard } from "@/features/live/demo-clock";
import { LibraryCard } from "@/features/library/library-card";
import { RolePill, useRole } from "@/features/live/roles";
import { useEncounter } from "./store";
import { openSession } from "./navigation";

export function HistoryScreen() {
  const { on: live } = useLive();
  const { patients, encounters, simulateFailure, setSimulateFailure, reset, encounter, voiceInput, setVoiceInput, compactResponses, setCompactResponses, simulateInvalid, setSimulateInvalid, showDemoControls, setShowDemoControls, updateEncounter } = useEncounter();
  // Rehearsal: the synthetic insurer denies the demo patient's final GL (as sent, so the fixes are in); the appeal is then on the letter.
  const denyGl = () => {
    const demo = patients.find(p => p.id === DEMO_PATIENT);
    if (!demo) return;
    void insurerDenies(live, demo.encounterId, denial => updateEncounter(value => ({ ...value,
      claim: { ...EMPTY_CLAIM, ...value.claim, organismConfirmed: true, ivReasonAdded: true, status: "denied", denial, approvedAt: undefined },
      discharge: { ...EMPTY_DISCHARGE, ...value.discharge, glReceived: false } }), false, demo.id))
      .then(() => router.back(), e => Alert.alert("Not denied", errorText(e)));
  };
  const recent = patients.filter(p => encounters[p.id]?.requests.length);
  return <Screen>{recent.length > 0 && <Card title="Recent encounters">{recent.map(p => <View key={p.id} style={{ gap: 8, paddingVertical: 10 }}><Text style={{ fontSize: 18, color: palette.ink, fontWeight: "500" }}>{p.name}</Text><Body muted>22 Sep 2026 · {p.time} · {p.id} · {encounters[p.id]!.requests.length} requests</Body><Action label={`Resume ${p.name}`} secondary onPress={() => { if ((encounter?.recording === "recording" || encounter?.recording === "paused")) { Alert.alert("Consultation in progress", "Stop the current playback before opening another encounter."); return; } router.back(); setTimeout(() => openSession(p.id), 250); }} /></View>)}</Card>}<Card title="Input & responses"><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Allow short voice commands" value={voiceInput} onValueChange={setVoiceInput} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Collapse earlier responses" value={compactResponses} onValueChange={setCompactResponses} /></Host><Body muted>Text entry stays available. Voice input uses a labelled sample. Text size follows your iPhone setting.</Body></Card><LiveCard /><DemoClockCard /><LibraryCard /><Card title="Colour key"><TermLegend /><Body muted>Key words in answers and cards are tinted so the eye lands on them first. Red is anything that must not be missed: allergies, severe disease and abnormal results.</Body></Card><Card title="About this workspace"><Body>Conversations, notes and tasks stay in this app session and reset when the app reloads.</Body><Body muted>English clinical output. The consultation includes an optional authored Manglish sample.</Body><Notice>Accessibility follows your iPhone's text size, Reduce Motion and Reduce Transparency settings.</Notice></Card><Card label="Developer fixture controls" title="Rehearse an interruption"><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Show demo controls in answers" value={showDemoControls} onValueChange={setShowDemoControls} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Interrupt response stream" value={simulateFailure} onValueChange={setSimulateFailure} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Unsupported response component" value={simulateInvalid} onValueChange={setSimulateInvalid} /></Host>{showDemoControls && <Action label="Insurer denies the GL" secondary accessibilityLabel="Insurer denies the guarantee letter. Rehearses a denial without the insurer's page" onPress={denyGl} />}<Action label="Simulate a critical result" secondary onPress={() => { void simulateCriticalResult(live).then(() => router.back(), () => Alert.alert("Not sent", "The server did not accept the simulated result.")); }} /><Action label="Preview unavailable evidence" secondary onPress={() => router.push({ pathname: "/source", params: { id: "missing", patientId: patients[0]!.id } })} /><Body muted>Interrupting shows the next request's failure and retry.</Body><Action label="Reset demo session" secondary onPress={() => Alert.alert("Reset this demo?", "This clears all local transcripts, notes, results and tasks in this session.", [{ text: "Keep session", style: "cancel" }, { text: "Reset demo", style: "destructive", onPress: () => { reset(); router.back(); } }])} /></Card></Screen>;
}

/** Switches the discharge, guarantee-letter, ward and audit screens to the live server. */
function LiveCard() {
  const { wanted, user } = useLive();
  const updates = useLiveStatus();
  const role = useRole();
  return <Card label="Connection" title="Hospital record">
    <Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Connect to the hospital record" value={wanted} onValueChange={setLive} /></Host>
    {user && <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}><Body>Signed in as {user.email}</Body>{role.known && <RolePill label={role.label} />}</View>}
    {!user && <Body muted>Sign in to use your hospital's records; until then Sona shows sample data.</Body>}
    {user && wanted && <Body muted>{updates === "connected" ? "Live updates connected." : updates === "connecting" ? "Connecting live updates…" : "Live updates off."}</Body>}
    {!user && <Action label="Sign in" secondary onPress={() => router.push("/account")} />}
  </Card>;
}
