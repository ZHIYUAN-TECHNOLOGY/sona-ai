import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { router, Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ScrollView, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { Drafting, SampleLabel } from "@/components/sona/model-answer";
import { LinearGradient } from "expo-linear-gradient";
import { EASE_OUT, LAYOUT, riseIn } from "@/components/sona/motion";
import { Caption, ErrorLine } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, CanvasBackground, Chip, glass, Icon, RoundAction, Surface, surfaceStyle, useAccessibleEffects } from "@/components/sona/ui";
import { openSession } from "@/features/encounter/navigation";
import { api, errorText, requestId, useLive } from "@/features/live";
import { useLiveChanges } from "@/features/live/channel";
import { useRole } from "@/features/live/roles";
import { refreshServerData } from "@/features/live/server-day";
import { MessageActions } from "./index";
import { PhotoMessage } from "./photo";
import { readerText } from "@/components/sona/sample-label";
import { clock, triageStyle, type Label } from "./state";

/**
 * One patient's Sona Care thread for the care team. Opening it marks the patient's messages seen
 * (Sona Care then says "Seen by care team"). Under the header, the latest waiting message's triage
 * and why (urgent: Reply / Call back, as on Today); above the composer, Sona's drafted reply with an honest source line: the rule-based template says
 * so until a model is switched on. Nothing is sent until a doctor or nurse presses send; after
 * sending, back to the inbox, where the thread has moved to handled.
 *
 * The draft card after 60fps "Wabi Chat Suggestion Swipe Cards Carousel Interaction"
 * (https://60fps.design/shots/wabi-chat-suggestion-swipe-cards-carousel-interaction): a suggestion
 * card sits just above the composer, and choosing it carries its words down into the field. Here
 * "Use draft" flies a copy of the text from the card to the input (460 ms ease-out, shrinking a
 * touch and fading as it lands) while the card fades, then fills and focuses the input. Reduce
 * Motion: the input is simply filled.
 */
type Thread = Awaited<ReturnType<AppRouterClient["messages"]["thread"]>>;
type Draft = NonNullable<Awaited<ReturnType<AppRouterClient["messages"]["draft"]>>>;
type Box = { x: number; y: number; width: number };

const measure = (view: View | TextInput | null) => new Promise<Box | undefined>(resolve => {
  if (!view) return resolve(undefined);
  view.measureInWindow((x, y, width) => resolve({ x, y, width }));
});

