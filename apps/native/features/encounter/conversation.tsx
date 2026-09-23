import { Text } from "@/components/sona/text";
import { palette } from "@/components/sona/theme";
import { Icon, useAccessibleEffects } from "@/components/sona/ui";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { riseIn } from "@/components/sona/motion";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Capability, Patient } from "./types";

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
export type Suggestion = { text: string; kind: Capability | "recording"; emoji: string };

export const capabilityLabels: Record<Capability, string> = { briefing: "Patient briefing", reasoning: "Clinical reasoning", xray: "Chest X-ray", medication: "Medication review", prescription: "Prescribing simulation", followup: "Follow-up plan", note: "Consultation note" };
const emoji: Record<Capability | "recording", string> = { briefing: "🩺", reasoning: "🔎", xray: "🫁", medication: "💊", prescription: "📝", followup: "🗓️", note: "🗒️", recording: "🎙️" };

const first = (patient: Patient) => patient.name.split(" ")[0];

export function suggestionFor(kind: Capability | "recording", patient: Patient): Suggestion {
  const name = first(patient);
  const text: Record<Capability | "recording", string> = {
    briefing: `What should I know before I see ${name}?`,
    reasoning: "What possibilities should I consider?",
    xray: `Review ${name}’s chest X-ray`,
    medication: `Check ${name}’s medicines for interactions`,
    prescription: "Run the prescribing simulation",
    followup: "Prepare a follow-up plan",
    note: "Show me the consultation note",
    recording: "Start the consultation",
  };
  return { text: text[kind], kind, emoji: emoji[kind] };
}

const nextSteps: Record<Capability, Capability[]> = {
  briefing: ["reasoning", "xray", "medication"], reasoning: ["xray", "medication", "note"], xray: ["reasoning", "note", "followup"],
  medication: ["prescription", "reasoning", "note"], prescription: ["followup", "note", "medication"], followup: ["note", "briefing", "reasoning"], note: ["followup", "prescription", "briefing"],
};
export const followUpsFor = (kind: Capability, patient: Patient) => nextSteps[kind].map(next => suggestionFor(next, patient));

export function thinkingLabel(kind: Capability, patient: Patient) {
  const labels: Record<Capability, string> = { briefing: `Reading ${first(patient)}’s record…`, reasoning: "Weighing the history…", xray: "Opening the radiograph…", medication: "Checking the medicine list…", prescription: "Checking prerequisites…", followup: "Drafting next steps…", note: "Drafting the note…" };
  return labels[kind];
}

/** Authored one-sentence answers. They describe the fixture honestly; none is model output. */
export function leadFor(kind: Capability, patient: Patient) {
  const name = first(patient);
  if (patient.incomplete) {
    const gaps: Partial<Record<Capability, string>> = {
      briefing: `${name} is here with ${patient.complaint.charAt(0).toLowerCase()}${patient.complaint.slice(1).replace(/\.$/, "")}, and most of the history is still missing.`,
      reasoning: "There isn’t enough history yet to weigh possibilities. Here’s what to collect first.",
    };
    if (gaps[kind]) return gaps[kind]!;
  }
  const leads: Record<Capability, string> = {
    briefing: `${name} is ${patient.age} and here for a ${patient.subtitle.toLowerCase()}. ${patient.complaint}`,
    reasoning: "Two possibilities are worth exploring. The record doesn’t confirm either of them.",
    xray: "Here’s the reference chest radiograph with its uploader’s description. It isn’t a model reading.",
    medication: `${name} reports ${patient.medicines.length} ${patient.medicines.length === 1 ? "medicine" : "medicines"}. Nothing can be cleared until each one is confirmed.`,
    prescription: "Here’s the prescribing simulation, with every check it ran before creating a receipt.",
    followup: "Here’s a follow-up plan you can turn into owned, dated tasks.",
    note: "Here’s the consultation note drafted from the transcript, ready for your edits.",
  };
  return leads[kind];
}

