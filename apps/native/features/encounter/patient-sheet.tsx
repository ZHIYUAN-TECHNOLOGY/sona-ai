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
import { palette, type } from "@/components/sona/theme";
import { Action, Icon, useAccessibleEffects } from "@/components/sona/ui";
import { CareMessages } from "@/features/care-messages";
import { CheckInThread } from "@/features/check-ins/thread";
import { PENDING_RESULT, testInSentence } from "@/features/day/model";
import { useServerData } from "@/features/live/server-day";
import { AccessTrail, useRole } from "@/features/live/roles";
import { useServerEncounter } from "@/features/live/sync";
import { defaultMedications } from "./clinical-state";
import { QuickActions } from "@/components/sona/quick-actions";
import { visitActions } from "./quick-actions";
import { useEncounter } from "./store";
import type { Patient } from "./types";

/*
 * Patient sheet (after Must's leaderboard profile sheet): tapping a patient row slides this sheet
 * up (spring 0.42 s, damping 0.82) over the dimmed list, then its sections rise in top to bottom
 * (60 ms apart): who and when, what needs attention (each chip jumps to its fix), the visit at a
 * glance, and the actions. Drag down past 120 pt or flick to dismiss (spring back 0.35 s, 0.8).
 */
export type Go = { next?: string; view?: string; to?: "/handover" };
type Flag = { label: string; tone: "urgent" | "caution"; go: Go };
const TONE = { urgent: { ink: palette.red, wash: "rgba(162,62,62,0.10)" }, caution: { ink: palette.amber, wash: "rgba(196,120,20,0.13)" } };

export function flagsFor(patient: Patient, unconfirmed: number): Flag[] {
  const flags: Flag[] = [];
  if (PENDING_RESULT.patientId === patient.id) flags.push({ label: `${PENDING_RESULT.flag} ${testInSentence(PENDING_RESULT.test)} ${PENDING_RESULT.value}`, tone: "urgent", go: { next: "briefing" } });
  if (patient.allergies) flags.push({ label: `${patient.allergies.split(" — ")[0]} allergy · confirm`, tone: "caution", go: { next: "medication" } });
  if (!patient.incomplete && unconfirmed) flags.push({ label: `${unconfirmed} ${unconfirmed === 1 ? "medicine" : "medicines"} unconfirmed`, tone: "caution", go: { next: "medication" } });
  if (patient.incomplete) flags.push({ label: "History incomplete", tone: "caution", go: { next: "reasoning" } }, { label: "Allergies unknown", tone: "caution", go: { view: "recording" } });
  return flags;
}