export function ThreadScreen({ patientId }: { patientId: string }) {
  const { on: live } = useLive();
  const role = useRole();
  const on = live && role.can("messages.thread");
  const canReply = role.can("messages.reply"), canDraft = role.can("messages.draft");
  const { reducedMotion } = useAccessibleEffects();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [data, setData] = useState<Thread>();
  const [loadError, setLoadError] = useState<string>();
  const load = useCallback(() => api.messages.thread({ patientId }).then(t => { setData(t); setLoadError(undefined); }, e => setLoadError(errorText(e))), [patientId]);
  useEffect(() => { if (on) void load(); }, [on, load]);
  useLiveChanges(["messages"], () => { if (on) void load(); });

  // Sona's draft for the latest waiting message; a new message brings a new draft.
  const waiting = data?.messages.filter(m => m.unanswered).at(-1);
  const [draft, setDraft] = useState<{ for: string; value?: Draft; error?: string }>();
  const [hidden, setHidden] = useState<string>(); // the message whose draft was dismissed or used
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!on || !canDraft || !waiting || waiting.attachment) return; // a medicine photo is decided on its own card, not answered with a draft
    let current = true;
    setDraft({ for: waiting.id });
    api.messages.draft({ patientId }).then(value => { if (current) setDraft({ for: waiting.id, value: value ?? undefined }); }, e => { if (current) setDraft({ for: waiting.id, error: errorText(e) }); });
    return () => { current = false; };
  }, [on, canDraft, waiting?.id, patientId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const [text, setText] = useState("");
  const [sendId, setSendId] = useState(requestId);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const input = useRef<TextInput>(null), draftText = useRef<View>(null), root = useRef<View>(null), scroll = useRef<ScrollView>(null);

  // The flight: a copy of the draft travels from the card to the composer.
  const [flight, setFlight] = useState<{ text: string; width: number }>();
  const [fading, setFading] = useState(false);
  const fx = useSharedValue(0), fy = useSharedValue(0), fo = useSharedValue(1), fs = useSharedValue(1);
  const flightStyle = useAnimatedStyle(() => ({ opacity: fo.value, transform: [{ translateX: fx.value }, { translateY: fy.value }, { scale: fs.value }] }));
  const land = (words: string, messageId: string) => {
    setText(words); setSendId(requestId()); setFlight(undefined); setFading(false); setHidden(messageId);
    input.current?.focus();
  };
  const takeDraft = async (d: Draft) => {
    if (reducedMotion) { land(d.text, d.messageId); return; }
    const [from, to, origin] = await Promise.all([measure(draftText.current), measure(input.current), measure(root.current)]);
    if (!from || !to || !origin) { land(d.text, d.messageId); return; }
    const ease = { duration: 460, easing: EASE_OUT };
    fx.set(from.x - origin.x); fy.set(from.y - origin.y); fo.set(1); fs.set(1);
    setFlight({ text: d.text, width: from.width }); setFading(true);
    fx.set(withTiming(to.x - origin.x + 14, ease));
    fs.set(withTiming(0.92, ease));
    fo.set(withDelay(340, withTiming(0, { duration: 120 })));
    fy.set(withTiming(to.y - origin.y + 8, ease, done => { if (done) scheduleOnRN(land, d.text, d.messageId); }));
  };

  const send = async () => {
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true); setSendError(undefined);
    try {
      await api.messages.reply({ patientId, text: words, requestId: sendId });
    } catch (e) { setSendError(errorText(e)); setBusy(false); return; }
    AccessibilityInfo.announceForAccessibility(`Sent to ${first}`);
    void refreshServerData().catch(() => {});
    // Answered: back to the inbox, where this thread is now handled.
    if (router.canGoBack()) router.back(); else router.replace("/inbox");
  };

  const patient = data?.patient;
  const first = patient?.name.split(" ")[0] ?? "the patient";
  const show = waiting && !waiting.attachment && draft?.for === waiting.id && hidden !== waiting.id ? draft : undefined;
  const label: Label = waiting?.triage ?? "clinical";
  // Who triaged it, when it was not a model alone; a message triage did not run on is amber "Not triaged", never the default's calm blue.
  const chip = triageStyle(label, waiting?.triagedBy), by = readerText(waiting?.triagedBy), untriaged = waiting?.triagedBy?.source === "none";

  return <View ref={root} collapsable={false} style={{ flex: 1 }}>
    <CanvasBackground />
    <Stack.Screen options={{
      headerTitle: () => <View accessible accessibilityRole="header" accessibilityLabel={patient ? `${patient.name}${patient.bed ? `, ${patient.bed}` : ""}` : "Messages"} style={{ alignItems: "center" }}>
        <Text style={{ ...type.headline, color: palette.ink }}>{patient?.name ?? "Messages"}</Text>
        {patient?.bed && <Text style={{ ...type.caption, color: palette.muted }}>{patient.bed}</Text>}
      </View>,
      headerRight: () => patient ? <Chip label="Open visit" accessibilityLabel={`Open ${patient.name}'s visit`} onPress={() => openSession(patient.id)} /> : null,
    }} />
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      {/* Insight first, pinned under the header so the bottom-anchored thread never scrolls it away:
          the waiting message's triage in its colour and why, and for urgent ones Reply / Call back as on Today. */}
      {on && waiting && <View style={{ marginTop: headerHeight, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, gap: 10, borderBottomWidth: 1, borderColor: glass.hairline }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, backgroundColor: chip.wash }}>
            <Text style={{ ...type.caption, fontWeight: "700", color: chip.ink }}>{chip.text}</Text>
          </View>
          <Text numberOfLines={2} style={{ ...type.footnote, fontWeight: label === "urgent" || untriaged ? "600" : "400", color: label === "urgent" ? palette.red : untriaged ? palette.amber : palette.muted, flex: 1 }}>
            {untriaged ? "Triage did not run · read it first" : `${waiting.triageReason ?? "Not triaged: read it first"}${by ? ` · ${by}` : ""}`}</Text>
        </View>
        {label === "urgent" && canReply && <MessageActions item={{ patientId, title: first }} onReply={() => input.current?.focus()} />}
      </View>}
      <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 14 }}>
        {!on ? <Caption>Patient messages arrive from Sona Care in live mode (Settings).</Caption>
          : !data ? (loadError ? <ErrorLine text={`Messages didn't load: ${loadError}`} onRetry={() => { void load(); }} /> : <Caption icon={null}>Loading messages…</Caption>)
          : !data.messages.length ? <View style={{ alignItems: "center", gap: 10, paddingTop: 120 }}>
            <Icon name="bubble.left.and.bubble.right" size={22} color={palette.muted} />
            <Text style={{ ...type.subhead, color: palette.muted, textAlign: "center" }}>No messages from {first} yet.</Text>
          </View>
          : data.messages.map(m => <Bubble key={m.id} message={m} reduced={reducedMotion} />)}
      </ScrollView>

      {on && data && <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12), gap: 10 }}>
        {show && <Animated.View layout={reducedMotion ? undefined : LAYOUT} entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 10, duration: 360 })} exiting={FadeOut.duration(160)}>
          <Surface feature style={{ padding: 16, gap: 10, opacity: fading ? 0 : 1, transitionProperty: "opacity", transitionDuration: 240 } as never}>
            <Text style={{ ...type.overline, color: palette.blue }}>Sona drafted a reply · check before sending</Text>
            {show.error ? <ErrorLine text={`No draft: ${show.error}`} onRetry={() => setAttempt(a => a + 1)} />
              : !show.value ? <Drafting label="Sona is drafting…" lines={2} />
              : <>
                <View ref={draftText} collapsable={false}><Text selectable style={{ ...type.callout, color: palette.ink }}>{show.value.text}</Text></View>
                <SampleLabel answer={{ loading: false, data: show.value }} rule what="reply" />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}><Action label="Use draft" icon="arrow.down" accessibilityLabel="Use draft. Puts Sona's reply in the message box to check and send" onPress={() => { void takeDraft(show.value!); }} /></View>
                  <Action secondary label="Dismiss" onPress={() => setHidden(waiting!.id)} />
                </View>
              </>}
          </Surface>
        </Animated.View>}
        {sendError && <ErrorLine text={`Not sent: ${sendError}`} onRetry={() => { void send(); }} />}
        {canReply ? <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
          <TextInput ref={input} value={text} onChangeText={setText} placeholder={`Reply to ${first}`} placeholderTextColor={palette.placeholder} maxLength={1000} editable={!busy} multiline
            accessibilityLabel={`Reply to ${first} in Sona Care`} style={{ ...surfaceStyle, flex: 1, fontSize: type.body.fontSize, lineHeight: 21, color: palette.ink, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, minHeight: 46, maxHeight: 132, borderRadius: 23 } as TextStyle} />
          <RoundAction icon="send" size={46} label={busy ? "Sending" : "Send reply"} ready={!busy && Boolean(text.trim())} onPress={() => { void send(); }} />
        </View> : <Caption>{role.why("messages.reply") ?? "Only a doctor or a nurse replies."}</Caption>}
      </View>}
    </KeyboardAvoidingView>
    {/* The header floats over the thread; a canvas fade keeps scrolled bubbles (dark ones too) from reading through it. */}
    <LinearGradient pointerEvents="none" colors={[palette.canvas, "rgba(245,246,248,0.94)", "rgba(245,246,248,0)"]} locations={[0, 0.72, 1]}
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: on && waiting ? headerHeight : insets.top + 78 }} />
    {flight && <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: flight.width, transformOrigin: "left top" }, flightStyle]}>
      <Text style={{ ...type.callout, color: palette.ink }}>{flight.text}</Text>
    </Animated.View>}
  </View>;
}

