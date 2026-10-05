import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Keyboard, Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { Press } from "@/components/sona/parts";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Expand, Icon, useAccessibleEffects } from "@/components/sona/ui";
import { CareMessages } from "@/features/care-messages";
import { CheckInThread } from "@/features/check-ins/thread";
import { confirmedAllergy, patientFlags, unconfirmedOf, type Go } from "@/features/day/counts";
import { testInSentence } from "@/features/day/model";
import { useDayPatients, usePendingResult } from "@/features/day/use-counts";
import { JUDGE } from "@/features/live";
import { AccessTrail, useRole } from "@/features/live/roles";
import { useServerEncounter } from "@/features/live/sync";
import { QuickActions } from "@/components/sona/quick-actions";
import { visitActions } from "./quick-actions";
import { PIN_LIMIT } from "@/features/patients/continue";
import { pin, replaceOldest, unpin, useContinueState } from "@/features/patients/continue-store";
import { openVisitFromCard, usePreloadVisit } from "./navigation";
import { HistoryFacts } from "./source-screen";
import { useEncounter } from "./store";
import type { Patient } from "./types";

/**
 * A patient's card, a page pushed over Patients (app/patients): back returns to the list as it was left. Its actions push
 * over it (./navigation), so back from a visit returns here, carrying what Patients was opened to do (a question, a tool,
 * a switch from another visit).
 */
export function PatientCardScreen() {
  const { id, next, view, prompt, switch: switching } = useLocalSearchParams<{ id: string; next?: string; view?: string; prompt?: string; switch?: string }>();
  const { patients, patient: current, encounter, updateEncounter } = useEncounter();
  const day = useDayPatients(patients);
  const navigation = useNavigation();
  usePreloadVisit(id); // the visit this card opens, built while the card sits still
  const picked = patients.find(p => p.id === id);
  if (!picked) return null;
  // Today's appointment time, as the row showed it: the judge build's roster carries no clock time of its own.
  const patient = { ...picked, time: day.find(d => d.id === id)?.time ?? picked.time };
  const select = (go: Go) => {
    // Switching from a session replaces it; a pending question or tool page runs once the visit is open.
    const proceed = () => { if (go.to) router.push(go.to); else openVisitFromCard(navigation, patient.id, { next: go.next ?? next, prompt: go.next ? undefined : prompt, view: go.view ?? view }, switching === "1"); };
    if (patient.id !== current?.id && (encounter?.recording === "recording" || encounter?.recording === "paused")) {
      Alert.alert("Stop this consultation?", "Stop the current playback before switching patients. Your transcript and note will be kept.", [{ text: "Keep this patient", style: "cancel" }, { text: "Stop & switch", onPress: () => { updateEncounter(c => ({ ...c, recording: "stopped" })); proceed(); } }]);
    } else proceed();
  };
  return <><Stack.Screen options={{ title: patient.name }} /><PatientCard patient={patient} onGo={select} /></>;
}

/**
 * The card's sections rise in top to bottom (60 ms apart) as it arrives: who and when, Open visit, the keys (each saying
 * what needs attention there and opening its fix), then the visit at a glance.
 */
