import { router } from "expo-router";

/**
 * A session is one patient visit's conversation. Home never shows answers: asking, tapping a
 * visit or resuming from history opens that visit's session screen. `next`/`prompt` ask a
 * question on arrival; `view` opens a tool page (recording, note, X-ray, tasks) on top of it once
 * the visit has arrived. `quiet`: a sheet closing over the visit is the one transition, so the
 * visit is placed under it without its own slide (two at once read as a stutter).
 */
export function openSession(patientId: string, params: { next?: string; prompt?: string; view?: string; quiet?: boolean } = {}, replace = false) {
  const { quiet, ...rest } = params;
  const to = { pathname: "/session/[patientId]" as const, params: { patientId, ...rest, ...quiet && { quiet: "1" } } };
  if (replace) router.replace(to); else router.push(to);
}

/**
 * Leaves a sheet (`sheet`: its screen's navigation) for a visit in one navigation: the sheet slides down over the visit,
 * which is already in place, rather than closing on a timer while the visit pushes in behind it.
 */
export function openSessionFromSheet(sheet: { goBack: () => void }, patientId: string, params: { next?: string; prompt?: string; view?: string } = {}, replace = false) {
  sheet.goBack();
  openSession(patientId, { ...params, quiet: true }, replace);
}
