import * as Haptics from "expo-haptics";
import { can, refusal, ROLE_LABEL, type Role } from "@sona-ai/api/roles";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Icon, useAccessibleEffects } from "@/components/sona/ui";
import { api, useLive } from ".";
import { ago, trailLine } from "./access";
import { useLiveChanges } from "./channel";

/**
 * Clinician roles in the app. The permission table is the server's own (@sona-ai/api/roles), so
 * what the app hides or explains is exactly what the server would refuse. Fixture mode is always a
 * doctor; in live mode the role comes from clinician.me once per signed-in account.
 */
let known: { userId: string; role: Role } | undefined;

export function useRole() {
  const { on, user } = useLive();
  const [mine, setMine] = useState(known);
  const userId = user?.id;
  useEffect(() => {
    if (!on || !userId) return;
    if (known?.userId === userId) { setMine(known); return; }
    void api.clinician.me().then(me => { known = { userId, role: me.role }; setMine(known); }, () => {});
  }, [on, userId]);
  // Until the role arrives, nothing is hidden; the server still refuses what the role cannot do.
  const role = on && mine?.userId === userId ? mine?.role : undefined;
  const current: Role = role ?? "doctor";
  return {
    role: current, label: ROLE_LABEL[current], known: Boolean(role),
    can: (path: string) => can(current, path),
    /** The server's own refusal ("Nurses can't approve a discharge. Ask the attending doctor."). */
    why: (path: string) => refusal(current, path),
  };
}

/** Settings: the role pill beside "Signed in as …" (Doctor, Nurse, Bed manager, Management). */
export function RolePill({ label }: { label: string }) {
  const { reducedMotion } = useAccessibleEffects();
  return <Animated.View entering={reducedMotion ? undefined : riseIn({ distance: 4, scale: 0.9, duration: 300 })} accessible accessibilityLabel={`Role: ${label}`}
    style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: palette.blueWash }}>
    <Icon name="person.badge.shield.checkmark" size={12} color={palette.blue} />
    <Text style={{ ...type.caption, fontWeight: "700", color: palette.blue }}>{label}</Text>
  </Animated.View>;
}

/*
 * A locked action (after Opal's "Locked" gem wiggle, 60fps.design/shots/opal-gem-wiggle-interaction):
 * it stays in place, reads "Needs a doctor's approval" with a lock, and a tap shakes it left and right
 * in a fast decaying oscillation (spring settle) with a warning haptic, then says who can do it. So a
 * nurse learns why without a dead button. Reduce Motion: no shake, the reason still appears.
 */
export function LockedAction({ label, path, height = 52 }: { label: string; path: string; height?: number }) {
  const { why } = useRole();
  const { reducedMotion } = useAccessibleEffects();
  const [told, setTold] = useState(false);
  const x = useSharedValue(0);
  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const reason = why(path);
  const tap = () => {
    if (process.env.EXPO_OS === "ios") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    if (!reducedMotion) x.set(withSequence(withTiming(-8, { duration: 45 }), withTiming(7, { duration: 70 }), withTiming(-5, { duration: 60 }), withTiming(3, { duration: 50 }), withSpring(0, { duration: 260, dampingRatio: 0.5 })));
    setTold(true);
  };
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={`${label}. Locked`} accessibilityHint={reason} onPress={tap}>
      <Animated.View style={[{ height, borderRadius: height / 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(20,28,40,0.06)", borderWidth: 1, borderColor: "rgba(20,28,40,0.06)" }, shake]}>
        <Icon name="lock.fill" size={14} color={palette.muted} />
        <Text style={{ fontSize: 16, fontWeight: "600", color: palette.muted }}>{label}</Text>
      </Animated.View>
    </Pressable>
    {told && reason && <Animated.Text entering={reducedMotion ? undefined : FadeIn.duration(180)} accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{reason}</Animated.Text>}
  </View>;
}

/*
 * "Who opened this record" (PDPA access trail) for doctors and management, live mode only: the latest
 * 10 accesses, newest first, with relative times from the server's clock. Rows rise in after Vakitler's
 * list fade-in (60fps.design/shots/vakitler-list-fade-in-interaction): each slides up a few points and
 * fades on an ease-out, with a subtle 50 ms stagger, so the eye moves down the trail without a jolt.
 * Reduce Motion: rows appear in place.
 */
type Trail = Awaited<ReturnType<typeof api.accessLog.list>>;
export function AccessTrail({ patientId, encounterId, entering }: { patientId: string; encounterId?: string; entering?: ReturnType<typeof riseIn> }) {
  const { on } = useLive();
  const { can: allowed } = useRole();
  const { reducedMotion } = useAccessibleEffects();
  const [trail, setTrail] = useState<Trail>();
  const show = on && allowed("accessLog.list");
  const read = useCallback(() => { if (show) void api.accessLog.list({ patientId }).then(setTrail, () => {}); }, [show, patientId]);
  useEffect(read, [read]);
  useLiveChanges(["visit"], read, encounterId);
  if (!show || !trail) return null;
  return <Animated.View entering={entering} style={{ gap: 8 }}>
    <Text style={{ ...type.overline, color: palette.muted }}>Who opened this record</Text>
    {trail.lines.length ? <View style={{ borderRadius: 18, borderCurve: "continuous", backgroundColor: palette.white, paddingVertical: 4 }}>
      {trail.lines.map((line, i) => <Animated.View key={`${line.userId}-${line.route}-${new Date(line.at).getTime()}`} accessible accessibilityLabel={`${trailLine(line)}, ${ago(line.at, trail.now)}`}
        entering={reducedMotion ? undefined : riseIn({ delay: 80 + i * 50, distance: 8, duration: 360 })}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderColor: "rgba(20,28,40,0.06)" }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i ? "rgba(20,28,40,0.2)" : palette.blue }} />
        <Text numberOfLines={2} style={{ ...type.footnote, flex: 1, color: palette.ink }}><Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>{line.who}</Text> · {line.did}{line.times > 1 ? ` ×${line.times}` : ""}</Text>
        <Text style={{ ...type.caption, color: palette.muted, fontVariant: ["tabular-nums"] }}>{ago(line.at, trail.now)}</Text>
      </Animated.View>)}
    </View> : <Text style={{ ...type.footnote, color: palette.muted }}>No access recorded yet.</Text>}
  </Animated.View>;
}
