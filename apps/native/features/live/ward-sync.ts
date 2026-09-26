import type { AppRouterClient } from "@sona-ai/api/routers/index";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { api, useLive } from ".";
import { useLiveChanges } from "./channel";

export type ServerBed = Awaited<ReturnType<AppRouterClient["ward"]["beds"]>>[number];

/**
 * Live mode's ward: every bed as the server derives it from its rows. Re-read each time the ward
 * comes into view (a discharge or a letter may have cleared a bed) and whenever `key` changes (the
 * findings list: tracking or dismissing one changes a bed's blockers). Undefined until it arrives or
 * when live mode is off, so the ward draws its fixture beds instead.
 */
export function useServerBeds(key?: unknown) {
  const { on } = useLive();
  const [beds, setBeds] = useState<ServerBed[]>();
  // Live updates: a change to any bed (a letter approved, an owner assigned elsewhere) re-reads the ward.
  const [version, setVersion] = useState(0);
  useLiveChanges(["ward"], () => setVersion(v => v + 1));
  useFocusEffect(useCallback(() => {
    if (!on) { setBeds(undefined); return; }
    let current = true;
    api.ward.beds().then(rows => { if (current) setBeds(rows); }, () => {});
    return () => { current = false; };
  }, [on, key, version]));
  return on ? beds : undefined;
}
