import { router } from "expo-router";
import { EdgeBlur } from "@/components/sona/edge-blur";
import { MyDay } from "@/features/day";
import { QuickActions } from "@/components/sona/quick-actions";
import { homeActions, visitActions } from "./quick-actions";
import { openSession } from "./navigation";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { useEncounter } from "./store";
import { SweptLead, wordCount } from "@/components/sona/marked-text";
import { Icon, pillStyle, Surface, surfaceStyle, useAccessibleEffects } from "@/components/sona/ui";
import { BrandIcon } from "@/components/sona/brand-icon";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { riseIn } from "@/components/sona/motion";
import Animated, { cubicBezier, FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Capability, Patient } from "./types";

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
export type Suggestion = { text: string; kind: Capability | "recording"; emoji: string };

export const capabilityLabels: Record<Capability, string> = { briefing: "Patient briefing", reasoning: "Clinical reasoning", xray: "Chest X-ray", medication: "Medication review", prescription: "Prescribing simulation", followup: "Follow-up plan", note: "Consultation note", evidence: "Evidence" };
const emoji: Record<Capability | "recording", string> = { briefing: "🩺", reasoning: "🔎", xray: "🫁", medication: "💊", prescription: "📝", followup: "🗓️", note: "🗒️", evidence: "📚", recording: "🎙️" };

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
    evidence: `Should ${name} get steroids for this pneumonia?`,
    recording: "Start the consultation",
  };
  return { text: text[kind], kind, emoji: emoji[kind] };
}

const nextSteps: Record<Capability, Capability[]> = {
  briefing: ["reasoning", "xray", "medication"], reasoning: ["evidence", "xray", "medication"], xray: ["evidence", "reasoning", "note"],
  medication: ["prescription", "reasoning", "note"], prescription: ["followup", "note", "medication"], followup: ["note", "briefing", "reasoning"], note: ["followup", "prescription", "evidence"], evidence: ["prescription", "note", "followup"],
};
export const followUpsFor = (kind: Capability, patient: Patient) => nextSteps[kind].map(next => suggestionFor(next, patient));

export function thinkingLabel(kind: Capability, patient: Patient) {
  const labels: Record<Capability, string> = { briefing: `Reading ${first(patient)}’s record…`, reasoning: "Weighing the history…", xray: "Opening the radiograph…", medication: "Checking the medicine list…", prescription: "Checking prerequisites…", followup: "Drafting next steps…", note: "Drafting the note…", evidence: "Reading the studies…" };
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
    evidence: `The evidence is against routine steroids here. ${name}’s severity score decides which studies apply.`,
  };
  return leads[kind];
}

