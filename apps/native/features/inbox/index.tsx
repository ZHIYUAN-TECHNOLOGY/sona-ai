import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Alert, Linking, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut, interpolate, interpolateColor, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BrandIcon } from "@/components/sona/brand-icon";
import { EASE_OUT, fold, LAYOUT, riseIn } from "@/components/sona/motion";
import { Caption, ErrorLine } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Chip, Expand, glass, Icon, Screen, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { waitingLongest } from "@/features/ask/answers";
import { ASK_SPACE, WithSona } from "@/features/ask";
import { DoneLine } from "@/features/bookings/parts";
import { callBackNote, WARD_PHONE } from "@/features/check-ins/model";
import type { DayItem } from "@/features/day/model";
import { api, errorText, requestId, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { useRole } from "@/features/live/roles";
import { refreshServerData } from "@/features/live/server-day";
import { clock, insight, LABEL_STYLE, lastLine, sections, summary, waited, type Inbox, type InboxThread, type Label } from "./state";

/**
 * The care team's inbox for Sona Care messages, ranked by triage so nothing urgent is buried: the
 * insight line first, then Urgent / Clinical / Admin (only those with anyone waiting), each a single
 * glass surface of rows. Tap a row for the thread and Sona's drafted reply; swipe it right for
 * "no reply needed" (VoiceOver: the row's "Mark handled" action). Live mode only; it re-reads on
 * every messages change, so a new patient message appears within a second.
 *
 * Swipe to handle after 60fps "Twodos Swipe to Check Todo Interaction"
 * (https://60fps.design/shots/twodos-swipe-to-check-todo-interaction): the row follows the finger
 * (rubber-banded past 88 pt, a tick at the threshold), a confirmed swipe slides it out while it
 * folds to zero height on the layout spring, rows below close the gap, and the section's count
 * dips, changes and springs back. Reduce Motion: the row fades and the count cross-fades.
 */

/*
 * One inbox read shared by every entry point (top bar, sidebar, home tile, My Day, this screen), so
 * they always agree; reads asked for while one is in flight share it, so a change costs one request.
 */
let shared: { userId?: string; inbox?: Inbox; error?: string } = {};
let inflight: Promise<void> | undefined;
const subscribers = new Set<() => void>();
const subscribe = (l: () => void) => { subscribers.add(l); return () => { subscribers.delete(l); }; };
function loadInbox(userId: string | undefined) {
  inflight ??= api.messages.inbox().then(inbox => ({ userId, inbox }), e => ({ ...shared, error: errorText(e) }))
    .then(next => { shared = next; inflight = undefined; subscribers.forEach(s => s()); });
  return inflight;
}

/*
 * A swipe to handle waits 5 seconds before it reaches the server, so Undo can take it back (the server
 * has no "unhandle"). Meanwhile the thread reads handled everywhere (this list, Today's row, the counts);
 * Undo cancels the call and both rows return. The timer outlives the screen, so leaving still commits it.
 */
export const UNDO_MS = 5000;
// `sending`: the 5 seconds are up and the server call is in flight, so it can no longer be undone.
type Held = { patientId: string; name: string; timer: ReturnType<typeof setTimeout>; sending?: boolean };
// One immutable value per change, read through useSyncExternalStore (React Compiler only sees reads it can track).
let holding: { held: Held[]; failed?: string } = { held: [] };
const setHeld = (held: Held[], failed = holding.failed) => { holding = { held, failed }; subscribers.forEach(s => s()); };
function holdHandled(t: InboxThread, userId: string | undefined) {
  const timer = setTimeout(() => {
    const done = (failed?: string) => setHeld(holding.held.filter(h => h.timer !== timer), failed);
    setHeld(holding.held.map(h => h.timer === timer ? { ...h, sending: true } : h));
    api.messages.handle({ patientId: t.patientId })
      .then(() => Promise.all([loadInbox(userId), refreshServerData().catch(() => {})]))
      .then(() => done(), e => done(`${firstName(t.name)}'s messages weren't marked handled: ${errorText(e)}`));
  }, UNDO_MS);
  holding.held.filter(h => h.patientId === t.patientId).forEach(h => clearTimeout(h.timer));
  setHeld([...holding.held.filter(h => h.patientId !== t.patientId), { patientId: t.patientId, name: t.name, timer }], undefined);
}
function undoHandled(patientId: string) {
  const undone = (h: Held) => h.patientId === patientId && !h.sending;
  holding.held.filter(undone).forEach(h => clearTimeout(h.timer));
  setHeld(holding.held.filter(h => !undone(h)));
}

/** The inbox for this role, re-read on every Sona Care messages change. `on` false: fixture mode or a role that cannot read it. */
export function useInbox() {
  const { on: live, user } = useLive();
  const role = useRole();
  const on = live && role.can("messages.inbox");
  const state = useSyncExternalStore(subscribe, () => shared);
  const { held, failed } = useSyncExternalStore(subscribe, () => holding);
  const userId = user?.id;
  const load = useCallback(() => loadInbox(userId), [userId]);
  useEffect(() => { if (on) void load(); }, [on, load]);
  useLiveChanges(["messages"], () => { if (on) void load(); });
  // Another account's inbox is never shown, even for the moment before this one's arrives. Threads inside their Undo window read handled.
  const mine = on && state.userId === userId ? state.inbox : undefined;
  const inbox = mine && held.length ? { ...mine, threads: mine.threads.map(t => held.some(h => h.patientId === t.patientId) ? { ...t, handled: true, label: null } : t) } : mine;
  return { on, inbox, error: on ? state.error : undefined, load, held: on ? held : [], heldFailed: on ? failed : undefined,
    hold: (t: InboxThread) => holdHandled(t, userId), undo: undoHandled };
}

/** Threads waiting, urgent and the longest wait, the same numbers wherever messages are reached. */
export function useInboxSummary() {
  const { on, inbox } = useInbox();
  return { on, ...summary(inbox?.threads, inbox?.now) };
}

const SWIPE = 88;
function haptic(kind: "select" | "done") {
  if (process.env.EXPO_OS !== "ios") return;
  (kind === "done" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync()).catch(() => {});
}
const firstName = (name: string) => name.split(" ")[0]!;

export function InboxScreen() {
  const { on, inbox, error, load, held, heldFailed: failed, hold, undo } = useInbox();
  const role = useRole();
  const canHandle = role.can("messages.handle");
  const { reducedMotion } = useAccessibleEffects();
  const layout = reducedMotion ? undefined : LAYOUT;

  if (!on) return <Screen><Caption>Patient messages arrive from Sona Care in live mode (Settings), for doctors, nurses and management.</Caption></Screen>;
  if (!inbox) return <Screen>{error ? <ErrorLine text={`Messages didn't load: ${error}`} onRetry={() => { void load(); }} /> : <Caption icon={null}>Loading messages…</Caption>}</Screen>;

  // Threads inside their Undo window already read handled (useInbox), here and on Today.
  const threads = inbox.threads;
  const groups = sections(threads);
  const handled = threads.filter(t => t.handled).slice(0, 5);
  const handle = (t: InboxThread) => {
    haptic("done"); hold(t);
    AccessibilityInfo.announceForAccessibility(`${firstName(t.name)}'s messages marked handled. Undo for 5 seconds`);
  };
  const last = held.filter(h => !h.sending).at(-1);
  const line = insight(threads, inbox.now);

  return <WithSona scope="inbox" answers={[waitingLongest(threads, inbox.now)]}><Screen>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>
      {line.split(" · ").map((part, i) => <Text key={part} style={{ color: part.endsWith("urgent") ? palette.red : palette.ink }}>{i ? " · " : ""}{part}</Text>)}
    </Text>
    {failed && <ErrorLine text={failed} />}
    {/* Every handled swipe: 5 seconds to take it back (the handover deck's Undo), before the server hears of it. */}
    {last && <Animated.View key={last.patientId} entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 6, duration: 260 })} exiting={FadeOut.duration(150)}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
      <BrandIcon name="check" size={16} color={palette.green} strokeWidth={2.2} />
      <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ ...type.subhead, flex: 1, color: palette.muted }}>{firstName(last.name)}'s messages marked handled</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Undo, keep ${firstName(last.name)}'s messages waiting`} onPress={() => { haptic("select"); undo(last.patientId); }} hitSlop={8}
        style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, borderRadius: 16, backgroundColor: "rgba(36,91,204,0.1)" }}>
        <Icon name="arrow.uturn.backward" size={11} color={palette.blue} /><Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Undo</Text>
      </Pressable>
    </Animated.View>}
    {groups.map(group => <Animated.View key={group.label} layout={layout} entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 8, duration: 320 })} exiting={reducedMotion ? FadeOut.duration(150) : fold} style={{ gap: 8 }}>
      <SectionHead label={group.label} count={group.rows.length} />
      <Surface layout={layout}>
        {/* The clip keeps a swiped row inside the glass. */}
        <View style={{ borderRadius: radius.group, overflow: "hidden" }}>
          {group.rows.map((t, i) => <InboxRow key={t.patientId} thread={t} now={inbox.now} first={i === 0} canHandle={canHandle} onHandle={() => handle(t)} />)}
        </View>
      </Surface>
    </Animated.View>)}
    {!groups.length && <Animated.View entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 8, duration: 320 })} layout={layout}>
      <Surface style={{ padding: 20, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <BrandIcon name="check" size={22} color={palette.green} strokeWidth={2} />
        <Text style={{ ...type.body, color: palette.ink, flex: 1 }}>No patient is waiting for a reply.</Text>
      </Surface>
    </Animated.View>}
    {handled.length > 0 && <Animated.View layout={layout} style={{ gap: 6, paddingTop: 6 }}>
      <Text accessibilityRole="header" style={{ ...type.overline, color: palette.muted, paddingHorizontal: 4 }}>Handled · last 7 days</Text>
      {handled.map(t => <Animated.View key={t.patientId} layout={layout} entering={FadeIn.duration(220)}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t.name}, handled. Last message ${clock(t.lastAt)}: ${lastLine(t)}`} accessibilityHint="Opens the thread" onPress={() => router.push(`/inbox/${t.patientId}`)}
          style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4, opacity: pressed ? 0.6 : 1 })}>
          <Text numberOfLines={1} style={{ ...type.subhead, color: palette.muted, flexShrink: 1 }}><Text style={{ fontWeight: "600", color: palette.ink }}>{t.name}</Text>  {!t.lastPhoto && t.lastText}</Text>
          {t.lastPhoto && <LastPhoto label={t.lastPhoto} color={palette.muted} />}
          <View style={{ flex: 1 }} />
          <Text style={{ ...type.caption, color: palette.muted, fontVariant: ["tabular-nums"] }}>{clock(t.lastAt)}</Text>
        </Pressable>
      </Animated.View>)}
    </Animated.View>}
    <View style={{ height: ASK_SPACE }} />
  </Screen></WithSona>;
}

