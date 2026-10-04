import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useFocusEffect } from "expo-router";
import { useCallback, useState, useSyncExternalStore } from "react";
import { api, errorText, useLive } from ".";
import { useLiveChanges } from "./channel";

export type ServerBed = Awaited<ReturnType<AppRouterClient["ward"]["beds"]>>[number];

// Why the last read of each kind failed, until one succeeds. Held outside the hooks so a screen can say it
// (useWardFailure) while the read hooks keep returning plain data.
type Which = "beds" | "forecast";
const failures = new Map<Which, string>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const failed = (which: Which, reason?: string) => {
  if (failures.get(which) === reason) return;
  if (reason === undefined) failures.delete(which); else failures.set(which, reason);
  listeners.forEach(l => l());
};
/**
 * Why the ward (or its forecast) is not the server's: the read failed, with the server's reason. Undefined while it
 * loads or once it has arrived; the next read (the screen coming into view, a ward change) tries again.
 */
export const useWardFailure = (which: Which) => { const { on } = useLive(); const reason = useSyncExternalStore(subscribe, () => failures.get(which)); return on ? reason : undefined; };

/**
 * One live ward read. Re-read each time the ward comes into view (a discharge or a letter may have
 * cleared a bed), on any ward change (an owner assigned elsewhere, a demo clock jump) and whenever
 * `key` changes (the findings list: tracking or dismissing one changes a bed's blockers). Undefined
 * until it arrives or when live mode is off, so the ward draws its fixture instead.
 */
function useWardRead<T>(which: Which, read: () => Promise<T>, key?: unknown) {
  const { on } = useLive();
  const [data, setData] = useState<T>();
  const [version, setVersion] = useState(0);
  useLiveChanges(["ward"], () => setVersion(v => v + 1));
  useFocusEffect(useCallback(() => {
    if (!on) { setData(undefined); return; }
    let current = true;
    read().then(rows => { failed(which); if (current) setData(rows); }, e => failed(which, errorText(e)));
    return () => { current = false; };
  }, [on, key, version])); // eslint-disable-line react-hooks/exhaustive-deps
  return on ? data : undefined;
}

// Today, its keys, the sidebar and Sona's answers all count beds (day/counts): one read in flight serves them all.
let beds: Promise<ServerBed[]> | undefined;
const readBeds = () => beds ??= api.ward.beds().finally(() => { beds = undefined; });

/** Live mode's ward: every bed as the server derives it from its rows. */
export const useServerBeds = (key?: unknown) => useWardRead("beds", readBeds, key);

/** Live mode's bed forecast, on the hospital's demo clock with the owners saved on the server. */
export const useServerForecast = (key?: unknown) => useWardRead("forecast", () => api.ward.forecast(), key);
