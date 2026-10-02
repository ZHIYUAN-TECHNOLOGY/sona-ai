import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, AppState, Linking, Pressable, Switch, View } from "react-native";
import { useDischarge } from "@/features/discharge/row";
import { useMe } from "@/features/me";
import type { Permission } from "@/features/notifications/model";
import { useClockOffset } from "@/lib/clock";
import { tFor, useLang } from "@/lib/i18n";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";
import { Button, Card } from "@/lib/ui";
import { subscribe as onTaken, takenNow } from "./log";
import { doseReminders, REMINDER_PREFIX, reminderUrl, type Reminder } from "./reminders";
import "./strings";

/**
 * Local dose reminders (features/doses/reminders.ts decides which). The patient switches them on once,
 * in context on the Medicine screen, or later from home's row; the choice is kept on the phone. While on
 * and allowed, the phone holds a notification for each dose in the next week, rebuilt whenever the plan,
 * a taken dose, the demo clock, the language or the app coming back to the foreground changes things.
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

/** Switches reminders on (asking the phone once) or off; says how it went. */
export async function setReminders(on: boolean): Promise<"on" | "blocked" | "off"> {
  const choice: Choice = on ? "on" : "off";
  put({ choice });
  void SecureStore.setItemAsync(KEY, choice).catch(() => {});
  if (!on) return "off";
  const asked = await Notifications.requestPermissionsAsync().catch(() => undefined);
  put({ permission: (asked?.status as Permission | undefined) ?? state.permission });
  return asked?.granted ? "on" : "blocked";
}

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
    if (!on || me === "signed-out" || data?.status === "in-hospital") return hold([], body);
    // Plan not read (starting offline, or the record unreachable): keep what the phone already holds.
    if (data?.status !== "discharged") return;
    const meds = [...data.medicines.new, ...data.medicines.changed, ...data.medicines.continue];
    hold(doseReminders({ meds, dischargedAt: data.dischargedAt, taken, now: new Date(), offsetMs: offset }), body);
  }, [loaded, permission, on, me, data, taken, offset, lang, woke]);
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

/** Home's quiet row beside Language: "Dose reminders · On". Off turns them off; On asks the phone, or opens Settings if it blocks them. */
export function RemindersRow() {
  const t = tFor(useLang());
  const { on } = useReminders();
  const label = on ? t("reminders.rowOn") : t("reminders.rowOff");
  const toggle = async () => {
    const result = await setReminders(!on);
    if (result === "blocked") void Linking.openSettings();
    else AccessibilityInfo.announceForAccessibility(`${t("reminders.row")}: ${t(result === "on" ? "reminders.rowOn" : "reminders.rowOff")}`);
  };
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={t("reminders.row")} accessibilityHint={t("reminders.hint")}
    onPress={() => { void toggle(); }} style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{t("reminders.row")} · <Text style={{ color: on ? palette.green : palette.blue }}>{label}</Text></Text>
  </Pressable>;
}
