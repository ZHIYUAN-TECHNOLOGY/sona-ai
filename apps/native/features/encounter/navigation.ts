import { router } from "expo-router";

/**
 * A session is one patient visit's conversation. Home never shows answers: asking, tapping a
 * visit or resuming from history opens that visit's session screen. `next`/`prompt` ask a
 * question on arrival; `view` opens a tool page (recording, note, X-ray, tasks) on top of it.
 */
export function openSession(patientId: string, params: { next?: string; prompt?: string; view?: string } = {}, replace = false) {
  const to = { pathname: "/session/[patientId]" as const, params: { patientId, ...params } };
  if (replace) router.replace(to); else router.push(to);
}
