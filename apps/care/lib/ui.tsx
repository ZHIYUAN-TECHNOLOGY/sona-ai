import MaskedView from "@react-native-masked-view/masked-view";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, View, type TextInput as RNTextInput, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { Text, TextInput } from "./text";
import Animated, { cancelAnimation, Easing, interpolateColor, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { HalftoneGlint } from "./halftone";
import { Icon, type IconName } from "./icons";
import { accent, palette, type } from "./theme";
import { errorText } from "@/features/errors";
import { tFor, useLang, useT } from "./i18n";
import "./strings";

/**
 * Sona's design system for Sona Care, after the AI Health Companion kit (mirrors apps/native/components/sona/ui.tsx):
 * liquid-glass cards with 32 pt corners over the aurora canvas; glass capsules for values (a time, "Next in 3:00"); one `feature` card for the thing that
 * needs the patient now (white, a soft blue lift, a faint halftone glint); a near-black primary pill and
 * round glass buttons. Press feedback is a 0.96 scale.
 * ponytail: mirrored, not shared; move both apps' copies to a shared UI package once they settle.
 */
// Liquid glass (Sona's design system, as in apps/native): a translucent fill, bright at the top and cooler
// toward the bottom, a white rim with a defined outer edge so it never melts into the white canvas, a
// sheen along the top, an azure catch along the bottom and a soft azure lift; 24 pt continuous corners.
// No live blur, so long lists stay cheap; real blur is kept for chrome (the bar).
export const CARD_RADIUS = 24;
const glassFill = "linear-gradient(165deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.46) 48%, rgba(228,237,255,0.5) 100%)";
export const surfaceStyle: ViewStyle = { borderRadius: CARD_RADIUS, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "transparent", experimental_backgroundImage: glassFill,
  boxShadow: "0 0 0 0.75px rgba(30,50,110,0.10), 0 1px 2px rgba(30,50,110,0.06), 0 16px 32px -18px rgba(37,70,170,0.32), inset 0 1px 0 #FFFFFF, inset 0 12px 20px -14px rgba(255,255,255,1), inset 0 -14px 24px -16px rgba(37,99,235,0.2)" } as ViewStyle;
/** A glass capsule for a value or label (a time, a status, a chip). */
export const pillStyle: ViewStyle = { borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "rgba(255,255,255,0.78)", boxShadow: "0 0 0 0.5px rgba(20,28,40,0.05), 0 4px 12px -6px rgba(40,70,140,0.18), inset 0 1px 0 #FFFFFF" } as ViewStyle;
/** A selected or primary capsule: solid ink. It drops the glass rim and the inset top highlight, which read as a white line on dark. */
export const inkPill: ViewStyle = { backgroundColor: palette.dark, borderColor: palette.dark, boxShadow: "0 6px 14px -8px rgba(20,28,40,0.45)" } as ViewStyle;
const featureStyle: ViewStyle = { backgroundColor: palette.white, borderColor: "rgba(37,99,235,0.10)", boxShadow: "0 18px 36px -20px rgba(37,99,235,0.35)" } as ViewStyle;

/** Cards resize on the layout spring (no bounce), so a card that grows in place (a check-in opening) springs rather than jumps. */
const CARD_LAYOUT = LinearTransition.springify().duration(380).dampingRatio(1);

export function Card({ children, feature = false, style }: { children: ReactNode; feature?: boolean; style?: ViewStyle }) {
  const still = useReducedMotion();
  return <Animated.View layout={still ? undefined : CARD_LAYOUT} style={[surfaceStyle, feature && featureStyle, { padding: 22, gap: 14 }, style]}>
    {feature && <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: CARD_RADIUS, overflow: "hidden" }}><HalftoneGlint width={170} height={96} origin={[170, 0]} reach={[160, 90]} strength={0.4} style={{ top: 0, right: 0 }} /></View>}
    {children}
  </Animated.View>;
}