/** "Urgent 2": the count dips, changes and springs back when a row leaves (Reduce Motion: a cross-fade). */
function SectionHead({ label, count }: { label: Label; count: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const style = LABEL_STYLE[label];
  const [shown, setShown] = useState(count);
  const pop = useSharedValue(1);
  const last = useRef(count);
  useEffect(() => {
    if (last.current === count) return;
    last.current = count;
    pop.set(reducedMotion ? withSequence(withTiming(0.3, { duration: 100 }), withTiming(1, { duration: 160 }))
      : withSequence(withTiming(0.7, { duration: 110, easing: EASE_OUT }), withSpring(1, { duration: 420, dampingRatio: 0.45 })));
    // The number changes at the bottom of the dip.
    const swap = setTimeout(() => setShown(count), 100);
    return () => clearTimeout(swap);
  }, [count, pop, reducedMotion]);
  const badgeStyle = useAnimatedStyle(() => reducedMotion ? { opacity: pop.value } : { transform: [{ scale: pop.value }] });
  return <View accessible accessibilityRole="header" accessibilityLabel={`${style.text}, ${count} waiting`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
    <Text style={{ ...type.callout, fontWeight: "600", color: label === "urgent" ? palette.red : palette.ink }}>{style.text}</Text>
    <Animated.View style={[{ minWidth: 24, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: style.wash, alignItems: "center", justifyContent: "center" }, badgeStyle]}>
      <Text style={{ ...type.caption, fontWeight: "700", color: style.ink, fontVariant: ["tabular-nums"] }}>{shown}</Text>
    </Animated.View>
  </View>;
}

/** One patient waiting: initials in the triage colour, name and bed, the last message, how long they've waited, unread dot. */
function InboxRow({ thread: t, now, first, canHandle, onHandle }: { thread: InboxThread; now: Date; first: boolean; canHandle: boolean; onHandle: () => void }) {
  const { reducedMotion } = useAccessibleEffects();
  const [why, setWhy] = useState(false);
  const label = t.label ?? "clinical", style = LABEL_STYLE[label];
  const urgent = label === "urgent";
  const wait = t.waitingSince ? waited(t.waitingSince, now) : "";
  const tx = useSharedValue(0), width = useSharedValue(360);
  const open = () => router.push(`/inbox/${t.patientId}`);
  // An urgent thread asks once before it closes without a reply; the rest close on the swipe (each with Undo).
  const ask = () => Alert.alert("Close without replying?", "It's marked urgent.", [{ text: "Reply first", style: "cancel", onPress: open }, { text: "Close it", style: "destructive", onPress: onHandle }]);
  const request = () => urgent ? ask() : onHandle();
  const pan = Gesture.Pan().activeOffsetX(14).failOffsetY([-12, 12]).enabled(canHandle)
    .onUpdate(e => { const x = Math.max(0, e.translationX); tx.set(x > SWIPE ? SWIPE + (x - SWIPE) * 0.35 : x); })
    .onEnd(e => {
      if (urgent && (tx.value >= SWIPE || e.velocityX > 800)) {
        // Back into place while the question is asked; "Close it" then folds the row away.
        tx.set(withSpring(0, { duration: 380, dampingRatio: 0.85 }));
        scheduleOnRN(ask);
      } else if (tx.value >= SWIPE || e.velocityX > 800) {
        // Slides out while the row folds away (its exiting animation).
        tx.set(withTiming(width.value, { duration: 220, easing: EASE_OUT }));
        scheduleOnRN(onHandle);
      } else tx.set(withSpring(0, { duration: 380, dampingRatio: 0.85, velocity: e.velocityX }));
    });
  useAnimatedReaction(() => tx.value >= SWIPE, (over, was) => { if (over && was === false) scheduleOnRN(haptic, "select"); });
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }], backgroundColor: interpolateColor(tx.value, [0, 12], ["rgba(252,253,255,0)", "rgba(252,253,255,0.96)"]) }));
  const revealStyle = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [0, SWIPE], [0, 1], "clamp"), transform: [{ scale: interpolate(tx.value, [0, SWIPE], [0.8, 1], "clamp") }] }));
  const a11y = `${t.name}${t.bed ? `, ${t.bed}` : ""}. ${style.text}${urgent && t.reason ? `: ${t.reason}` : ""}. Waiting ${wait}${t.unread ? `, ${t.unread} unread` : ""}. ${t.lastFrom === "patient" ? "" : "You: "}${lastLine(t)}`;

  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} exiting={reducedMotion ? FadeOut.duration(150) : fold} onLayout={e => width.set(e.nativeEvent.layout.width)}
    style={first ? undefined : { borderTopWidth: 1, borderColor: glass.hairline }}>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, bottom: 0, width: 140, paddingLeft: 22, flexDirection: "row", alignItems: "center", gap: 8 }, revealStyle]}>
      <BrandIcon name="check" size={20} color={palette.green} strokeWidth={2.2} />
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.green }}>Handled</Text>
    </Animated.View>
    <GestureDetector gesture={pan}>
      <Animated.View style={rowStyle}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint="Opens the thread and Sona's drafted reply"
          accessibilityActions={[{ name: "activate" }, ...canHandle ? [{ name: "handle", label: "Mark handled" }] : [], ...!urgent && t.reason ? [{ name: "why", label: "Why this triage" }] : []]}
          onAccessibilityAction={e => e.nativeEvent.actionName === "handle" ? request() : e.nativeEvent.actionName === "why" ? AccessibilityInfo.announceForAccessibility(t.reason ?? "") : open()}
          onPress={open} onLongPress={() => { if (!urgent && t.reason) { haptic("select"); setWhy(w => !w); } }}
          style={({ pressed }) => ({ flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 72, opacity: pressed ? 0.7 : 1 })}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: style.wash, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ ...type.footnote, fontWeight: "700", color: style.ink }}>{t.initials}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text numberOfLines={1} style={{ ...type.headline, ...type.body, color: palette.ink, flexShrink: 1 }}>{t.name}{t.bed ? <Text style={{ fontWeight: "400", color: palette.muted }}> · {t.bed}</Text> : null}</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ ...type.caption, color: urgent ? palette.red : palette.muted, fontWeight: urgent ? "600" : "400", fontVariant: ["tabular-nums"] }}>{wait}</Text>
              {t.unread > 0 && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.blue }} />}
            </View>
            {t.lastPhoto ? <LastPhoto label={t.lastPhoto} color={t.unread ? palette.ink : palette.muted} />
              : <Text numberOfLines={1} style={{ ...type.subhead, color: t.unread ? palette.ink : palette.muted }}>{t.lastFrom === "patient" ? "" : "You: "}{t.lastText}</Text>}
            {urgent && t.reason && <Text numberOfLines={1} style={{ ...type.caption, fontWeight: "600", color: palette.red }}>{t.reason}</Text>}
            {why && <Expand><Text style={{ ...type.caption, color: style.ink, paddingTop: 2 }}>{style.text} · {t.reason}</Text></Expand>}
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  </Animated.View>;
}

