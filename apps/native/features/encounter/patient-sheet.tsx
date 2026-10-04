import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { Press } from "@/components/sona/parts";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Icon, useAccessibleEffects } from "@/components/sona/ui";
import { CareMessages } from "@/features/care-messages";
import { CheckInThread } from "@/features/check-ins/thread";
import { confirmedAllergy, patientFlags, unconfirmedOf, type Go } from "@/features/day/counts";
import { testInSentence } from "@/features/day/model";
import { usePendingResult } from "@/features/day/use-counts";
import { AccessTrail, useRole } from "@/features/live/roles";
import { useServerEncounter } from "@/features/live/sync";
import { QuickActions } from "@/components/sona/quick-actions";
import { visitActions } from "./quick-actions";
import { PIN_LIMIT } from "@/features/patients/continue";
import { pin, replaceOldest, unpin, useContinueState } from "@/features/patients/continue-store";
import { useEncounter } from "./store";
import type { Patient } from "./types";

/*
 * Patient sheet (after Must's leaderboard profile sheet): tapping a patient row slides this sheet
 * up (spring 0.42 s, damping 0.82) over the dimmed list, then its sections rise in top to bottom
 * (60 ms apart): who and when, Open visit, the keys (each saying what needs attention there and
 * opening its fix), then the visit at a glance. Drag down past 120 pt or flick to dismiss (spring back 0.35 s, 0.8).
 */
export type { Go };

export function PatientSheet({ patient, onClose, onGo }: { patient: Patient; onClose: () => void; onGo: (go: Go) => void }) {
  const [box, setBox] = useState(0);
  const { encounters } = useEncounter();
  const result = usePendingResult(patient.id); // the same result Today and Patients flag
  useServerEncounter(patient); // live mode: medicines and discharge as the server holds them
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const encounter = encounters[patient.id];
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

  const y = useSharedValue(height), drag = useSharedValue(0);
  useEffect(() => { y.set(reducedMotion ? withTiming(0, { duration: 200 }) : withSpring(0, { duration: 420, dampingRatio: 0.82 })); }, [reducedMotion, y]);
  const close = () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); y.set(withTiming(height, { duration: 260 })); setTimeout(onClose, 240); };
  const go = (target: Go) => { if (process.env.EXPO_OS === "ios") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onGo(target); };
  const pan = Gesture.Pan().activeOffsetY(10).onUpdate(e => { drag.set(Math.max(0, e.translationY)); })
    .onEnd(e => { if (drag.value > 120 || e.velocityY > 600) scheduleOnRN(close); else drag.set(withSpring(0, { duration: 350, dampingRatio: 0.8 })); });
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: y.value + drag.value }] }));
  const dim = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - (y.value + drag.value) / height) }));
  const rise = (i: number) => reducedMotion ? undefined : riseIn({ delay: 140 + i * 60, distance: 25 + i * 5, duration: 420 });

  // The sheet stops below the list header so its back button never shows through.
  return <View style={StyleSheet.absoluteFill} onLayout={e => setBox(e.nativeEvent.layout.height)}>
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(20,28,40,0.3)" }, dim]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close patient" onPress={close} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <GestureDetector gesture={pan}>
      <Animated.View accessibilityViewIsModal onAccessibilityEscape={close} style={[{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: box ? box - 72 : height * 0.6, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderCurve: "continuous", backgroundColor: palette.canvas, boxShadow: "0 -8px 30px rgba(24,32,48,0.14)", paddingBottom: Math.max(insets.bottom, 16) }, sheet]}>
        {/* The grabber is the sheet's Close, so VoiceOver finds it inside the sheet (the backdrop is outside the modal region). */}
        <Pressable accessibilityRole="button" accessibilityLabel="Close patient" onPress={close} hitSlop={{ top: 10, bottom: 18, left: 40, right: 40 }} style={{ alignSelf: "center", marginTop: 10 }}><View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: "rgba(20,28,40,0.18)" }} /></Pressable>
        {/* Keyboard-aware so the Sona Care reply box stays above the keyboard while the doctor types. */}
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: 18, gap: 18 }} showsVerticalScrollIndicator={false}>
          <Animated.View entering={rise(0)} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: patient.incomplete ? "rgba(196,120,20,0.16)" : "rgba(36,91,204,0.14)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ ...type.heading, fontWeight: "700", color: patient.incomplete ? palette.amber : palette.blue }}>{patient.initials}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{patient.name}</Text>
              <Text style={{ ...type.footnote, color: palette.muted }}>{patient.age} · {patient.sex} · {patient.id}</Text>
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
          <CareMessages patient={patient} entering={rise(3)} />

          <Animated.View entering={rise(3)} style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, padding: 16, gap: 12 }}>
            <View style={{ gap: 3 }}>
              <Text style={{ ...type.overline, color: palette.muted }}>{patient.subtitle}</Text>
              <Text style={{ ...type.callout, color: palette.ink }}>{patient.complaint}</Text>
            </View>
            {patient.vitals.length > 0 ? <View style={{ flexDirection: "row", gap: 8 }}>
              {patient.vitals.map(v => { const raised = v.label === "Temp" && parseFloat(v.value) >= 37.8; return <View key={v.label} style={{ flex: 1, borderRadius: radius.control, padding: 10, gap: 2, backgroundColor: raised ? "rgba(196,120,20,0.10)" : "rgba(20,28,40,0.04)" }}>
                <Text style={{ ...type.caption, color: palette.muted }}>{v.label}</Text>
                <Text style={{ ...type.headline, color: raised ? palette.amber : palette.ink, fontVariant: ["tabular-nums"] }}>{v.value}</Text>
              </View>; })}
            </View> : <Text style={{ ...type.footnote, color: palette.muted }}>No observations recorded yet.</Text>}
            <Text style={{ ...type.footnote, color: palette.muted }}>{patient.history[0]} · Medicines: {patient.medicines.length}</Text>
          </Animated.View>

          <Pressable accessibilityRole="link" onPress={() => { onClose(); router.push({ pathname: "/source", params: { id: "history", patientId: patient.id } }); }} hitSlop={8} style={{ alignSelf: "center", minHeight: 36, justifyContent: "center" }}>
            <Text style={{ ...type.footnote, color: palette.blue }}>Full history & sources</Text>
          </Pressable>

          {/* PDPA: who opened this record (doctors and management, live mode). */}
          <AccessTrail patientId={patient.id} encounterId={patient.encounterId} entering={rise(4)} />
        </KeyboardAwareScrollView>
      </Animated.View>
    </GestureDetector>
  </View>;
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