export function PatientSheet({ patient, onClose, onGo }: { patient: Patient; onClose: () => void; onGo: (go: Go) => void }) {
  const [box, setBox] = useState(0);
  const { encounters } = useEncounter();
  const server = useServerData();
  useServerEncounter(patient); // live mode: medicines and discharge as the server holds them
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  const encounter = encounters[patient.id];
  const unconfirmed = (encounter?.medicationEntries ?? defaultMedications(patient)).filter(m => !m.confirmed).length;
  const flags = flagsFor(patient, unconfirmed);
  // Doctors also get "Scan note" (full width under the grid); it opens the visit with the scan on top.
  const visit = visitActions(patient, encounter, server, kind => go(kind === "recording" || kind === "scan" ? { view: kind } : { next: kind }), useRole().can("scan.read"));
  const started = Boolean(encounter?.requests.length);
  const [h, m] = patient.time.split(":").map(Number);
  const now = new Date(), minutes = h! * 60 + m! - (now.getHours() * 60 + now.getMinutes());
  const when = started ? "In progress" : minutes > 0 ? `Starts in ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`}` : minutes > -10 ? "Due now" : `Running ${-minutes} min late`;

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
      <Animated.View accessibilityViewIsModal style={[{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: box ? box - 72 : height * 0.6, borderTopLeftRadius: 32, borderTopRightRadius: 32, borderCurve: "continuous", backgroundColor: palette.canvas, boxShadow: "0 -8px 30px rgba(24,32,48,0.14)", paddingBottom: Math.max(insets.bottom, 16) }, sheet]}>
        <View style={{ alignSelf: "center", width: 38, height: 5, borderRadius: 3, marginTop: 10, backgroundColor: "rgba(20,28,40,0.18)" }} />
        {/* Keyboard-aware so the Sona Care reply box stays above the keyboard while the doctor types. */}
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: 18, gap: 18 }} showsVerticalScrollIndicator={false}>
          <Animated.View entering={rise(0)} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: patient.incomplete ? "rgba(196,120,20,0.16)" : "rgba(36,91,204,0.14)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "700", color: patient.incomplete ? palette.amber : palette.blue }}>{patient.initials}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>{patient.name}</Text>
              <Text style={{ ...type.footnote, color: palette.muted }}>{patient.age} · {patient.sex} · {patient.id}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <Text style={{ fontSize: 20, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{patient.time}</Text>
              <Text style={{ ...type.caption, fontWeight: "600", color: started ? palette.blue : minutes < -10 ? palette.amber : palette.muted }}>{when}</Text>
            </View>
          </Animated.View>

          {flags.length > 0 && <Animated.View entering={rise(1)} style={{ gap: 8 }}>
            <Text style={{ ...type.overline, color: palette.muted }}>Needs attention</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {flags.map(flag => <Pressable key={flag.label} accessibilityRole="button" accessibilityLabel={`${flag.label}. Opens the visit to resolve it`} onPress={() => go(flag.go)}
                style={({ pressed }) => ({ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 18, backgroundColor: TONE[flag.tone].wash, opacity: pressed ? 0.7 : 1 })}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TONE[flag.tone].ink }} />
                <Text style={{ fontSize: 14, fontWeight: "600", color: TONE[flag.tone].ink }}>{flag.label}</Text>
                <Icon name="chevron.right" size={10} color={TONE[flag.tone].ink} />
              </Pressable>)}
            </View>
          </Animated.View>}
          {/* The main action sits right under what needs attention; everything below is context. */}
          <Animated.View entering={rise(1)}><Action label={started ? "Continue visit" : "Open visit"} icon="arrow.right" accessibilityLabel={`${started ? "Continue" : "Open"} visit with ${patient.name}`} onPress={() => go({})} /></Animated.View>

          <CheckInThread patient={patient} entering={rise(2)} />
          <CareMessages patient={patient} entering={rise(2)} />

          <Animated.View entering={rise(2)} style={{ borderRadius: 22, borderCurve: "continuous", backgroundColor: palette.white, padding: 16, gap: 12 }}>
            <View style={{ gap: 3 }}>
              <Text style={{ ...type.overline, color: palette.muted }}>{patient.subtitle}</Text>
              <Text style={{ ...type.callout, color: palette.ink }}>{patient.complaint}</Text>
            </View>
            {patient.vitals.length > 0 ? <View style={{ flexDirection: "row", gap: 8 }}>
              {patient.vitals.map(v => { const raised = v.label === "Temp" && parseFloat(v.value) >= 37.8; return <View key={v.label} style={{ flex: 1, borderRadius: 14, padding: 10, gap: 2, backgroundColor: raised ? "rgba(196,120,20,0.10)" : "rgba(20,28,40,0.04)" }}>
                <Text style={{ ...type.caption, color: palette.muted }}>{v.label}</Text>
                <Text style={{ fontSize: 17, fontWeight: "600", color: raised ? palette.amber : palette.ink, fontVariant: ["tabular-nums"] }}>{v.value}</Text>
              </View>; })}
            </View> : <Text style={{ ...type.footnote, color: palette.muted }}>No observations recorded yet.</Text>}
            <Text style={{ ...type.footnote, color: palette.muted }}>{patient.history[0]} · Medicines: {patient.medicines.length}</Text>
          </Animated.View>

          <Animated.View entering={rise(3)} style={{ gap: 10 }}>
            <QuickActions animate={false} actions={[...visit.slice(0, 3),
              { key: "handover", label: "Hand over", icon: "arrow.left.arrow.right", status: flags.length ? `${flags.length} open ${flags.length === 1 ? "item" : "items"}` : "Nothing open", onPress: () => go({ to: "/handover" }) },
              ...visit.filter(a => a.key === "scan")]} />
            <Pressable accessibilityRole="link" onPress={() => { onClose(); router.push({ pathname: "/source", params: { id: "history", patientId: patient.id } }); }} hitSlop={8} style={{ alignSelf: "center", minHeight: 36, justifyContent: "center" }}>
              <Text style={{ ...type.footnote, color: palette.blue }}>Full history & sources</Text>
            </Pressable>
          </Animated.View>

          {/* PDPA: who opened this record (doctors and management, live mode). */}
          <AccessTrail patientId={patient.id} encounterId={patient.encounterId} entering={rise(4)} />
        </KeyboardAwareScrollView>
      </Animated.View>
    </GestureDetector>
  </View>;
}
