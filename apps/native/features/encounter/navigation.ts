import { router, useFocusEffect, useNavigation } from "expo-router";
import { useCallback } from "react";

const VISIT = "session/[patientId]";
// After Today comes into focus: past the pop's ~470 ms slide back to it, so the build never lands on a moving frame.
const PRELOAD_AFTER_MS = 700;

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
 * Today builds the next visit's page while it sits still (a preloaded route: rendered off screen, never focused), so a tap
 * only slides in a page already made. Built on the tap, the visit's whole tree rendered on the JS thread (190-340 ms) before
 * the push could start, and its native views (glass, blur, canvases) mounted on the UI thread in the push's first frames
 * (150-180 ms frames on the simulator). Any visit's push takes the preloaded page (the stack matches it by route name, and
 * the push's params re-render it for the patient tapped): `patientId`, the likeliest, only saves that re-render.
 * The visit's own arrival (selecting the patient, a question asked on the way in) waits for its focus, as before.
 */
export function usePreloadVisit(patientId: string | undefined) {
  const navigation = useNavigation();
  useFocusEffect(useCallback(() => {
    if (!patientId) return;
    const timer = setTimeout(() => {
      // One at a time: a second preload of the same route replaces the first, and would build the page again.
      if ((navigation.getState() as { preloadedRoutes?: { name: string }[] } | undefined)?.preloadedRoutes?.some(r => r.name === VISIT)) return;
      router.prefetch({ pathname: "/session/[patientId]", params: { patientId } });
    }, PRELOAD_AFTER_MS);
    return () => clearTimeout(timer);
  }, [patientId, navigation]));
}

/**
 * Whether a visit is pushed somewhere over this screen (`key`). Its every write (start, stop, each cut of a consultation)
 * re-rendered all of them, Today under the visit included (Stop: 5 screen renders and 194 ms of JS at once on the
 * simulator; 3 with the covered ones left alone). The native stack freezes only screens neither on top nor just under it (the
 * swipe back shows that one) nor modal, so a frozen one here sits under an opaque visit and is never seen.
 */
export const underVisit = (routes: readonly { key: string; name: string }[], key: string) =>
  routes.slice(routes.findIndex(r => r.key === key) + 1).some(r => r.name === "session/[patientId]");

type Stacked = { getState: () => { routes: readonly { name: string; params?: object }[] } | undefined };

/**
 * Goes back to a page already open under this one (`name`, a route of the stack `navigation` belongs to; `patientId`: only
 * that patient's copy), popping what lies between in one transition. False when it is not open, so the caller opens it.
 */
export function backTo(navigation: Stacked, name: string, patientId?: string) {
  const routes = navigation.getState()?.routes ?? [];
  for (let i = routes.length - 2; i >= 0; i--) {
    const route = routes[i]!;
    if (route.name !== name || (patientId && (route.params as { patientId?: string } | undefined)?.patientId !== patientId)) continue;
    router.dismiss(routes.length - 1 - i);
    return true;
  }
  return false;
}

/**
 * Opens a visit's page, or returns to it when it is already open under this one. The note's "Open consultation", over the
 * consultation that drafted it, pushed a second consultation, whose "Create draft note" pushed a second note: each round of
 * the loop added two pages, and back walked through every copy.
 */
export function openPage(navigation: Stacked, path: "/recording" | "/note" | "/tasks" | "/handover") {
  if (!backTo(navigation, path.slice(1))) router.push(path);
}

/** A visit's tool pages, which a visit opens on arrival when asked to (`view`). */
export const TOOL_PAGES = ["recording", "note", "xray", "tasks", "scan", "claim", "discharge"] as const;
export const isToolPage = (view?: string): view is (typeof TOOL_PAGES)[number] => TOOL_PAGES.includes(view as never);

/**
 * Leaves a sheet (`sheet`: its screen's navigation) for a visit in one navigation: the sheet slides down over the visit,
 * which is already in place, rather than closing on a timer while the visit pushes in behind it.
 */
export function openSessionFromSheet(sheet: { goBack: () => void }, patientId: string, params: { next?: string; prompt?: string; view?: string } = {}, replace = false) {
  sheet.goBack();
  openSession(patientId, { ...params, quiet: true }, replace);
}