/** Primary: the kit's near-black capsule (only the action that matters). `quiet`: a white capsule on a hairline. */
export function Button({ label, onPress, busy, disabled, quiet }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; quiet?: boolean }) {
  const off = disabled || busy;
  // Coming on as the form fills fades in (after Family's Continue), rather than snapping.
  const on = useSharedValue(disabled ? 0.45 : 1);
  useEffect(() => { on.set(withTiming(disabled ? 0.45 : 1, SNAP)); }, [disabled, on]);
  const fade = useAnimatedStyle(() => ({ opacity: on.get() }));
  return <Animated.View style={fade}>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, borderRadius: 26, paddingHorizontal: 20, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1,
        borderColor: quiet ? "#EDEDED" : palette.dark, backgroundColor: quiet ? palette.white : palette.dark, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      {busy ? <ActivityIndicator color={quiet ? palette.ink : palette.white} /> : <Text style={{ fontSize: 16, fontWeight: "600", color: quiet ? palette.ink : palette.white }}>{label}</Text>}
    </Pressable>
  </Animated.View>;
}

/**
 * Hold to confirm (after Opal's hold-to-commit): the ink pill fills blue into violet over
 * `hold` ms while pressed and drains back if let go early, so a stray tap can't log a dose. On
 * completion it settles into a white pill with a check. VoiceOver's activate confirms at once
 * (holding is a visual gesture, not the only way in). `quiet`: a glass pill for a secondary hold
 * (a dose taken early). Every finish is announced.
 */
export function HoldButton({ label, doneLabel, onDone, done = false, hold = 800, compact = false, quiet = false }: { label: string; doneLabel: string; onDone: () => void; done?: boolean; hold?: number; compact?: boolean; quiet?: boolean }) {
  const t = useT();
  const still = useReducedMotion();
  const p = useSharedValue(done ? 1 : 0);
  const [holding, setHolding] = useState(false);
  const finish = () => {
    if (process.env.EXPO_OS === "ios") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(doneLabel);
    onDone();
  };
  const start = () => {
    if (done) return;
    setHolding(true);
    if (process.env.EXPO_OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    p.set(withTiming(1, { duration: hold * (1 - p.get()), easing: Easing.linear }, ok => { if (ok) scheduleOnRN(finish); }));
  };
  const stop = () => {
    setHolding(false);
    if (done || p.get() >= 1) return;
    cancelAnimation(p);
    p.set(withTiming(0, { duration: 250 }));
  };
  const fill = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  const settle = useAnimatedStyle(() => ({ transform: [{ scale: done ? withSpring(1, { duration: 380, dampingRatio: 0.72 }) : withTiming(holding && !still ? 0.98 : 1, { duration: 120 }) }] }));
  const h = compact ? 44 : 56;
  const ink = quiet ? palette.ink : palette.white;
  return <Pressable accessibilityRole="button" accessibilityLabel={done ? doneLabel : label} accessibilityHint={done ? undefined : t("common.holdHint")} accessibilityState={{ disabled: done }}
    onPressIn={start} onPressOut={stop} disabled={done}
    onAccessibilityTap={() => { if (!done) finish(); }}>
    <Animated.View style={[{ minHeight: h, borderRadius: h / 2, overflow: "hidden", alignItems: "center", justifyContent: "center", paddingHorizontal: compact ? 12 : 20,
      backgroundColor: done ? palette.white : quiet ? palette.white : palette.dark, borderWidth: 1, borderColor: done || quiet ? "#EDEDED" : palette.dark }, settle]}>
      {!done && <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, bottom: 0, experimental_backgroundImage: `linear-gradient(135deg, ${accent[1]}, ${accent[2]})` } as ViewStyle, fill]} />}
      <Text numberOfLines={2} style={{ fontSize: compact ? 13 : 16, fontWeight: "700", textAlign: "center", color: done ? palette.green : holding && quiet ? palette.white : ink }}>{done ? `✓  ${doneLabel}` : holding ? t("common.keepHolding") : label}</Text>
    </Animated.View>
  </Pressable>;
}

/** The glass back button for screens off the dock (no header band): back, or home if opened directly. */
export function BackButton({ label }: { label?: string }) {
  const t = useT();
  return <View style={{ alignSelf: "flex-start" }}><CircleButton icon="back" label={label ?? t("common.back")}onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} /></View>;
}

/**
 * What stands in when something could not load (never an endless spinner): one calm line in the
 * patient's words (the server's own refusal, or "check your connection") and one way to try again.
 */
export function LoadError({ query, style }: { query: { error: unknown; isFetching: boolean; refetch: () => unknown }; style?: ViewStyle }) {
  const lang = useLang(), t = tFor(lang);
  return <Card style={style}>
    <Text selectable accessibilityLiveRegion="polite" style={{ ...type.body, color: palette.muted }}>{errorText(query.error, lang, "common.loadError")}</Text>
    <Button quiet label={t("common.retry")} busy={query.isFetching} onPress={() => { void query.refetch(); }} />
  </Card>;
}

