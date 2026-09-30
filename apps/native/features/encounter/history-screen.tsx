import { setCensus, useContinueState } from "@/features/patients/continue-store";
import { Text } from "@/components/sona/text";
import { Host, Switch } from "@expo/ui";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Alert, TextInput, View } from "react-native";
import { Action, Body, Card, Expand, Icon, Notice, Screen } from "@/components/sona/ui";
import { Press } from "@/components/sona/parts";
import { palette, type, radius } from "@/components/sona/theme";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";
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

export function HistoryScreen() {
  const { census } = useContinueState();
  const { on: live } = useLive();
  const { patients, simulateFailure, setSimulateFailure, reset, voiceInput, setVoiceInput, compactResponses, setCompactResponses, simulateInvalid, setSimulateInvalid, showDemoControls, setShowDemoControls, updateEncounter } = useEncounter();
  // Rehearsal: the synthetic insurer denies the demo patient's final GL (as sent, so the fixes are in); the appeal is then on the letter.
  const denyGl = () => {
    const demo = patients.find(p => p.id === DEMO_PATIENT);
    if (!demo) return;
    void insurerDenies(live, demo.encounterId, denial => updateEncounter(value => ({ ...value,
      claim: { ...EMPTY_CLAIM, ...value.claim, organismConfirmed: true, ivReasonAdded: true, status: "denied", denial, approvedAt: undefined },
      discharge: { ...EMPTY_DISCHARGE, ...value.discharge, glReceived: false } }), false, demo.id))
      .then(() => router.back(), e => Alert.alert("Not denied", errorText(e)));
  };
  // Settings holds only settings; the presenter's demo tools wait behind one row. Recent visits live in the sidebar's Continue.
  return <Screen><LiveCard /><LibraryCard /><Card title="Input & responses"><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Allow short voice commands" value={voiceInput} onValueChange={setVoiceInput} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Collapse earlier responses" value={compactResponses} onValueChange={setCompactResponses} /></Host><Body muted>Text entry stays available. Voice input uses a labelled sample. Text size follows your iPhone setting.</Body></Card><Card title="Colour key"><TermLegend /><Body muted>Key words in answers and cards are tinted so the eye lands on them first. Red is anything that must not be missed: allergies, severe disease and abnormal results.</Body></Card><Card title="About this workspace"><Body>Conversations, notes and tasks stay in this app session and reset when the app reloads.</Body><Body muted>English clinical output. The consultation includes an optional authored Manglish sample.</Body><Notice>Accessibility follows your iPhone's text size, Reduce Motion and Reduce Transparency settings.</Notice></Card><DemoTools><DemoClockCard /><Card label="Developer fixture controls" title="Rehearse an interruption"><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Show demo controls in answers" value={showDemoControls} onValueChange={setShowDemoControls} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Large census (106 synthetic patients)" value={census} onValueChange={setCensus} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Interrupt response stream" value={simulateFailure} onValueChange={setSimulateFailure} /></Host><Host colorScheme="light" seedColor={palette.blue} style={{ height: 44 }}><Switch label="Unsupported response component" value={simulateInvalid} onValueChange={setSimulateInvalid} /></Host>{showDemoControls && <Action label="Insurer denies the GL" secondary accessibilityLabel="Insurer denies the guarantee letter. Rehearses a denial without the insurer's page" onPress={denyGl} />}<Action label="Simulate a critical result" secondary onPress={() => { void simulateCriticalResult(live).then(() => router.back(), () => Alert.alert("Not sent", "The server did not accept the simulated result.")); }} /><Action label="Preview unavailable evidence" secondary onPress={() => router.push({ pathname: "/source", params: { id: "missing", patientId: patients[0]!.id } })} /><Body muted>Interrupting shows the next request's failure and retry.</Body><Action label="Reset demo session" secondary onPress={() => Alert.alert("Reset this demo?", "This clears all local transcripts, notes, results and tasks in this session.", [{ text: "Keep session", style: "cancel" }, { text: "Reset demo", style: "destructive", onPress: () => { reset(); router.back(); } }])} /></Card></DemoTools></Screen>;
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
    {user ? <Action label="Sign out" secondary onPress={() => { void authClient.signOut().then(() => queryClient.refetchQueries()); }} /> : <SignIn />}
  </Card>;
}

/** Sign in to the hospital record: email and password, one action, and the server's reason if it refuses. */
function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = /\S+@\S+\.\S+/.test(email.trim()) && password.length > 0 && !busy;
  const submit = () => {
    if (!ready) return;
    setBusy(true); setError(undefined);
    void authClient.signIn.email({ email: email.trim(), password }, {
      onError: e => { setError(e.error?.message || "Couldn’t sign in. Check the email and password."); setBusy(false); },
      onSuccess: () => { setPassword(""); setBusy(false); void queryClient.refetchQueries(); },
    });
  };
  const field = { minHeight: 48, borderRadius: radius.control, paddingHorizontal: 14, backgroundColor: palette.surface, ...type.body, lineHeight: undefined, color: palette.ink } as const;
  return <View style={{ gap: 10 }}>
    <TextInput accessibilityLabel="Email" placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" placeholderTextColor={palette.placeholder} style={field} />
    <TextInput accessibilityLabel="Password" placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} placeholderTextColor={palette.placeholder} style={field} />
    {error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    <Action label={busy ? "Signing in…" : "Sign in"} disabled={!ready} onPress={submit} />
  </View>;
}

/** The presenter's tools (demo clock, large census, interruptions, reset), folded behind one row. */
function DemoTools({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 12 }}>
    <Press expanded={open} onPress={() => setOpen(v => !v)} style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderRadius: radius.group, backgroundColor: "rgba(255,255,255,0.6)" }}>
      <Icon name="wrench.and.screwdriver" size={15} color={palette.muted} />
      <Text style={{ ...type.callout, flex: 1, color: palette.ink }}>Demo tools <Text style={{ color: palette.muted }}>· clock, census, interruptions, reset</Text></Text>
      <Icon name={open ? "chevron.up" : "chevron.down"} size={12} color={palette.muted} />
    </Press>
    {open && <Expand style={{ gap: 18 }}>{children}</Expand>}
  </View>;
}
