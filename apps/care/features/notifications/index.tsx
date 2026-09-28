import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Linking, Platform, View, type ViewStyle } from "react-native";
import Animated, { Easing, FadeOut, useReducedMotion, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useMe } from "@/features/me";
import { Text } from "@/lib/text";
import { accent, palette, type } from "@/lib/theme";
import { Button, Card, ICON, pillStyle } from "@/lib/ui";
import { client } from "@/utils/orpc";
import { formatDate, tFor, useLang } from "@/lib/i18n";
import { asksForNudges, routeOf, type NudgeChoice, type Permission } from "./model";
import "./strings";

/**
 * Sona Care push notifications (sent by packages/api/src/push.ts): check-ins, bookings, tests added to a
 * visit and care-team replies. Shown as a banner while the app is open; tapping one opens its screen.
 * The phone's Expo push token needs an EAS projectId (app config extra.eas.projectId), so Expo Go and
 * a build without one can't register; the home card then says so instead of failing.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const KEY = "sona-care.nudges";
let phone: string | undefined;

/** This phone's Expo push token, registered to the patient's account; throws when there is none to get. */
async function register() {
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Sona Care", importance: Notifications.AndroidImportance.HIGH });
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error("No EAS projectId");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await client.care.push.register({ token, platform: Platform.OS === "android" ? "android" : "ios" });
  phone = token;
}

/** Before signing out: this phone stops hearing about this patient. */
export async function forgetPhone() {
  if (phone) await client.care.push.unregister({ token: phone }).catch(() => {});
  phone = undefined;
}

/**
 * Mounted once at the root: a tap on a notification opens its screen (including the tap that launched
 * the app), and a joined patient whose phone already allows notifications re-registers on start (the
 * token can change after a reinstall or restore).
 */
export function PushSetup() {
  const joined = useMe().state === "joined";
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const to = routeOf(response?.notification.request.content.data?.url);
      if (to) router.push(to);
    };
    open(Notifications.getLastNotificationResponse());
    Notifications.clearLastNotificationResponse();
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!joined) return;
    void Notifications.getPermissionsAsync().then(p => (p.granted ? register() : undefined)).catch(() => {});
  }, [joined]);
  return null;
}

type Step = "ask" | "busy" | "on" | "blocked" | "needs-app";
const LINE: Record<Exclude<Step, "ask" | "busy">, { key: string; color: string }> = {
  on: { key: "nudge.on", color: palette.green },
  blocked: { key: "nudge.blocked", color: palette.amber },
  "needs-app": { key: "nudge.needsApp", color: palette.muted },
};
/** The sample notification's time: Thu 1 Oct, 9:00 AM in Malaysia. */
const SAMPLE_AT = "2026-10-01T01:00:00Z";

// Motion after 60fps "The Outsiders Allow Notifications Animation" (https://60fps.design/shots/the-outsiders-allow-notifications-animation):
// the card fades in, a sample notification slides down into it, then the actions rise, staggered, all
// ease-out. The shot's typing effect is left out for a calm patient screen. Reduce Motion: fades only.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const arrive = (delay: number, from: number, still: boolean) => () => {
  "worklet";
  const t = (v: number) => withDelay(delay, withTiming(v, { duration: 360, easing: EASE_OUT }));
  return { initialValues: { opacity: 0, transform: [{ translateY: still ? 0 : from }] }, animations: { opacity: t(1), transform: [{ translateY: t(0) }] } };
};

/**
 * Home's one-time ask (never at launch): a small glass card showing what a nudge looks like, with
 * Turn on / Not now. The choice is remembered on the phone; the system prompt only comes after Turn on.
 */
export function NudgeCard() {
  const still = useReducedMotion();
  const lang = useLang(), t = tFor(lang);
  const [choice, setChoice] = useState<NudgeChoice | null>(null);
  const [permission, setPermission] = useState<Permission>();
  const [step, setStep] = useState<Step>("ask");
  useEffect(() => {
    void SecureStore.getItemAsync(KEY).then(v => setChoice((v as NudgeChoice) ?? undefined)).catch(() => setChoice(undefined));
    void Notifications.getPermissionsAsync().then(p => setPermission(p.status as Permission)).catch(() => {});
  }, []);
  const remember = (c: Exclude<NudgeChoice, undefined>) => { void SecureStore.setItemAsync(KEY, c).catch(() => {}); };
  const settle = (next: Step) => { setStep(next); if (next !== "ask" && next !== "busy") AccessibilityInfo.announceForAccessibility(t(LINE[next].key)); };
  const turnOn = async () => {
    setStep("busy");
    const asked = await Notifications.requestPermissionsAsync().catch(() => undefined);
    if (!asked?.granted) return settle("blocked");
    try { await register(); remember("on"); settle("on"); } catch { remember("later"); settle("needs-app"); }
  };
  const later = () => { remember("later"); setChoice("later"); setStep("ask"); };
  // Asked this session: stay to show how it went, until the patient leaves home.
  if (step === "ask" && (choice === null || !asksForNudges(choice, permission))) return null;
  const done = step !== "ask" && step !== "busy";
  const example = t("nudge.example", { when: formatDate(lang, SAMPLE_AT, "dayTime") });
  return <Animated.View entering={arrive(0, 8, still)} exiting={FadeOut.duration(200)}>
    <Card>
      <Animated.View entering={arrive(160, -12, still)} accessible accessibilityLabel={t("nudge.exampleA11y", { text: example })}
        style={[pillStyle, { borderRadius: 18, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 }]}>
        <View style={{ width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", experimental_backgroundImage: `linear-gradient(135deg, ${accent[1]}, ${accent[2]})` } as ViewStyle}>
          <Svg width={16} height={16} viewBox="0 0 24 24"><Path d={ICON.bell} fill="none" stroke={palette.white} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink }}>Sona Care <Text style={{ fontWeight: "400", color: palette.faint }}>{t("nudge.now")}</Text></Text>
          <Text numberOfLines={2} style={{ ...type.footnote, color: palette.muted }}>{example}</Text>
        </View>
      </Animated.View>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: palette.ink }}>{t("nudge.title")}</Text>
        <Text style={{ ...type.body, color: palette.muted }}>{t("nudge.line")}</Text>
      </View>
      {done
        ? <Animated.View key={step} entering={arrive(0, 6, still)} style={{ gap: 12 }}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: LINE[step].color }}>{t(LINE[step].key)}</Text>
          {step === "blocked" && <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button label={t("nudge.settings")} onPress={() => { void Linking.openSettings(); }} /></View>
            <View style={{ flex: 1 }}><Button quiet label={t("nudge.later")} onPress={later} /></View>
          </View>}
        </Animated.View>
        : <View style={{ flexDirection: "row", gap: 8 }}>
          <Animated.View entering={arrive(280, 8, still)} style={{ flex: 1 }}><Button label={t("nudge.turnOn")} busy={step === "busy"} onPress={() => { void turnOn(); }} /></Animated.View>
          <Animated.View entering={arrive(360, 8, still)} style={{ flex: 1 }}><Button quiet label={t("nudge.later")} disabled={step === "busy"} onPress={later} /></Animated.View>
        </View>}
    </Card>
  </Animated.View>;
}
