import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, AppState, Linking, Pressable, Switch, View } from "react-native";
import { useDischarge } from "@/features/discharge/row";
import { useMe } from "@/features/me";
import type { Permission } from "@/features/notifications/model";
import { useClockOffset } from "@/lib/clock";
import { tFor, useLang } from "@/lib/i18n";
import { Icon } from "@/lib/icons";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { Button, Card, surfaceStyle } from "@/lib/ui";
import { useSnooze } from "./index";
import { subscribe as onTaken, takenNow } from "./log";
import { doseReminders, REMINDER_PREFIX, reminderUrl, type Reminder } from "./reminders";
import "./strings";

/**
 * Local dose reminders (features/doses/reminders.ts decides which). The patient switches them on once,
 * in context on the Medicine screen, or later from Settings or the Medicine shelf; the choice is kept on the phone. While on
 * and allowed, the phone holds a notification for each dose in the next week, rebuilt whenever the plan,
 * a taken dose, the demo clock, the language, a "Remind me later" or the app coming back to the foreground changes things.
 * The lock screen shows only "Sona Care · Time for your medicine", never the medicine.
 */
const KEY = "sona-care.reminders";
type Choice = "on" | "off";
type State = { loaded: boolean; choice?: Choice; permission?: Permission };
let state: State = { loaded: false };
const listeners = new Set<() => void>();
const put = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
void SecureStore.getItemAsync(KEY).then(v => put({ loaded: true, choice: v === "on" || v === "off" ? v : undefined }), () => put({ loaded: true }));
const readPermission = () => Notifications.getPermissionsAsync().then(p => put({ permission: p.status as Permission }), () => {});
void readPermission();

/** The patient's choice and the phone's permission; `on` only when both say yes. */
export function useReminders() {
  const s = useSyncExternalStore(subscribe, () => state);
  return { ...s, on: s.choice === "on" && s.permission === "granted" };
}

/** Asks the phone (it shows its prompt only the first time); whether notifications are allowed. */
const request = () => Notifications.requestPermissionsAsync().then(p => { put({ permission: p.status as Permission }); return p.granted; }, () => false);

/** Switches reminders on (asking the phone once) or off; says how it went. */
export async function setReminders(on: boolean): Promise<"on" | "blocked" | "off"> {
  const choice: Choice = on ? "on" : "off";
  put({ choice });
  void SecureStore.setItemAsync(KEY, choice).catch(() => {});
  if (!on) return "off";
  return await request() ? "on" : "blocked";
}

/** "Remind me later" asks the phone once if it never has, even with dose reminders off; DoseReminders then holds that reminder. */
export const askOnce = () => { if (state.permission === "undetermined") void request(); };

// One rebuild at a time: cancel every reminder of ours (IDs start "dose:"), then set the new ones.
let queue = Promise.resolve();
function hold(list: Reminder[], body: string) {
  queue = queue.then(async () => {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(pending.filter(n => n.identifier.startsWith(REMINDER_PREFIX)).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    for (const r of list) await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: "Sona Care", body, data: { url: reminderUrl(r.doseKey) } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
    });
  }).catch(() => {});
}

/** Mounted once at the root: keeps the phone's dose reminders in step with the plan. */
export function DoseReminders() {
  const { state: me } = useMe();
  const { data } = useDischarge();
  const taken = useSyncExternalStore(onTaken, takenNow);
  const offset = useClockOffset();
  const lang = useLang();
  const { loaded, permission, on } = useReminders();
  const later = useSnooze();
  const [woke, setWoke] = useState(0);
  useEffect(() => {
    // Back from Settings (or anywhere): the permission may have changed, and the week ahead has moved on.
    const sub = AppState.addEventListener("change", s => { if (s === "active") { void readPermission(); setWoke(n => n + 1); } });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    // Nothing until the choice and the permission are read, so a cold start never clears reminders it cannot rebuild.
    if (!loaded || !permission || me === "loading") return;
    const body = tFor(lang)("reminders.body");
    if (permission !== "granted" || me === "signed-out" || data?.status === "in-hospital") return hold([], body);
    // Plan not read (starting offline, or the record unreachable): keep what the phone already holds.
    if (data?.status !== "discharged") return;
    // With reminders off, only a "Remind me later" is held: the patient asked for that one.
    const meds = on ? [...data.medicines.new, ...data.medicines.changed, ...data.medicines.continue] : [];
    hold(doseReminders({ meds, dischargedAt: data.dischargedAt, taken, now: new Date(), offsetMs: offset, later }), body);
  }, [loaded, permission, on, me, data, taken, offset, lang, woke, later]);
  return null;
}

