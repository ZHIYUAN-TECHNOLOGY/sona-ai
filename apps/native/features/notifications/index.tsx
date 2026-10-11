import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { api, useLive } from "@/features/live";
import { useRole } from "@/features/live/roles";

/**
 * Sona Pro push (sent by packages/api/src/push.ts tellStaff): what puts a row on My Day (a patient worse or urgent at
 * home, an urgent message, a booking request, doses missed, a critical result) reaches a locked phone too. With the app
 * open, My Day and the critical banner already show it, so no banner; it still lands in Notification Centre.
 * Tapping one opens My Day. Only roles that may read clinical detail register (staffPush.register in roles.ts).
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let phone: string | undefined;

/** Before signing out: this phone stops hearing about the hospital's patients. */
export async function forgetPhone() {
  if (phone) await api.staffPush.unregister({ token: phone }).catch(() => {});
  phone = undefined;
}

/** Mounted once at the root: a signed-in clinician's phone asks once, registers, and a tap opens My Day. */
export function StaffPush() {
  const { on, user } = useLive();
  const { known, can } = useRole();
  const allowed = on && Boolean(user) && known && can("staffPush.register");
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => router.navigate("/"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!allowed) return;
    void (async () => {
      // iOS shows its prompt only the first time; after that this just reads the answer.
      if (!(await Notifications.requestPermissionsAsync()).granted) return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      // Expo Go and a build without an EAS project cannot get a token: in-app rows still work.
      if (!projectId) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      await api.staffPush.register({ token, platform: Platform.OS === "android" ? "android" : "ios" });
      phone = token;
    })().catch(() => {});
  }, [allowed]);
  return null;
}
