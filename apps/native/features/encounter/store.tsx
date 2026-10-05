import * as SecureStore from "expo-secure-store";
import { createContext, use, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Ack } from "@/features/day/counts";
import { refreshPendingResult } from "@/features/day/model";
import { errorText, JUDGE, useLive } from "@/features/live";
import { keepSame } from "@/features/live/keep-same";
import { useServerPatients } from "@/features/live/patients-sync";
import { serverRoster } from "@/features/patients/record";
import { amendOnServer, pushAndReview, simulateOnServer } from "@/features/live/prescribing-sync";
import { patients, refreshDemoTimes } from "./fixtures";
import { effectivePatient } from "./clinical-state";
import { acceptCard, beginRequest, createCard, finishRequest, initialEncounters, isRepeat, issueSimulation, reviseEncounter, revealSections, queueAmendment, reconcileAmendment, withRoster, type ServerReceipt } from "./state";
import type { Capability, Encounter, Patient, RequestState } from "./types";

type Store = {
  patient: Patient | undefined; patients: Patient[]; encounters: Record<string, Encounter>; encounter: Encounter | undefined;
  startAmendment: (reason: string) => void;
  selectPatient: (id: string) => void; leaveVisit: () => void; cancel: () => void;
  /** Asks in the open visit; returns the request's id (the earlier one's, for a repeat), so Sona Live can show that answer. */
  request: (kind: Capability, prompt?: string) => string | undefined;
  /** Updates the open visit, or `patientId`'s when given (a server read that may land after the visit changed). */
  updateEncounter: (update: (current: Encounter) => Encounter, revise?: boolean, patientId?: string) => void;
  runInPlace: (kind: "medication" | "prescription") => void;
  /** Live mode: the server's refusal of the last in-place run, by patient. */
  runErrors: Record<string, string | undefined>;
  voiceInput: boolean; setVoiceInput: (value: boolean) => void; compactResponses: boolean; setCompactResponses: (value: boolean) => void; simulateInvalid: boolean; setSimulateInvalid: (value: boolean) => void;
  simulateFailure: boolean; setSimulateFailure: (enabled: boolean) => void; showDemoControls: boolean; setShowDemoControls: (value: boolean) => void; reset: () => void;
  /** Demo mode's acknowledged results (by `resultKey`); live mode reads the server's acknowledgement instead. */
  resultAcks: Record<string, Ack>; acknowledgeDemoResult: (key: string, by: string) => void;
};
const DEMO_CONTROLS_KEY = "sona.demoControls";
const Context = createContext<Store | null>(null);
/** The store as last rendered, for slice reads (useEncounterSelect): one object for the app's life, so it never re-renders a reader itself. */
type Handle = { store: Store; subscribe: (listener: () => void) => () => void; notify: () => void };
const Slices = createContext<Handle | null>(null);
// The judge build starts with no visits: each one starts when the server's roster brings its patient (withRoster), never from a fixture.
const firstEncounters = () => JUDGE ? {} : initialEncounters();
export function EncounterProvider({ children }: { children: ReactNode }) {
  const [patientId, setPatientId] = useState<string>();
  // Coming back to the app (or a long idle stretch) re-times the demo schedule so it never reads "running late".
  const [, setClock] = useState(0);
  useEffect(() => {
    const refresh = () => { if (refreshDemoTimes(id => Boolean(stateRef.current[id]?.requests.length))) { refreshPendingResult(); setClock(n => n + 1); } };
    const sub = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    const timer = setInterval(refresh, 60_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, []);
  const [encounters, setEncounters] = useState(firstEncounters);
  // Live mode: each person's record as the server holds it. The judge build's roster is the server's alone (everyone it
  // holds a visit for; empty until it is read, behind the judge gate); otherwise the two sample visits.
  const server = useServerPatients();
  const roster = JUDGE ? serverRoster(server) : patients;
  const rosterRef = useRef(roster); rosterRef.current = roster;
  // Set while rendering, so no screen ever sees a patient on the roster without their visit.
  if (JUDGE && roster.some(p => !encounters[p.id])) setEncounters(prev => withRoster(prev, roster));
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [simulateInvalid, setSimulateInvalid] = useState(false);
  const [voiceInput, setVoiceInput] = useState(true);
  const [compactResponses, setCompactResponses] = useState(false);
  // Prototype/fixture controls stay out of clinical answers unless a presenter turns them on.
  const [showDemoControls, setShowDemoControlsState] = useState(false);
  // Remembered across reloads, so a presenter's rehearsal setup survives a JS reload mid-demo.
  useEffect(() => { SecureStore.getItemAsync(DEMO_CONTROLS_KEY).then(v => { if (v === "1") setShowDemoControlsState(true); }).catch(() => {}); }, []);
  const setShowDemoControls = useCallback((value: boolean) => { setShowDemoControlsState(value); SecureStore.setItemAsync(DEMO_CONTROLS_KEY, value ? "1" : "0").catch(() => {}); }, []);
  const stateRef = useRef(encounters); stateRef.current = encounters;
  const activeRef = useRef(patientId); activeRef.current = patientId;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  useEffect(() => clearTimers, [clearTimers]);
  const cancel = useCallback(() => {
    clearTimers();
    const id = activeRef.current;
    // Cleared timers never settle an in-place run, so it stops here too rather than leaving the card busy.
    if (id) setEncounters(prev => ({ ...prev, [id]: { ...prev[id]!, working: undefined, amendmentOperation: prev[id]!.amendmentOperation && !["complete", "failed", "cancelled"].includes(prev[id]!.amendmentOperation!.phase) ? { ...prev[id]!.amendmentOperation!, phase: "cancelled", error: "Amendment cancelled. The earlier receipt is retained." } : prev[id]!.amendmentOperation, requests: prev[id]!.requests.map(r => r.status === "streaming" ? { ...r, status: "cancelled" } : r) } }));
  }, [clearTimers]);
  const selectPatient = useCallback((id: string) => { if (!rosterRef.current.some(p => p.id === id) || activeRef.current === id) return; cancel(); activeRef.current = id; setPatientId(id); }, [cancel]);
  // Home has no visit open: leaving stops any answer still arriving so nothing is left half-streamed.
  const leaveVisit = useCallback(() => { if (!activeRef.current) return; cancel(); activeRef.current = undefined; setPatientId(undefined); }, [cancel]);
  const { on: live, user } = useLive();
  const updateEncounter = useCallback((update: (current: Encounter) => Encounter, revise = false, patientId?: string) => {
    const id = patientId ?? activeRef.current; if (!id || !rosterRef.current.some(p => p.id === id)) return;
    // An update that changes nothing (it returned the visit as it was) leaves the store as it was: every screen reads it, so
    // a new map re-rendered them all, the visit under the consultation recorder and Today under that included.
    setEncounters(prev => { const next = update(prev[id]!); return next === prev[id] && !revise ? prev : { ...prev, [id]: revise ? reviseEncounter(next) : next }; });
  }, []);
  const request = useCallback((kind: Capability, prompt = "", amendmentId?: string) => {
    const id = activeRef.current; const base = rosterRef.current.find(p => p.id === id); const patient = base ? effectivePatient(base, stateRef.current[base.id]) : undefined;
    if (!id || !patient) return;
    // A double send is one request: the answer already on its way is the answer.
    const last = stateRef.current[id]?.requests.at(-1);
    if (!amendmentId && last && isRepeat(last, kind, prompt)) return last.id;
    clearTimers();
    // The revision here is the last one drawn; beginRequest stamps the one the request lands on (an attachment sent with
    // the question has revised the visit in this same tick), and `asked` is the request as the visit then holds it.
    const req: RequestState = { id: `request-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, prompt, patientId: id, encounterId: patient.encounterId, revision: stateRef.current[id]!.revision, status: "streaming" };
    const asked = (current: Encounter) => current.requests.find(r => r.id === req.id) ?? req;
    setEncounters(prev => {
      const next = { ...beginRequest(prev[id]!, req), working: undefined }, operation = next.amendmentOperation; // clearTimers above stopped any in-place run
      if (operation && !["complete", "failed", "cancelled"].includes(operation.phase)) next.amendmentOperation = amendmentId === operation.id ? { ...operation, phase: kind === "medication" ? "reviewing" : "issuing", requestId: req.id } : { ...operation, phase: "cancelled", error: "A different request superseded the amendment. The earlier receipt is retained." };
      return { ...prev, [id]: next };
    });
    // Demo: the sample's staged reveal. Live: the whole card at once; a model answer in it shows its own Drafting while the server works.
    if (!live && (kind === "briefing" || kind === "xray" || kind === "prescription")) {
      for (const [sections, delay] of [[1, 400], [2, 850]] as const) {
        timers.current.push(setTimeout(() => {
          if (activeRef.current !== id) return;
          setEncounters(prev => {
            const current = prev[id]!;
            return { ...prev, [id]: sections === 1 ? acceptCard(current, patient, { ...createCard(asked(current)), sections: 1 }) : revealSections(current, req.id, 2) };
          });
        }, delay));
      }
    }
    // Settles this request unless the visit, its revision or the request moved on meanwhile.
    const finish = (end: (current: Encounter) => Encounter) => {
      if (activeRef.current !== id) return;
      setEncounters(prev => {
        const current = prev[id]!;
        if (current.revision !== asked(current).revision || asked(current).status !== "streaming") return prev;
        return { ...prev, [id]: reconcileAmendment(end(current), req.id) };
      });
    };
    const fail = (error: string) => finish(current => finishRequest(current, req.id, "failed", error));
    const settle = (receipt?: ServerReceipt) => finish(current => {
      if (simulateInvalid) return finishRequest(current, req.id, "failed", "This response requested an unsupported component. The renderer kept your existing content. Turn off the invalid-component fixture and retry.");
      if (simulateFailure) return finishRequest(current, req.id, "failed", "The fixture stream was interrupted. Your completed results and edits are kept.");
      const revision = current.revision; // the request's own: finish has just checked they match
      current = acceptCard(current, patient, createCard(asked(current)));
      if (kind === "briefing" || kind === "xray" || kind === "prescription") current = revealSections(current, req.id, 3);
      if (kind === "medication") current = { ...current, medicationCheckedRevision: revision };
      if (kind === "prescription") {
        // Asking shows the card; only an amendment (its own reviewed form) issues here. Otherwise the card's Prescribe does.
        if (amendmentId) current = issueSimulation(current, patient, receipt?.requestId ?? `simulation-${id}-${revision}`, receipt);
        current = { ...current, cards: current.cards.map(card => card.requestId === req.id ? { ...card, prescription: current.prescription ? { ...current.prescription } : undefined } : card) };
      }
      return finishRequest(current, req.id, "complete");
    });
    // Live: an amendment's review and its new receipt go through the server, and the card shows what it answered (or why it refused).
    if (live && user && amendmentId && (kind === "medication" || kind === "prescription")) {
      const current = stateRef.current[id]!;
      void (kind === "medication" ? pushAndReview(patient.encounterId, current).then(() => undefined)
        : amendOnServer(patient.encounterId, user.id, current.prescriptionAmendment ?? "", amendmentId)).then(settle, e => fail(errorText(e)));
    } else if (live) settle(); else timers.current.push(setTimeout(settle, kind === "prescription" ? 1800 : 1150));
    return req.id;
  }, [clearTimers, live, user, simulateFailure, simulateInvalid]);
  // The one way to run the review and the prescription, for the prescribe card and the next-step bar alike, without adding answers.
  // Live: the server records the review and re-checks everything before it writes the receipt, and refuses a role that can't
  // prescribe (both callers show that role a lock instead: useCanPrescribe).
  const [runErrors, setRunErrors] = useState<Record<string, string | undefined>>({});
  const runInPlace = useCallback((kind: "medication" | "prescription") => {
    const id = activeRef.current; const base = rosterRef.current.find(p => p.id === id); const patient = base ? effectivePatient(base, stateRef.current[base.id]) : undefined;
    if (!id || !patient || stateRef.current[id]!.working) return; // one run at a time, whichever button started it
    const encounter = stateRef.current[id]!, revision = encounter.revision;
    const settle = (update: (current: Encounter) => Encounter) => setEncounters(prev => ({ ...prev, [id]: update({ ...prev[id]!, working: undefined }) }));
    const reviewed = (current: Encounter): Encounter => current.revision === revision ? { ...current, medicationCheckedRevision: revision, reviewInvalidated: false } : current;
    setRunErrors(errors => ({ ...errors, [id]: undefined }));
    setEncounters(prev => ({ ...prev, [id]: { ...prev[id]!, working: kind } }));
    if (live && user) {
      const call = kind === "medication" ? pushAndReview(patient.encounterId, encounter).then(() => settle(reviewed))
        : simulateOnServer(patient.encounterId, user.id).then(receipt => settle(current => issueSimulation(current, patient, receipt.requestId, receipt)));
      call.catch(e => { setRunErrors(errors => ({ ...errors, [id]: errorText(e) })); settle(current => current); });
      return;
    }
    timers.current.push(setTimeout(() => settle(current => current.revision !== revision ? current : kind === "medication" ? reviewed(current) : issueSimulation(current, patient, `simulation-${id}-${revision}-${Date.now()}`)), kind === "prescription" ? 1500 : 900));
  }, [live, user]);
  const startAmendment = useCallback((reason: string) => {
    const id = activeRef.current; if (!id) return;
    const operationId = `amendment-${id}-${Date.now()}`;
    setEncounters(prev => ({ ...prev, [id]: queueAmendment(prev[id]!, reason, operationId) }));
  }, []);
  const pendingAmendment = patientId ? encounters[patientId]?.amendmentOperation : undefined;
  useEffect(() => {
    if (!pendingAmendment || pendingAmendment.revision !== encounters[patientId!]?.revision) return;
    if (pendingAmendment.phase === "queued-review") request("medication", "Review amended medication context", pendingAmendment.id);
    if (pendingAmendment.phase === "queued-issue") request("prescription", live ? "Record the amended prescription" : "Create the amended sample prescription", pendingAmendment.id);
  }, [patientId, pendingAmendment?.id, pendingAmendment?.phase, pendingAmendment?.revision, request]);
  const [resultAcks, setResultAcks] = useState<Record<string, Ack>>({});
  const acknowledgeDemoResult = useCallback((key: string, by: string) => setResultAcks(acks => acks[key] ? acks : { ...acks, [key]: { at: new Date().toISOString(), by } }), []);
  const reset = useCallback(() => { cancel(); setEncounters(firstEncounters()); setPatientId(undefined); activeRef.current = undefined; setSimulateFailure(false); setSimulateInvalid(false); setResultAcks({}); }, [cancel]);
  // Sample visits take the server's record in live mode and keep the demo schedule's clock times; the judge build's roster is already the server's.
  // Each record is rebuilt on every write; one that reads the same keeps the object held, and the list too while every
  // record is held, so a slice read of them (useEncounterSelect) changes only when a record did.
  const held = useRef<Patient[]>([]);
  const built = roster.map(p => keepSame(held.current.find(h => h.id === p.id), effectivePatient(!JUDGE && server?.[p.id] ? { ...p, ...server[p.id], time: p.time } : p, encounters[p.id])));
  const currentPatients = held.current = built.length === held.current.length && built.every((p, i) => p === held.current[i]) ? held.current : built;
  const patient = currentPatients.find(p => p.id === patientId);
  const value: Store = { patient, patients: currentPatients, encounters, encounter: patientId ? encounters[patientId] : undefined, selectPatient, leaveVisit, request, cancel, startAmendment, updateEncounter, runInPlace, runErrors, voiceInput, setVoiceInput, compactResponses, setCompactResponses, simulateInvalid, setSimulateInvalid, simulateFailure, setSimulateFailure, showDemoControls, setShowDemoControls, reset, resultAcks, acknowledgeDemoResult };
  const handle = useRef<Handle>(null);
  if (!handle.current) { const listeners = new Set<() => void>(); handle.current = { store: value, subscribe: l => { listeners.add(l); return () => { listeners.delete(l); }; }, notify: () => listeners.forEach(l => l()) }; }
  // Set while rendering, as stateRef above, so a slice reader rendering in this same pass already reads this write; the
  // others hear of it once it is committed, before the frame is drawn, and re-render only if their slice changed.
  handle.current.store = value;
  useLayoutEffect(() => handle.current!.notify());
  return <Slices value={handle.current}><Context value={value}>{children}</Context></Slices>;
}
export function useEncounter() { const value = use(Context); if (!value) throw new Error("EncounterProvider is required"); return value; }

/**
 * One slice of the store. useEncounter re-renders its reader on every write to any visit (a visit opening wrote 9 or 10
 * times, re-rendering ~30 readers each time); this re-renders only when the slice changes: by identity, or `same` for
 * a value derived afresh on each read (sameJSON). The store's maps and records keep unchanged entries, so a slice of
 * them is held as it was.
 */
export function useEncounterSelect<T>(select: (store: Store) => T, same: (a: T, b: T) => boolean = Object.is): T {
  const handle = use(Slices); if (!handle) throw new Error("EncounterProvider is required");
  const last = useRef<{ value: T }>(null);
  return useSyncExternalStore(handle.subscribe, () => {
    const next = select(handle.store);
    if (!last.current || !same(last.current.value, next)) last.current = { value: next };
    return last.current.value;
  });
}
/** For a reader of these fields of each visit alone: two maps of visits holding the same ones (each by identity) read the same. */
export const sameVisits = (...fields: (keyof Encounter)[]) => (a: Record<string, Encounter | undefined>, b: Record<string, Encounter | undefined>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(id => fields.every(f => a[id]?.[f] === b[id]?.[f]));