/** Words arrive in a quick sweep, the way Monogram's answers settle in. */
export function StreamedLead({ text, animate }: { text: string; animate: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  const words = text.split(" ");
  const [shown, setShown] = useState(animate && !reducedMotion ? 0 : words.length);
  useEffect(() => {
    if (shown >= words.length) return;
    const timer = setTimeout(() => setShown(count => Math.min(words.length, count + 2)), 45);
    return () => clearTimeout(timer);
  }, [shown, words.length]);
  return <View accessible accessibilityLabel={text}>
    <Text selectable style={{ fontSize: 22, lineHeight: 30, letterSpacing: -0.45, color: palette.ink }}>
      {words.map((word, i) => <Text key={i} style={{ opacity: i < shown ? 1 : 0 }}>{word}{i < words.length - 1 ? " " : ""}</Text>)}
    </Text>
  </View>;
}

export function SuggestionList({ items, onPick, stagger = true }: { items: Suggestion[]; onPick: (item: Suggestion) => void; stagger?: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  return <View style={{ borderRadius: 24, borderCurve: "continuous", backgroundColor: "rgba(255,255,255,0.86)", overflow: "hidden", boxShadow: "0 6px 22px rgba(24,32,48,0.06)" }}>
    {items.map((item, i) => <Animated.View key={item.text} entering={reducedMotion || !stagger ? undefined : riseIn({ delay: 60 + i * 45, distance: 10 })}>
      {i > 0 && <View style={{ height: 1, marginLeft: 18, backgroundColor: "rgba(20,28,40,0.07)" }} />}
      <Pressable accessibilityRole="button" accessibilityLabel={item.text} onPress={() => onPick(item)}
        style={({ pressed }) => ({ minHeight: 70, paddingLeft: 18, paddingRight: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: pressed ? "rgba(20,28,40,0.04)" : "transparent", transform: [{ scale: pressed ? 0.985 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 120 } as never)}>
        <Text style={{ flex: 1, fontSize: 15, lineHeight: 20, color: palette.ink, fontWeight: "500" }}>{item.text}</Text>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#F0F2F6", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 22 }}>{item.emoji}</Text></View>
        <Icon name="arrow.right" size={13} color={palette.ink} />
      </Pressable>
    </Animated.View>)}
  </View>;
}

export function Pill({ label, emoji: glyph, onPress }: { label: string; emoji?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 15, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(255,255,255,0.9)", boxShadow: "0 2px 10px rgba(24,32,48,0.07)", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
    {glyph && <Text style={{ fontSize: 15 }}>{glyph}</Text>}<Text style={{ fontSize: 14, fontWeight: "500", color: palette.ink }}>{label}</Text>
  </Pressable>;
}

function Round({ children, label, onPress }: { children: ReactNode; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
    style={({ pressed }) => ({ height: 44, minWidth: 44, borderRadius: 22, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", flexDirection: "row", backgroundColor: "rgba(255,255,255,0.9)", boxShadow: "0 3px 12px rgba(24,32,48,0.08)", transform: [{ scale: pressed ? 0.95 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>{children}</Pressable>;
}

/** Floating header: menu on the left, the patient in context on the right. Content scrolls beneath a soft fade. */
export function TopBar({ patient, faded, onMenu, onPatient }: { patient?: Patient; faded: boolean; onMenu: () => void; onPatient: () => void }) {
  const insets = useSafeAreaInsets();
  return <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
    <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top + 84, opacity: faded ? 1 : 0, transitionProperty: "opacity", transitionDuration: 200, transitionTimingFunction: EASE_OUT }}>
      <LinearGradient colors={[palette.canvas, palette.canvas, "rgba(245,246,248,0)"]} locations={[0, 0.62, 1]} style={{ flex: 1 }} />
    </Animated.View>
    <View pointerEvents="box-none" style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Round label="History and settings" onPress={onMenu}><Icon name="line.3.horizontal" size={18} /></Round>
      <Round label={patient ? `Change patient, ${patient.name}, ${patient.id}` : "Choose a patient"} onPress={onPatient}>
        {patient ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#DCE7FB", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12, fontWeight: "600", color: palette.blue }}>{patient.initials}</Text></View>
          <View><Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink }}>{patient.name}</Text><Text style={{ fontSize: 11, color: palette.muted, fontVariant: ["tabular-nums"] }}>{patient.id} · synthetic</Text></View>
        </View> : <Icon name="person.crop.circle.badge.plus" size={20} />}
      </Round>
    </View>
  </View>;
}

function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening."; }

/** Idle canvas: one greeting, one line of context, a couple of starting points. */
export function Home({ patient, patients, onPick, onChoosePatient, onSelectPatient }: { patient?: Patient; patients: Patient[]; onPick: (item: Suggestion) => void; onChoosePatient: () => void; onSelectPatient: (id: string) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const rise = (i: number) => reducedMotion ? undefined : riseIn({ delay: 80 + i * 70, distance: 14, duration: 460 });
  const lead = { fontSize: 27, lineHeight: 35, letterSpacing: -0.6, color: palette.ink } as const;
  // Reading order top-down: greeting under the top bar, then the next section at a fixed rhythm.
  // Nothing is centred or pinned to the bottom, so the gap never stretches with screen height.
  return <View style={{ gap: 44, paddingTop: 20 }}>
    <View style={{ gap: 18 }}>
      <Animated.View entering={rise(0)}><Text accessibilityRole="header" style={lead}>{greeting()}</Text></Animated.View>
      <Animated.View entering={rise(1)}>
        {patient ? <Text style={lead}>
          <Text style={{ fontWeight: "600" }}>{patient.name}</Text> is here for a {patient.subtitle.toLowerCase()} {patient.incomplete ? "🫁" : "🩺"} at <Text style={{ fontWeight: "600" }}>{patient.time}</Text>.{"\n"}<Text style={{ color: palette.muted }}>Ask me anything.</Text>
        </Text> : <Text style={lead}>Who are we seeing first?{"\n"}<Text style={{ color: palette.muted }}>Pick up a visit to begin.</Text></Text>}
      </Animated.View>
      <Animated.View entering={rise(2)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {patient ? <><Pill label="Brief me" emoji="🩺" onPress={() => onPick(suggestionFor("briefing", patient))} /><Pill label="Start consultation" emoji="🎙️" onPress={() => onPick(suggestionFor("recording", patient))} /></>
          : <Pill label="All patients" onPress={onChoosePatient} />}
      </Animated.View>
    </View>
    <Animated.View entering={rise(3)} style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>{patient ? "You might want to ask" : "Today’s visits"}</Text>
      {patient ? <SuggestionList items={(["briefing", "xray", "medication"] as const).map(kind => suggestionFor(kind, patient))} onPick={onPick} />
        : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginVertical: -14 }} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 14, gap: 10 }}>
          {patients.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.time}, ${item.subtitle}`} onPress={() => onSelectPatient(item.id)}
            style={({ pressed }) => ({ width: 188, padding: 16, gap: 14, borderRadius: 22, borderCurve: "continuous", backgroundColor: "rgba(255,255,255,0.9)", boxShadow: "0 6px 22px rgba(24,32,48,0.06)", transform: [{ scale: pressed ? 0.97 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "#DCE7FB", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 13, fontWeight: "600", color: palette.blue }}>{item.initials}</Text></View>
              <Text style={{ fontSize: 13, color: palette.muted, fontVariant: ["tabular-nums"] }}>{item.time}</Text>
            </View>
            <View style={{ gap: 3 }}><Text style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}>{item.name}</Text><Text style={{ fontSize: 13, color: palette.muted }}>{item.subtitle}</Text></View>
          </Pressable>)}
        </ScrollView>}
    </Animated.View>
  </View>;
}
