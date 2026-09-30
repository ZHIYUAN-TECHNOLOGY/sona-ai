import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { api, useLive } from ".";
import { useLiveChanges } from "./channel";

export type ServerBed = Awaited<ReturnType<AppRouterClient["ward"]["beds"]>>[number];

/**
 * One live ward read. Re-read each time the ward comes into view (a discharge or a letter may have
 * cleared a bed), on any ward change (an owner assigned elsewhere, a demo clock jump) and whenever
 * `key` changes (the findings list: tracking or dismissing one changes a bed's blockers). Undefined
 * until it arrives or when live mode is off, so the ward draws its fixture instead.
 */
function useWardRead<T>(read: () => Promise<T>, key?: unknown) {
  const { on } = useLive();
  const [data, setData] = useState<T>();
  const [version, setVersion] = useState(0);
  useLiveChanges(["ward"], () => setVersion(v => v + 1));
  useFocusEffect(useCallback(() => {
    if (!on) { setData(undefined); return; }
    let current = true;
    read().then(rows => { if (current) setData(rows); }, () => {});
    return () => { current = false; };
  }, [on, key, version])); // eslint-disable-line react-hooks/exhaustive-deps
  return on ? data : undefined;
}

// Today, its keys, the sidebar and Sona's answers all count beds (day/counts): one read in flight serves them all.
let beds: Promise<ServerBed[]> | undefined;
const readBeds = () => beds ??= api.ward.beds().finally(() => { beds = undefined; });

/** Live mode's ward: every bed as the server derives it from its rows. */
export const useServerBeds = (key?: unknown) => useWardRead(readBeds, key);

/** Live mode's bed forecast, on the hospital's demo clock with the owners saved on the server. */
export const useServerForecast = (key?: unknown) => useWardRead(() => api.ward.forecast(), key);