/** A tappable row inside a card: what it is, one line of state, and where it goes. */
export function Row({ title, line, tone = "muted", onPress, first }: { title: string; line: string; tone?: "muted" | "amber" | "red" | "green"; onPress: () => void; first?: boolean }) {
  const color = tone === "muted" ? palette.muted : palette[tone];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${line}`} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: "rgba(40,24,70,0.06)", opacity: pressed ? 0.6 : 1 })}>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ ...type.headline, color: palette.ink }}>{title}</Text>
      <Text numberOfLines={2} style={{ ...type.footnote, fontWeight: tone === "muted" ? "400" : "600", color }}>{line}</Text>
    </View>
    <Text style={{ fontSize: 20, color: palette.muted }}>›</Text>
  </Pressable>;
}

/** Text in the headline gradient (ink, then azure into violet), for the one bold line on a screen. */
export function AccentText({ children, style }: { children: string; style: TextStyle }) {
  return <MaskedView accessible={false} style={{ alignSelf: style.textAlign === "center" ? "center" : "flex-start", maxWidth: "100%" }} maskElement={<Text style={style}>{children}</Text>}>
    <View style={{ experimental_backgroundImage: `linear-gradient(100deg, ${accent[0]} 0%, ${accent[0]} 28%, ${accent[1]} 56%, ${accent[2]} 100%)` } as ViewStyle}>
      <Text style={[style, { opacity: 0 }]}>{children}</Text>
    </View>
  </MaskedView>;
}

/**
 * A screen title (the kit's two-line head): an optional light greeting or overline above, then the bold
 * title (the accent, the part to glance at, then the rest) as one line in the headline gradient, and one
 * line of insight under it, as in "Your / Medicines".
 */
export function Title({ overline, greeting, accent, children, line, lineTone = "muted" }: { overline?: string; greeting?: string; accent?: string; children?: string; line?: string; lineTone?: "muted" | "amber" | "green" | "red" }) {
  const big = { fontSize: 32, lineHeight: 38, letterSpacing: -2, fontWeight: "600" as const, color: palette.ink };
  return <View style={{ gap: 4 }} accessible accessibilityRole="header" accessibilityLabel={[greeting, `${accent ?? ""}${children ?? ""}`, line].filter(Boolean).join(". ")}>
    {overline && <Text style={{ ...type.overline, color: palette.blue }}>{overline}</Text>}
    {greeting && <Text style={{ ...type.greeting, color: palette.faint }}>{greeting}</Text>}
    <AccentText style={big}>{`${accent ?? ""}${children ?? ""}`}</AccentText>
    {line && <Text style={{ ...type.body, fontWeight: lineTone === "muted" ? "400" : "600", color: palette[lineTone], marginTop: 2 }}>{line}</Text>}
  </View>;
}

/** A two-line section head (the kit's "Today's / Latest Updates"): a light grey line over a bold one in the headline gradient, with an optional round action on the right. */
export function Section({ light, bold, action }: { light: string; bold: string; action?: ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
    <View accessible accessibilityRole="header" accessibilityLabel={`${light} ${bold}`} style={{ flexShrink: 1 }}>
      <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: "400", color: palette.faint, letterSpacing: -0.6 }}>{light}</Text>
      <AccentText style={{ fontSize: 28, lineHeight: 33, fontWeight: "600", color: palette.ink, letterSpacing: -1.9 }}>{bold}</AccentText>
    </View>
    {action}
  </View>;
}

/** A round glass icon button (the kit's 48–56 pt white-glass circle): back, close, add, bell, call. */
export function CircleButton({ icon, label, onPress, dot, tint = palette.ink, size = 48 }: { icon: IconName; label: string; onPress: () => void; dot?: boolean; tint?: string; size?: number }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={Math.max(0, (44 - size) / 2)} onPress={onPress}
    style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)", transform: [{ scale: pressed ? 0.94 : 1 }] })}>
    <Icon name={icon} size={Math.round(size * 0.44)} color={tint} />
    {dot && <View style={{ position: "absolute", top: size * 0.22, right: size * 0.24, width: 8, height: 8, borderRadius: 4, backgroundColor: palette.blue, borderWidth: 1.5, borderColor: palette.white }} />}
  </Pressable>;
}

/**
 * A quick-action key (the 2×2 shelf, after Sona Pro's quick actions): raised white glass that reads as pressable before it
 * is touched (a lit top edge and a 2 pt ledge that flattens as it sinks), the duotone glyph in a filled blue circle with a glow of
 * its own colour (orange when something waits on the patient), a small ↗ on a raised white disc in the corner, the label, and one line of live status (amber waiting, blue news).
 */
export function QuickKey({ icon, label, status, tone, onPress, hint }: { icon: IconName; label: string; status: string; tone?: "attention" | "news"; onPress: () => void; hint?: string }) {
  const fill = tone === "attention" ? palette.warning : palette.blue;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${status}`} accessibilityHint={hint} onPress={onPress} style={{ flex: 1 }}>
    {({ pressed }) => <View style={[surfaceStyle, { minHeight: 108, padding: 14, gap: 10, borderRadius: 24,
      boxShadow: pressed ? "inset 0 1px 0 #FFFFFF, 0 0 0 rgba(40,70,140,0)" : "inset 0 1px 0 #FFFFFF, 0 2px 0 rgba(40,70,140,0.10), 0 12px 24px -16px rgba(40,70,140,0.35)",
      transform: [{ translateY: pressed ? 2 : 0 }] } as ViewStyle]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: fill, boxShadow: `0 3px 8px ${tone === "attention" ? "rgba(249,115,22,0.3)" : "rgba(37,99,235,0.3)"}` }}>
          <Icon name={icon} size={20} color={palette.white} weight="duotone" duotoneColor={palette.white} />
        </View>
        {/* Raised white, as in Sona Pro: a grey disc sank into the grey glass. */}
        <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.9)", boxShadow: "0 1px 3px rgba(20,28,40,0.1)" }}>
          <Icon name="arrowUpRight" size={12} color={palette.muted} />
        </View>
      </View>
      <View style={{ gap: 1 }}>
        <Text numberOfLines={1} style={{ ...type.headline, color: palette.ink }}>{label}</Text>
        <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: tone ? "600" : "400", color: tone === "attention" ? palette.amber : tone === "news" ? palette.blue : palette.muted }}>{status}</Text>
      </View>
    </View>}
  </Pressable>;
}

