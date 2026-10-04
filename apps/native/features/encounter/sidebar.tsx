import { clearThread } from "@/features/ask/thread";
import { BrandIcon, type BrandIconName } from "@/components/sona/brand-icon";
import { DataPill } from "@/components/sona/model-answer";
import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Icon } from "@/components/sona/ui";
import { useOpenAudit } from "@/features/audit";
import { useInboxSummary } from "@/features/inbox";
import { useLive } from "@/features/live";
import { RolePill, useRole } from "@/features/live/roles";
import { useLiveHandover } from "@/features/live/handover-sync";
import { useTrainingStatus } from "@/features/training";
import { trainingLine } from "@/features/training/model";
import { wardSummary } from "@/features/ward/model";
import { useDay, useOpenTasks, useWardBeds } from "@/features/day/use-counts";
import { auditLine, auditOf, wardLine } from "./quick-actions";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CONTINUE_LIMIT } from "@/features/patients/continue";
import { useContinue } from "@/features/patients/continue-store";
import { useSaved } from "@/features/ask/saved";
import { useTodayAnswers } from "@/features/ask/today";
import { useEncounter } from "./store";
import { openSession } from "./navigation";

export const SIDEBAR_WIDTH = 300;

/** `icon` is a brand glyph, `sf` an SF Symbol where the brand set has none (the same glyphs as the home keys). */
type Item = { label: string; icon?: BrandIconName; sf?: string; onPress: () => void; active?: boolean; detail?: string; badge?: { count: number; urgent: boolean }; show?: boolean };

function Row({ item }: { item: Item }) {
  const badge = item.badge?.count ? item.badge : undefined;
  const reduced = useReduceMotionPreference();
  return <Pressable accessibilityRole="button" accessibilityLabel={[item.label, item.detail].filter(Boolean).join(", ")} accessibilityState={{ selected: item.active }} onPress={item.onPress}>
    {({ pressed }) => <Animated.View style={{ minHeight: 50, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, borderRadius: radius.control, borderCurve: "continuous", backgroundColor: item.active ? "rgba(20,28,40,0.07)" : pressed ? "rgba(20,28,40,0.04)" : "transparent", transform: [{ scale: pressed && !reduced ? 0.98 : 1 }], transitionProperty: ["transform", "backgroundColor"], transitionDuration: 120 }}>
    <View style={{ width: 23, alignItems: "center" }}>{item.sf ? <Icon name={item.sf} size={20} color={palette.ink} /> : <BrandIcon name={item.icon!} size={23} color={palette.ink} strokeWidth={item.active ? 1.9 : 1.5} />}</View>
    <View style={{ flex: 1 }}>
      <Text numberOfLines={1} style={{ ...type.headline, color: palette.ink, fontWeight: item.active ? "600" : "400" }}>{item.label}</Text>
      {item.detail && <Text numberOfLines={1} style={{ ...type.footnote, color: palette.muted, marginTop: 1 }}>{item.detail}</Text>}
    </View>
    {/* Red only when something must not wait; the detail line already says it, so VoiceOver skips the badge. */}
    {badge && <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: badge.urgent ? palette.red : palette.blue, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ ...type.caption, fontWeight: "700", color: palette.white, fontVariant: ["tabular-nums"] }}>{badge.count}</Text>
    </View>}
    </Animated.View>}
  </Pressable>;
}

/** A group's name, only when the group has something to show. */
const Group = ({ title }: { title: string }) => <Text accessibilityRole="header" style={{ ...type.footnote, color: palette.muted, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 }}>{title}</Text>;

const Divider = () => <View style={{ height: 1, marginHorizontal: 14, marginVertical: 10, backgroundColor: "rgba(20,28,40,0.08)" }} />;

/**
 * Workspace sidebar, revealed underneath as the page slides right (after the ChatGPT-style
 * drawer). Grouped by the kind of work: Today, then My work, Patients (with where you left off)
 * and Ward & hospital. Tools that need a patient (consultation, note) live inside the visit. The Patients
 * row is the one way to find a patient or start a visit (no search row or New visit pill repeating it).
 */