/**
 * Patient on the left in glass, the care team on the right in ink; each with who wrote it and when.
 * A medicine photo from the patient shows as the photo and Sona's reading with the decision in place.
 */
function Bubble({ message: m, reduced }: { message: Thread["messages"][number]; reduced: boolean }) {
  const team = m.from === "care-team";
  const tail: ViewStyle = team ? { borderBottomRightRadius: 8 } : { borderBottomLeftRadius: 8 };
  // Sona's call-999 line is the safety rule's template, sent by itself: no person and no model wrote it, and it says so.
  const author = m.rule === "call-999" ? "Sona · automatic safety message" : m.author;
  const header = <Text style={{ ...type.caption, color: palette.muted, paddingHorizontal: 4 }}><Text style={{ fontWeight: "600", color: palette.ink }}>{author}</Text> · {clock(m.createdAt)}</Text>;
  if (m.attachment?.kind === "medicine-photo") return <Animated.View entering={reduced ? undefined : FadeIn.duration(220)} style={{ alignSelf: "flex-start", maxWidth: "84%", gap: 4 }}>
    {header}
    <PhotoMessage messageId={m.id} attachment={m.attachment} first={m.author} />
  </Animated.View>;
  return <Animated.View entering={reduced ? undefined : FadeIn.duration(220)} accessible accessibilityLabel={`${author}, ${clock(m.createdAt)}: ${m.text}`}
    style={{ alignSelf: team ? "flex-end" : "flex-start", maxWidth: "84%", gap: 4, alignItems: team ? "flex-end" : "flex-start" }}>
    {header}
    <View style={[team ? { backgroundColor: palette.dark, borderRadius: radius.group, borderCurve: "continuous" } : { ...surfaceStyle, borderRadius: radius.group }, tail, { paddingHorizontal: 14, paddingVertical: 10 }]}>
      <Text selectable style={{ ...type.body, color: team ? palette.white : palette.ink }}>{m.text}</Text>
    </View>
  </Animated.View>;
}

/** Shared by the patient sheet: the same bubble for the compact thread. */
export { Bubble as ThreadBubble };