/** A small white chip that does one thing (a quick reply, a needs shortcut, a filter). */
export function Chip({ label, onPress, dot, tone, accessibilityLabel }: { label: string; onPress: () => void; dot?: string; tone?: { bg: string; fg: string }; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}
    style={({ pressed }) => [pillStyle, { maxWidth: "100%", minHeight: 44, paddingHorizontal: 14, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 7, transform: [{ scale: pressed ? 0.96 : 1 }] }, tone && { backgroundColor: tone.bg, borderColor: tone.bg }]}>
    {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />}
    {/* Malay and Chinese run longer: a chip wraps to a second line rather than clipping. */}
    <Text style={{ flexShrink: 1, fontSize: 14, fontWeight: "500", color: tone?.fg ?? palette.ink }}>{label}</Text>
  </Pressable>;
}

// A field's resting edge: white on a visible edge, where the kit's #FAFAFA on a #F5F5F5 hairline vanished into the canvas.
const EDGE = "rgba(30,40,90,0.14)";
export const field = { minHeight: 52, borderRadius: 18, paddingHorizontal: 16, fontSize: 17, color: palette.ink, backgroundColor: palette.white, borderWidth: 1, borderColor: EDGE } as const;

// A small state change (focus, the eye, a button coming on): fast, with a strong ease-out and no spring.
const SNAP = { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) };

/**
 * A text field patients find at a glance (after Family's sign-up field): white with a visible edge and a soft lift,
 * ringed in blue while it is typed into. `secret`: a password, hidden until the eye is tapped; the eye crossfades to
 * the other glyph (after Family's stealth mode). The dots and letters swap at once, as in iOS: the system redraws a
 * secure field on its own clock (about 180 ms on the simulator), so a fade over it only lands on an empty field. The
 * secure entry stays the system's, so the keyboard never learns the password.
 */
