import type { DemoPatient } from "@sona-ai/domain/demo-patients";
import { useEffect, useState } from "react";
import { api, useLive } from ".";

/**
 * Live mode's patient records, keyed by patient ID: what the server holds for each person (history,
 * allergies, medicines, vitals, sources) replaces the app's fixture. Undefined until they arrive or
 * when live mode is off, so the app shows its fixtures instead.
 */
export function useServerPatients() {
  const { on } = useLive();
  const [records, setRecords] = useState<Record<string, DemoPatient>>();
  useEffect(() => {
    if (!on) { setRecords(undefined); return; }
    let current = true;
    api.patients.list().then(rows => { if (current) setRecords(Object.fromEntries(rows.map(p => [p.id, p]))); }, () => {});
    return () => { current = false; };
  }, [on]);
  return on ? records : undefined;
}