/** Words arrive in a quick sweep, the way Monogram's answers settle in. */
export function StreamedLead({ text, animate }: { text: string; animate: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  const words = { length: wordCount(text) };
  const [shown, setShown] = useState(animate && !reducedMotion ? 0 : words.length);
  useEffect(() => {
    if (shown >= words.length) return;
    const timer = setTimeout(() => setShown(count => Math.min(words.length, count + 2)), 45);
    return () => clearTimeout(timer);
  }, [shown, words.length]);
  // Key terms become chips; a highlight sweeps across them once a fresh answer finishes streaming.
  return <SweptLead text={text} shown={shown} sweep={animate && !reducedMotion} style={{ ...type.title, color: palette.ink }} />;
}

export function SuggestionList({ items, onPick, stagger = true }: { items: Suggestion[]; onPick: (item: Suggestion) => void; stagger?: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  return <View style={{ ...surfaceStyle, overflow: "hidden" }}>
    {items.map((item, i) => <Animated.View key={item.text} entering={reducedMotion || !stagger ? undefined : riseIn({ delay: 60 + i * 45, distance: 10 })}>
      {i > 0 && <View style={{ height: 1, marginLeft: 18, backgroundColor: "rgba(20,28,40,0.07)" }} />}
      <Pressable accessibilityRole="button" accessibilityLabel={item.text} accessibilityHint={item.kind === "recording" ? "Opens the consultation recorder" : "Asks Sona"} onPress={() => onPick(item)}
        style={({ pressed }) => ({ minHeight: 70, paddingLeft: 18, paddingRight: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: pressed ? "rgba(20,28,40,0.04)" : "transparent", transform: [{ scale: pressed ? 0.985 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 120 } as never)}>
        <Text style={{ flex: 1, fontSize: 15, lineHeight: 20, color: palette.ink, fontWeight: "500" }}>{item.text}</Text>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#F0F2F6", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 22 }}>{item.emoji}</Text></View>
        <Icon name="arrow.right" size={13} color={palette.ink} />
      </Pressable>
    </Animated.View>)}
  </View>;
}

export function Pill({ label, emoji: glyph, onPress }: { label: string; emoji?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={{ top: 2, bottom: 2 }}
    style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 15, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 7, ...pillStyle, transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
    {glyph && <Text style={{ fontSize: 15 }}>{glyph}</Text>}<Text style={{ fontSize: 14, fontWeight: "500", color: palette.ink }}>{label}</Text>
  </Pressable>;
}

function Round({ children, label, onPress }: { children: ReactNode; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
    style={({ pressed }) => ({ minHeight: 44, minWidth: 44, borderRadius: 22, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", flexDirection: "row", ...pillStyle, transform: [{ scale: pressed ? 0.95 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>{children}</Pressable>;
}

/** Floating header: menu on the left, the patient in context on the right. Content scrolls beneath a soft fade. */
/**
 * Floating header: menu on the left; follow-up tasks on the right (the thing a clinician checks
 * between patients). Inside an encounter, the patient chip joins it so every answer's subject stays visible.
 */
export function TopBar({ patient, inEncounter, openTasks, faded, onMenu, onBack, onPatient, onTasks }: { patient?: Patient; inEncounter: boolean; openTasks: number; faded: boolean; onMenu: () => void; onBack?: () => void; onPatient: () => void; onTasks: () => void }) {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibleEffects();
  return <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
    <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top + 84, opacity: faded ? 1 : 0, transitionProperty: "opacity", transitionDuration: 200, transitionTimingFunction: EASE_OUT }}>
      <EdgeBlur edge="top" style={{ flex: 1 }} />
    </Animated.View>
    <View pointerEvents="box-none" style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      {/* Home opens the menu; a session goes back to home (swiping from the edge does the same). */}
      {onBack ? <Round label="Back to home" onPress={onBack}><BrandIcon name="back" size={22} /></Round> : <Round label="History and settings" onPress={onMenu}><BrandIcon name="menu" size={22} /></Round>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {patient && inEncounter && <Animated.View entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 6, scale: 0.96, duration: 240 })}>
          <Round label={`Current patient ${patient.name}, ${patient.id}. Change patient`} onPress={onPatient}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#DCE7FB", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12, fontWeight: "600", color: palette.blue }}>{patient.initials}</Text></View>
              <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>{patient.name.split(" ")[0]}</Text>
            </View>
          </Round>
        </Animated.View>}
        <Round label={openTasks ? `Follow-up tasks, ${openTasks} open` : "Follow-up tasks"} onPress={onTasks}>
          <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}><BrandIcon name="tasks" size={22} /></View>
          {openTasks > 0 && <View accessibilityElementsHidden style={{ position: "absolute", top: -3, right: -3, minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: palette.blue, borderWidth: 2, borderColor: palette.white, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 10, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{openTasks}</Text>
          </View>}
        </Round>
      </View>
    </View>
  </View>;
}

function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening."; }

/** Idle canvas: one greeting, one line of context, a couple of starting points. */
export function Home({ patient, patients, onPick, onChoosePatient, onSelectPatient }: { patient?: Patient; patients: Patient[]; onPick: (item: Suggestion) => void; onChoosePatient: () => void; onSelectPatient: (id: string) => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const { encounters } = useEncounter();
  const rise = (i: number) => reducedMotion ? undefined : riseIn({ delay: 80 + i * 70, distance: 14, duration: 460 });
  const lead = { ...type.display, color: palette.ink } as const;
  // Reading order top-down: greeting under the top bar, then the next section at a fixed rhythm.
  // Nothing is centred or pinned to the bottom, so the gap never stretches with screen height.
  // Without a visit, the greeting and the ranked day are one section: MyDay owns the header.
  if (!patient) return <View style={{ paddingTop: 20 }}><MyDay patients={patients} greeting={greeting().replace(/\.$/, "")} onOpen={(id, open) => openSession(id, open)}
    actions={<QuickActions actions={homeActions(patients, encounters)} />} /></View>;
  return <View style={{ gap: 44, paddingTop: 20 }}>
    <View style={{ gap: 18 }}>
      <Animated.View entering={rise(0)}><Text accessibilityRole="header" style={lead}>{greeting()}</Text></Animated.View>
      <Animated.View entering={rise(1)}>
        {patient ? <Text style={lead}>
          <Text style={{ fontWeight: "600" }}>{patient.name}</Text> is here for a {patient.subtitle.toLowerCase()} {patient.incomplete ? "🫁" : "🩺"} at <Text style={{ fontWeight: "600" }}>{patient.time}</Text>.{"\n"}<Text style={{ color: palette.muted }}>Ask me anything.</Text>
        </Text> : null}
      </Animated.View>
      <Animated.View entering={rise(2)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {patient ? <QuickActions actions={visitActions(patient, encounters[patient.id], kind => onPick(suggestionFor(kind, patient)))} /> : null}
      </Animated.View>
    </View>
  </View>;
}