/**
 * The Medicine screen's one ask, in context: "Remind me at dose times" with a switch. Shown until the
 * patient chooses; after that only to confirm the choice this visit, or while the phone blocks it
 * ("Reminders are off · Turn on in Settings" with the way there). Home's row changes it later.
 */
export function RemindCard() {
  const t = tFor(useLang());
  const { loaded, choice, permission, on } = useReminders();
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = choice === "on" && permission !== undefined && permission !== "granted";
  // Once on, it says so for a moment and steps aside: a setting, not something to keep reading.
  useEffect(() => { if (!(on && asked)) return; const timer = setTimeout(() => setAsked(false), 3500); return () => clearTimeout(timer); }, [on, asked]);
  if (!loaded || (choice !== undefined && !asked && !blocked)) return null;
  const toggle = async (to: boolean) => {
    setBusy(true); setAsked(true);
    const result = await setReminders(to);
    setBusy(false);
    AccessibilityInfo.announceForAccessibility(t(result === "on" ? "reminders.on" : result === "blocked" ? "reminders.off" : "reminders.rowOff"));
  };
  return <Card>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on, busy }} accessibilityLabel={t("reminders.title")} accessibilityHint={t("reminders.line")}
      disabled={busy} onPress={() => { void toggle(!on); }} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ ...type.headline, color: palette.ink }}>{t("reminders.title")}</Text>
        <Text style={{ ...type.footnote, color: palette.muted }}>{t("reminders.line")}</Text>
      </View>
      <Switch accessible={false} value={on} disabled={busy} onValueChange={to => { void toggle(to); }} trackColor={{ true: palette.green }} />
    </Pressable>
    {blocked ? <View style={{ gap: 10 }}>
      <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.amber }}>{t("reminders.off")}</Text>
      <Button quiet label={t("reminders.settings")} onPress={() => { void Linking.openSettings(); }} />
    </View>
      : on && asked ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, fontWeight: "600", color: palette.green }}>{t("reminders.on")}</Text> : null}
  </Card>;
}

/** The reminders switch wherever it sits: off at once; on asks the phone, or opens Settings when the phone blocks them. */
function useRemindersSwitch() {
  const t = tFor(useLang());
  const { on } = useReminders();
  const toggle = (to: boolean) => void setReminders(to).then(result => {
    if (result === "blocked") void Linking.openSettings();
    else AccessibilityInfo.announceForAccessibility(`${t("reminders.row")}: ${t(result === "on" ? "reminders.rowOn" : "reminders.rowOff")}`);
  });
  return { t, on, toggle };
}

/** Settings' row: "Dose reminders" with a real switch; the whole row toggles it. */
export function RemindersRow() {
  const { t, on, toggle } = useRemindersSwitch();
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={t("reminders.row")} accessibilityHint={t("reminders.hint")}
    onPress={() => toggle(!on)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 }}>
    <Text style={{ flex: 1, ...type.footnote, fontWeight: "600", color: palette.muted }}>{t("reminders.row")}</Text>
    <Switch accessible={false} value={on} onValueChange={toggle} trackColor={{ true: palette.green }} />
  </Pressable>;
}

/** The Medicine shelf's key for reminders: a quick key's glass and glyph, with a real switch where the others point away (it opens nothing). */
export function RemindersKey() {
  const { t, on, toggle } = useRemindersSwitch();
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={t("reminders.row")} accessibilityHint={t("reminders.hint")}
    onPress={() => toggle(!on)} style={[surfaceStyle, { flex: 1, minHeight: 108, padding: 14, justifyContent: "space-between" }]}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: palette.blue }}>
        <Icon name="alarm" size={20} color={palette.white} weight="duotone" duotoneColor={palette.white} />
      </View>
      <Switch accessible={false} value={on} onValueChange={toggle} trackColor={{ true: palette.green }} />
    </View>
    <Text numberOfLines={1} style={{ ...type.headline, color: palette.ink }}>{t("reminders.row")}</Text>
  </Pressable>;
}
