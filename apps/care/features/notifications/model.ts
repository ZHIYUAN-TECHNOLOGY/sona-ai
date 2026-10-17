/** Push notifications, the plain parts (no React Native), so bun can test them. */

/** The screens a notification may open: pushes (packages/api/src/push.ts) and the local dose reminders (/dose). */
const ROUTES = ["/check-ins", "/follow-ups", "/messages", "/dose"] as const;
export type PushRoute = (typeof ROUTES)[number] | `/dose?key=${string}`;

/**
 * "sona-care:///follow-ups" (a notification's data.url) → "/follow-ups"; a dose reminder keeps its dose
 * ("sona-care:///dose?key=…" → "/dose?key=…"); anything else opens nothing.
 */
export function routeOf(url: unknown): PushRoute | undefined {
  if (typeof url !== "string") return undefined;
  const [path, query = ""] = url.replace(/^sona-care:\/\//, "").split("?");
  const route = ROUTES.find(r => r === path);
  // Read by hand: React Native's URLSearchParams has no get() on every version.
  const key = route === "/dose" ? /(?:^|&)key=([^&]+)/.exec(query)?.[1] : undefined;
  return key ? `/dose?key=${key}` : route;
}

/** What the patient chose on the home card ("on", or "later" for Not now); undefined until they choose. */
export type NudgeChoice = "on" | "later" | undefined;
/** iOS/Android permission as expo-notifications reports it. */
export type Permission = "granted" | "denied" | "undetermined";

/** The home card asks once: only before a choice, and never when the phone already allows notifications. */
export const asksForNudges = (choice: NudgeChoice, permission: Permission | undefined) =>
  choice === undefined && permission !== undefined && permission !== "granted";