function PatientCard({ patient, onGo }: { patient: Patient; onGo: (go: Go) => void }) {
  const { encounters } = useEncounter();
  const result = usePendingResult(patient.id); // the same result Today and Patients flag
  useServerEncounter(patient); // live mode: medicines and discharge as the server holds them
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const encounter = encounters[patient.id];
  const [history, setHistory] = useState(false);
  const flags = patientFlags(patient, unconfirmedOf(patient, encounter), result, encounter);
  // Doctors also get "Scan note" (full width under the grid); it opens the visit with the scan on top.
  const visit = visitActions(patient, encounter, result, kind => go(kind === "recording" || kind === "scan" ? { view: kind } : { next: kind }), useRole().can("scan.read"));
  // What Today and Patients flag is said once, on the key that fixes it (no chips repeating the
  // keys): the result's value on Brief me, the allergy (or that it is unknown) on Medicines until a clinician records it.
  const resultLine = result?.patientId === patient.id ? `${result.flag} ${testInSentence(result.test)} ${result.value}` : undefined;
  const recorded = Boolean(confirmedAllergy(encounter));
  const allergy = patient.allergies && !recorded ? `${patient.allergies.split(" — ")[0]} allergy` : undefined;
  const keys = visit.slice(0, 3).map(a => a.key === "brief" && resultLine ? { ...a, status: resultLine }
    : a.key === "meds" && patient.incomplete && !recorded ? { ...a, status: "Allergies unknown" }
    : a.key === "meds" && allergy ? { ...a, status: `${allergy} · ${a.status}`, tone: "caution" as const } : a);
  const started = Boolean(encounter?.requests.length);
  const [h, m] = patient.time.split(":").map(Number);
  const now = new Date(), minutes = h! * 60 + m! - (now.getHours() * 60 + now.getMinutes());
  // No appointment today (a ward patient in the judge build) has no time to count from.
  const when = started ? "In progress" : !patient.time ? "" : minutes > 0 ? `Starts in ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`}` : minutes > -10 ? "Due now" : `Running ${-minutes} min late`;

  // The judge build's records can hold no medicines list at all: an empty one is left out, not counted as "Medicines: 0".
  const summary = [patient.history[0], JUDGE && !patient.medicines.length ? "" : `Medicines: ${patient.medicines.length}`].filter(Boolean).join(" · ");

  // Opened from a search, the list's keyboard would stay up over the card (the list keeps it through a row's tap, so the
  // tap lands): it goes as the card arrives. The reply box inside raises its own when tapped.
  useEffect(() => { Keyboard.dismiss(); }, []);
  const go = (target: Go) => { if (process.env.EXPO_OS === "ios") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onGo(target); };
  const rise = (i: number) => reducedMotion ? undefined : riseIn({ delay: 140 + i * 60, distance: 25 + i * 5, duration: 420 });

  // Keyboard-aware so the Sona Care reply box stays above the keyboard while the doctor types.
  return <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: palette.canvas }}
    contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) + 20, gap: 18 }} showsVerticalScrollIndicator={false}>
    <Animated.View entering={rise(0)} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: patient.incomplete ? "rgba(196,120,20,0.16)" : "rgba(36,91,204,0.14)", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ ...type.heading, fontWeight: "700", color: patient.incomplete ? palette.amber : palette.blue }}>{patient.initials}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{patient.name}</Text>
        <Text style={{ ...type.footnote, color: palette.muted }}>{[patient.age, patient.sex, patient.id].filter(part => part != null && part !== "").join(" · ")}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={{ ...type.heading, color: palette.ink, fontVariant: ["tabular-nums"] }}>{patient.time}</Text>
        <Text style={{ ...type.caption, fontWeight: "600", color: started ? palette.blue : minutes < -10 ? palette.amber : palette.muted }}>{when}</Text>
      </View>
    </Animated.View>

    {/* Who, the main action, then the keys (each with what needs attention there); everything below is context. */}
    <Animated.View entering={rise(1)}><Action label={started ? "Continue visit" : "Open visit"} icon="arrow.right" accessibilityLabel={`${started ? "Continue" : "Open"} visit with ${patient.name}`} onPress={() => go({})} /></Animated.View>
    <Animated.View entering={rise(1)}><PinControl patient={patient} /></Animated.View>
    <Animated.View entering={rise(2)}>
      <QuickActions animate={false} actions={[...keys,
        { key: "handover", label: "Hand over", icon: "arrow.left.arrow.right", status: flags.length ? `${flags.length} open ${flags.length === 1 ? "item" : "items"}` : "Nothing open", onPress: () => go({ to: "/handover" }) },
        ...visit.filter(a => a.key === "scan")]} />
    </Animated.View>

    <CheckInThread patient={patient} entering={rise(3)} />
    <CareMessages patient={patient} entering={rise(3)} onOpenThread={() => go({ to: `/inbox/${patient.id}` })} />

    <Animated.View entering={rise(3)} style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, padding: 16, gap: 12 }}>
      {/* A sparse record (a ward patient's) shows only what it holds: no empty overline, no blank line. */}
      {(patient.subtitle || patient.complaint) && <View style={{ gap: 3 }}>
        {patient.subtitle ? <Text style={{ ...type.overline, color: palette.muted }}>{patient.subtitle}</Text> : null}
        {patient.complaint ? <Text style={{ ...type.callout, color: palette.ink }}>{patient.complaint}</Text> : null}
      </View>}
      {patient.vitals.length > 0 ? <View style={{ flexDirection: "row", gap: 8 }}>
        {patient.vitals.map(v => { const raised = v.label === "Temp" && parseFloat(v.value) >= 37.8; return <View key={v.label} style={{ flex: 1, borderRadius: radius.control, padding: 10, gap: 2, backgroundColor: raised ? "rgba(196,120,20,0.10)" : "rgba(20,28,40,0.04)" }}>
          <Text style={{ ...type.caption, color: palette.muted }}>{v.label}</Text>
          <Text style={{ ...type.headline, color: raised ? palette.amber : palette.ink, fontVariant: ["tabular-nums"] }}>{v.value}</Text>
        </View>; })}
      </View> : <Text style={{ ...type.footnote, color: palette.muted }}>No observations recorded yet.</Text>}
      {summary ? <Text style={{ ...type.footnote, color: palette.muted }}>{summary}</Text> : null}
    </Animated.View>

    {/* In place: the history unfolds here rather than as a sheet over the card. */}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: history }} onPress={() => setHistory(o => !o)} hitSlop={8} style={{ alignSelf: "center", minHeight: 36, flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Text style={{ ...type.footnote, color: palette.blue }}>{history ? "Hide full history" : "Full history & sources"}</Text>
      <Icon name={history ? "chevron.up" : "chevron.down"} size={10} color={palette.blue} />
    </Pressable>
    {history && <Expand style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, padding: 16, gap: 10 }}><HistoryFacts patient={patient} /></Expand>}

    {/* PDPA: who opened this record (doctors and management, live mode). */}
    <AccessTrail patientId={patient.id} encounterId={patient.encounterId} entering={rise(4)} />
  </KeyboardAwareScrollView>;
}

/**
 * Pin to Continue, so this patient stays where you left off until unpinned. Pins are capped at 5: a
 * sixth shows which pin it would replace, and replaces it only when confirmed.
 */
function PinControl({ patient }: { patient: Patient }) {
  const { pins } = useContinueState();
  const { patients } = useEncounter();
  const [replace, setReplace] = useState<{ id: string }>();
  const pinned = pins.some(p => p.id === patient.id);
  const nameOf = (id: string) => patients.find(p => p.id === id)?.name ?? id;
  if (replace) return <View style={{ gap: 10, padding: 12, borderRadius: radius.group, backgroundColor: "rgba(196,120,20,0.10)" }}>
    <Text style={{ ...type.subhead, color: palette.ink }}>You have {PIN_LIMIT} pins, the most allowed. Replace your oldest pin, <Text style={{ fontWeight: "700" }}>{nameOf(replace.id)}</Text>, with {patient.name.split(" ")[0]}?</Text>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ flex: 1 }}><Action label="Cancel" secondary onPress={() => setReplace(undefined)} /></View>
      <View style={{ flex: 1 }}><Action label="Replace" onPress={() => { replaceOldest(replace.id, patient.id); setReplace(undefined); }} /></View>
    </View>
  </View>;
  return <Press accessibilityLabel={pinned ? `Unpin ${patient.name} from Continue` : `Pin ${patient.name} to Continue`} onPress={() => { if (pinned) unpin(patient.id); else { const oldest = pin(patient.id); if (oldest) setReplace(oldest); } }}
    style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
    <Icon name={pinned ? "pin.slash" : "pin"} size={14} color={palette.blue} />
    <Text style={{ ...type.subhead, fontWeight: "600", color: palette.blue }}>{pinned ? "Pinned to Continue · Unpin" : "Pin to Continue"}</Text>
  </Press>;
}