export function Sidebar({ open, progress, onClose }: { open: boolean; progress: SharedValue<number>; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { patient, patients } = useEncounter();
  const { user } = useLive();
  // Close first, then navigate, so the page is back in place when the next screen presents.
  const go = (to: () => void) => () => { if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {}); onClose(); setTimeout(to, 120); };
  // Continue: where you left off (the open visit, pins, unfinished work under 24 h), capped so the drawer
  // stays the same length at any census; the rest are behind "See all".
  const { entries } = useContinue();
  // Saved Sona views, rebuilt from today's data, each with its current one-line answer.
  const saved = useSaved();
  const today = useTodayAnswers();
  const leadOf = (id: string) => { const a = today.find(x => x.id === id); const lead = a && Object.values(a.spec.elements).find(e => e.type === "AskLead"); return lead ? String((lead.props as { text: string }).text) : undefined; };
  const openTasks = useOpenTasks(); // the Tasks page's list, server tasks included
  // Each destination shows only for a role whose screen the server would open, with the same live line as its home key.
  const { can, label: role } = useRole();
  const inbox = useInboxSummary();
  // Today's visits from the same schedule as Today and Patients, so the three never disagree.
  // Undefined until the server's day arrives (judge build): no count meanwhile, never "No visits today" for a day not read yet.
  const day = useDay(patients);
  const ward = wardSummary(useWardBeds()); // the Ward page's beds
  const audit = auditOf(useOpenAudit());
  const training = useTrainingStatus();
  const handover = useLiveHandover(open);
  const handoverCount = handover.live ? handover.cards?.length : patients.length + 3;

  const all: { title?: string; items: Item[] }[] = [
    // Home: the day's dashboard, from anywhere in Today (a conversation there steps aside).
    { items: [{ label: "Home", sf: "house", active: true, onPress: () => { clearThread(); onClose(); } }] },
    { title: "My work", items: [
      // Fixture mode has no inbox: the item still opens it, without a count.
      { label: "Messages", icon: "feedback", detail: inbox.on ? inbox.line : undefined, badge: inbox.on ? { count: inbox.waiting, urgent: inbox.urgent > 0 } : undefined, show: can("messages.inbox"), onPress: go(() => router.push("/inbox")) },
      { label: "Follow-up tasks", icon: "tasks", detail: openTasks ? `${openTasks} open` : "Nothing open", show: can("tasks.list"), onPress: go(() => router.push("/tasks")) },
      // The handover page's own count: the server's cards (read while the drawer is open), or in fixture mode today's visits plus the three synthetic ward examples.
      { label: "Shift handover", sf: "arrow.left.arrow.right", detail: handoverCount === undefined ? undefined : `${handoverCount} ${handoverCount === 1 ? "patient" : "patients"}`, show: can("handover.list"), onPress: go(() => router.push("/handover")) },
    ] },
    { title: "Patients", items: [
      { label: "Patients", icon: "patients", detail: !day ? undefined : day.length ? `${day.length} ${day.length === 1 ? "visit" : "visits"} today` : "No visits today", show: can("patients.list"), onPress: go(() => router.push("/patients")) },
    ] },
    { title: "Continue", items: [
      ...entries.slice(0, CONTINUE_LIMIT).map((e): Item => ({ label: e.patient.name, ...(e.why === "pinned" ? { sf: "pin" } : { icon: e.why === "open" ? "stethoscope" as const : "clock" as const }),
        detail: [e.why === "open" ? "In visit" : e.why === "pinned" ? "Pinned" : "", e.left].filter(Boolean).join(" · "), onPress: go(() => openSession(e.patient.id)) })),
      ...(entries.length > CONTINUE_LIMIT ? [{ label: `See all ${entries.length}`, sf: "ellipsis.circle", onPress: go(() => router.push({ pathname: "/patients", params: { tab: "continue" } })) }] : []),
    ] },
    { title: "Ward & hospital", items: [
      { label: "Ward", sf: "bed.double", detail: wardLine(ward), show: can("ward.beds"), onPress: go(() => router.push("/ward")) },
      { label: "Coding audit", sf: "doc.text.magnifyingglass", detail: auditLine(audit), show: can("audit.list"), onPress: go(() => router.push("/audit")) },
      { label: "Training data", sf: "shield.lefthalf.filled", detail: training.status ? trainingLine(training.status.counts) : undefined, show: can("training.status"), onPress: go(() => router.push("/training")) },
    ] },
    { title: "Saved views", items: saved.map((v): Item => ({ label: v.question, sf: "sparkles", detail: leadOf(v.id), onPress: go(() => router.push({ pathname: "/view/[id]", params: { id: v.id } })) })) },
  ];
  const groups = all.map(group => ({ ...group, items: group.items.filter(item => item.show !== false) })).filter(group => group.items.length);

  // Content drifts in from slightly left and fades up, following the page as it slides away.
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.2, 1], [0, 1], "clamp"),
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-24, 0]) }],
  }));

  return <View accessibilityViewIsModal={open} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"} onAccessibilityEscape={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: palette.canvas }]}>
    <Animated.View style={[{ width: SIDEBAR_WIDTH, flex: 1 }, contentStyle]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 12, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, minHeight: 56 }}>
          <BrandIcon name="user" size={28} color={palette.ink} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text numberOfLines={1} style={{ ...type.headline, color: palette.ink }}>{user?.name ?? "Clinician"}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <RolePill label={role} />
              {/* The one place the clinician app says its data is fictional. */}
              <DataPill onPress={go(() => router.push("/about-data"))} />
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={go(() => router.push("/history"))} hitSlop={10} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <BrandIcon name="settings" size={24} color={palette.muted} />
          </Pressable>
        </View>
        <Divider />
        {groups.map(group => <View key={group.title ?? "today"}>
          {group.title && <Group title={group.title} />}
          {group.items.map(item => <Row key={item.label} item={item} />)}
        </View>)}
      </ScrollView>
    </Animated.View>
  </View>;
}
