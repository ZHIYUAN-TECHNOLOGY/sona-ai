import { useEffect, useState, useSyncExternalStore } from "react";
import { useEncounterSelect } from "@/features/encounter/store";
import { detectFixture, followUpTask, type Finding } from "@/features/findings/model";
import { api, errorText, requestId, useLive } from ".";
import { keepSame } from "./keep-same";
import { useRole } from "./roles";
import { refreshServerData } from "./server-day";

/**
 * Demo flow 6's findings, held once for the X-ray screen, ward, discharge, handover and My Day.
 * Fixture mode keeps Amelia's two authored findings in memory once her X-ray is opened, and tracking one adds its task to
 * her encounter; live mode reads and writes api.findings. Screens get the rows from useFindings
 * (the store's value, never a module read: React Compiler caches those).
 */
let fixture: Finding[] = [];
// One empty list until the server's arrive (or for a role that can't read them): reads keyed on findings, like the ward's, re-read only when they change.
const NONE: Finding[] = [];
let server: Finding[] | undefined;
// Every screen counting the ward reads findings on mount (day/counts): one plain re-read in flight serves them all.
let listing: ReturnType<typeof api.findings.list> | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Who last read each visit's current film for findings (api.findings.status): null when nobody has, absent until asked. */
export type FilmRead = Awaited<ReturnType<typeof api.findings.status>>;
let reads: Record<string, FilmRead> = {};

/**
 * Re-reads the server's findings; with an encounter, runs detection on it first (a rerun changes nothing).
 * `readOf` (the detected visit unless given: a role that may not detect still asks) then reads who read its film, whether
 * or not detection worked, so an empty list is shown as a model's clean read or as a film no model has read, never as
 * either by default. A failed status read leaves the last one (or none): the screen then makes no claim.
 */
export async function refreshFindings(detect?: string, readOf = detect) {
  try {
    if (detect) await api.findings.detect({ encounterId: detect });
    server = keepSame(server, await (detect ? api.findings.list({}) : listing ??= api.findings.list({}).finally(() => { listing = undefined; })));
  } finally {
    if (readOf) await api.findings.status({ encounterId: readOf }).then(read => { reads = keepSame(reads, { ...reads, [readOf]: read }); }, () => {});
    notify();
  }
}

export function useFindings() {
  const { on, wanted } = useLive();
  const patientId = useEncounterSelect(s => s.patient?.id), updateEncounter = useEncounterSelect(s => s.updateEncounter);
  const fixtureRows = useSyncExternalStore(subscribe, () => fixture);
  const serverRows = useSyncExternalStore(subscribe, () => server);
  const filmReads = useSyncExternalStore(subscribe, () => reads);
  const [error, setError] = useState<string>();
  const { can } = useRole();
  useEffect(() => {
    if (on) void refreshFindings().catch(e => setError(errorText(e)));
    else if (!wanted && server) { server = undefined; notify(); }
  }, [on, wanted]);

  /** One task and one recall at the due date; the server refuses a finding that needs no follow-up. */
  const track = async (f: Finding) => {
    setError(undefined);
    if (on) {
      try { await api.findings.track({ findingId: f.id, requestId: requestId() }); await Promise.all([refreshFindings(), refreshServerData()]); }
      catch (e) { setError(errorText(e)); }
      return;
    }
    const task = followUpTask(f);
    if (!task) return setError("No routine follow-up needed");
    // updateEncounter writes to the open visit, so the task lands only on the finding's own patient.
    if (patientId !== f.patientId) return setError(`Open ${f.patientName} to track this follow-up`);
    updateEncounter(e => (e.tasks.some(t => t.id === task.id) ? e : { ...e, tasks: [...e.tasks, task] }));
    fixture = fixture.map(x => (x.id === f.id ? { ...x, status: "tracked" as const, taskId: task.id, owner: task.owner } : x));
    notify();
  };
  const dismiss = async (f: Finding, reason: string) => {
    setError(undefined);
    if (on) {
      try { await api.findings.dismiss({ findingId: f.id, reason }); await refreshFindings(); }
      catch (e) { setError(errorText(e)); }
      return;
    }
    fixture = fixture.map(x => (x.id === f.id ? { ...x, status: "dismissed" as const } : x));
    notify();
  };
  /** Reads the encounter's image for findings (the X-ray screen calls it on open); in live mode a role that may not only re-reads. */
  const detect = (encounterId: string) => {
    if (on) { setError(undefined); void refreshFindings(can("findings.detect") ? encounterId : undefined, can("findings.status") ? encounterId : undefined).catch(e => setError(errorText(e))); return; }
    const next = detectFixture(fixture, encounterId, new Date());
    if (next !== fixture) { fixture = next; notify(); }
  };
  /** Live only: who read this visit's film, for the card's empty state (undefined: not asked, or sample mode). */
  const readOf = (encounterId: string | undefined) => on && encounterId ? filmReads[encounterId] : undefined;
  return { live: on, findings: on ? serverRows ?? NONE : fixtureRows, error, track, dismiss, detect, readOf };
}
