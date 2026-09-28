/** Push notifications, the plain parts (no React Native), so bun can test them. */

/** The screens a push may open (packages/api/src/push.ts). */
const ROUTES = ["/check-ins", "/follow-ups", "/messages"] as const;
export type PushRoute = (typeof ROUTES)[number];

/** "sona-care:///follow-ups" (a push's data.url) → "/follow-ups"; anything else opens nothing. */
export function routeOf(url: unknown): PushRoute | undefined {
  if (typeof url !== "string") return undefined;
  const path = url.replace(/^sona-care:\/\//, "").split("?")[0];
  return ROUTES.find(r => r === path);
}

/** What the patient chose on the home card ("on", or "later" for Not now); undefined until they choose. */
export type NudgeChoice = "on" | "later" | undefined;
/** iOS/Android permission as expo-notifications reports it. */
export type Permission = "granted" | "denied" | "undetermined";

/** The home card asks once: only before a choice, and never when the phone already allows notifications. */
export const asksForNudges = (choice: NudgeChoice, permission: Permission | undefined) =>
  choice === undefined && permission !== undefined && permission !== "granted";