/**
 * My Day's urgent message, answered in place: Reply opens the thread with Sona's drafted reply; Call
 * back dials (the ward line, as for a flagged check-in), then logs the call in the patient's Sona Care
 * thread, which answers the message, so the row leaves. Call back shows only for a role that can reply.
 */
export function MessageActions({ item }: { item: DayItem }) {
  const { user } = useLive();
  const canCall = useRole().can("messages.reply");
  const [dialled, setDialled] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState<string>();
  const [error, setError] = useState<string>();
  const [noteId] = useState(requestId); // one note however often the log is retried
  const patientId = item.patientId!;
  const first = item.title.split(":")[0]!;
  const call = () => {
    haptic("select"); setError(undefined); setDialled(true);
    Linking.openURL(`tel:${WARD_PHONE.tel}`).catch(() => setError(`This device can't place calls. Dial ${WARD_PHONE.display} from a phone, then log it.`));
  };
  const log = async () => {
    haptic("select"); setError(undefined); setLogging(true);
    try {
      await api.messages.reply({ patientId, text: callBackNote(user?.name), requestId: noteId });
      const done = `Called back · noted in ${first}'s Sona Care`;
      setLogged(done); haptic("done"); AccessibilityInfo.announceForAccessibility(done);
    } catch (e) { setError(`Not logged: ${errorText(e)}`); } finally { setLogging(false); }
  };
  if (logged) return <DoneLine text={logged} />;
  return <View style={{ gap: 6 }}>
    {dialled && <Text selectable style={{ ...type.footnote, color: palette.muted }}>Dialled the ward line, {WARD_PHONE.display} (no patient number on file). Log the call when you're done.</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {dialled ? <>
        <Chip selected label={logging ? "Logging…" : "Log call-back"} accessibilityLabel={`Log call-back to ${first}`} icon={<Icon name="checkmark" size={12} color={palette.white} />} onPress={() => { if (!logging) void log(); }} />
        <Chip label="Not now" onPress={() => { setDialled(false); setError(undefined); }} />
      </> : <>
        <Chip selected label="Reply" accessibilityLabel={`Reply to ${first}`} icon={<Icon name="arrowshape.turn.up.left.fill" size={12} color={palette.white} />}
          onPress={() => { haptic("select"); router.push({ pathname: "/inbox/[patientId]", params: { patientId } }); }} />
        {canCall && <Chip label="Call back" accessibilityLabel={`Call back ${first}`} icon={<Icon name="phone.fill" size={12} color={palette.ink} />} onPress={call} />}
      </>}
    </View>
    {error && <ErrorLine text={error} onRetry={error.startsWith("Not logged") ? () => { void log(); } : undefined} />}
  </View>;
}

/** "[camera] Photo · Cetirizine 10 mg": the last message was a medicine photo. */
function LastPhoto({ label, color }: { label: string; color: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
    <Icon name="camera.fill" size={13} color={color} />
    <Text numberOfLines={1} style={{ ...type.subhead, color, flexShrink: 1 }}>{lastLine({ lastText: "", lastPhoto: label })}</Text>
  </View>;
}