export function Field({ secret, style, onFocus, onBlur, ref, ...props }: TextInputProps & { secret?: boolean; ref?: Ref<RNTextInput> }) {
  const still = useReducedMotion();
  const t = useT();
  const [shown, setShown] = useState(false);
  const focus = useSharedValue(0), eye = useSharedValue(0);
  const ring = useAnimatedStyle(() => ({ opacity: focus.get() }));
  const edge = useAnimatedStyle(() => ({ borderColor: interpolateColor(focus.get(), [0, 1], [EDGE, palette.blue]) }));
  // The glyph going away shrinks a touch as it fades and the new one grows into place (Family's 0.94).
  const showGlyph = useAnimatedStyle(() => ({ opacity: 1 - eye.get(), transform: [{ scale: still ? 1 : 1 - 0.06 * eye.get() }] }));
  const hideGlyph = useAnimatedStyle(() => ({ opacity: eye.get(), transform: [{ scale: still ? 1 : 0.94 + 0.06 * eye.get() }] }));
  const toggle = () => {
    if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
    eye.set(withTiming(shown ? 0 : 1, SNAP));
    setShown(!shown);
  };
  return <View>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", inset: -4, borderRadius: 22, borderCurve: "continuous", borderWidth: 4, borderColor: "rgba(37,99,235,0.16)" }, ring]} />
    <Animated.View style={[{ flexDirection: "row", alignItems: "center", borderRadius: 18, borderCurve: "continuous", borderWidth: 1, backgroundColor: palette.white,
      boxShadow: "0 1px 2px rgba(30,40,90,0.06)" }, edge]}>
      <TextInput ref={ref} placeholderTextColor={palette.faint} {...props} secureTextEntry={secret && !shown}
        onFocus={e => { focus.set(withTiming(1, SNAP)); onFocus?.(e); }} onBlur={e => { focus.set(withTiming(0, SNAP)); onBlur?.(e); }}
        style={[{ flex: 1, minHeight: 50, paddingHorizontal: 16, fontSize: 17, color: palette.ink }, secret && { paddingRight: 4 }, style]} />
      {secret && <Pressable accessibilityRole="button" accessibilityLabel={t(shown ? "common.hidePassword" : "common.showPassword")} onPress={toggle}
        style={{ width: 48, height: 48, marginRight: 2, alignItems: "center", justifyContent: "center" }}>
        {([["eye", showGlyph], ["eyeOff", hideGlyph]] as const).map(([name, glyph]) => <Animated.View key={name} style={[{ position: "absolute" }, glyph]}>
          <Icon name={name} color={palette.muted} />
        </Animated.View>)}
      </Pressable>}
    </Animated.View>
  </View>;
}

/*
 * Honesty, two truths, two treatments (mirrors apps/native model-answer). The data is fictional, so
 * that is said once, on home (DataPill). An answer no model gave is labelled where it appears
 * (SampleLabel), driven by the server's `source`, so it goes by itself once a model answers. Both open
 * the same short sheet (app/about-data).
 */
const openAbout = () => router.push("/about-data");

/** The one "Synthetic data" signal: a quiet glass pill with a dotted halftone accent; tap for what is fictional. */
export function DataPill() {
  const t = useT();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("synthetic.pill")} accessibilityHint={t("synthetic.pillHint")} onPress={openAbout} hitSlop={10}
    style={({ pressed }) => [pillStyle, { alignSelf: "center", minHeight: 30, paddingHorizontal: 12, justifyContent: "center", overflow: "hidden", transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    <HalftoneGlint width={40} height={30} origin={[0, 15]} reach={[38, 20]} pitch={3} strength={0.9} style={{ top: 0, left: 0 }} />
    <Text style={{ fontSize: 13, lineHeight: 17, fontWeight: "600", color: palette.muted }}>{t("synthetic.pill")}</Text>
  </Pressable>;
}

/** "Sample · <what> model not switched on" under an answer no model gave (`source` "fixture"); nothing once a model answers. */
export function SampleLabel({ source, what }: { source?: string; what: "photo" }) {
  const t = useT();
  if (source !== "fixture") return null;
  const text = t("sample.model", { what: t(`sample.${what}`) });
  return <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityHint={t("sample.hint")} onPress={openAbout} hitSlop={12}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, opacity: pressed ? 0.6 : 1 })}>
    <Text style={{ ...type.footnote, flexShrink: 1, color: palette.muted }}>{text}</Text>
    <Icon name="info" size={14} color={palette.muted} />
  </Pressable>;
}
