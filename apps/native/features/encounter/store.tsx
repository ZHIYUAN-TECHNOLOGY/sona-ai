import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { refreshPendingResult } from "@/features/day/model";
import { patients, refreshDemoTimes } from "./fixtures";
import { effectivePatient } from "./clinical-state";
import { acceptCard, beginRequest, createCard, finishRequest, initialEncounters, issueSimulation, reviseEncounter, revealSections, queueAmendment, reconcileAmendment } from "./state";
import type { Capability, Encounter, Patient, RequestState } from "./types";

type Store = {
  patient: Patient | undefined; patients: Patient[]; encounters: Record<string, Encounter>; encounter: Encounter | undefined;
  startAmendment: (reason: string) => void;
  selectPatient: (id: string) => void; leaveVisit: () => void; request: (kind: Capability, prompt?: string) => void; cancel: () => void;
  updateEncounter: (update: (current: Encounter) => Encounter, revise?: boolean) => void;
  runInPlace: (kind: "medication" | "prescription") => void;
  voiceInput: boolean; setVoiceInput: (value: boolean) => void; compactResponses: boolean; setCompactResponses: (value: boolean) => void; simulateInvalid: boolean; setSimulateInvalid: (value: boolean) => void;
  simulateFailure: boolean; setSimulateFailure: (enabled: boolean) => void; showDemoControls: boolean; setShowDemoControls: (value: boolean) => void; reset: () => void;
};
const Context = createContext<Store | null>(null);
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
  const [encounters, setEncounters] = useState(initialEncounters);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [simulateInvalid, setSimulateInvalid] = useState(false);
  const [voiceInput, setVoiceInput] = useState(true);
  const [compactResponses, setCompactResponses] = useState(false);
  // Prototype/fixture controls stay out of clinical answers unless a presenter turns them on.
  const [showDemoControls, setShowDemoControls] = useState(false);
  const stateRef = useRef(encounters); stateRef.current = encounters;
  const activeRef = useRef(patientId); activeRef.current = patientId;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  useEffect(() => clearTimers, [clearTimers]);
  const cancel = useCallback(() => {
    clearTimers();
    const id = activeRef.current;
    if (id) setEncounters(prev => ({ ...prev, [id]: { ...prev[id]!, amendmentOperation: prev[id]!.amendmentOperation && !["complete", "failed", "cancelled"].includes(prev[id]!.amendmentOperation!.phase) ? { ...prev[id]!.amendmentOperation!, phase: "cancelled", error: "Amendment cancelled. The earlier receipt is retained." } : prev[id]!.amendmentOperation, requests: prev[id]!.requests.map(r => r.status === "streaming" ? { ...r, status: "cancelled" } : r) } }));
  }, [clearTimers]);
  const selectPatient = useCallback((id: string) => { if (!patients.some(p => p.id === id) || activeRef.current === id) return; cancel(); activeRef.current = id; setPatientId(id); }, [cancel]);
  // Home has no visit open: leaving stops any answer still arriving so nothing is left half-streamed.
  const leaveVisit = useCallback(() => { if (!activeRef.current) return; cancel(); activeRef.current = undefined; setPatientId(undefined); }, [cancel]);
  const updateEncounter = useCallback((update: (current: Encounter) => Encounter, revise = false) => {
    const id = activeRef.current; if (!id) return;
    setEncounters(prev => { const next = update(prev[id]!); return { ...prev, [id]: revise ? reviseEncounter(next) : next }; });
  }, []);
  const request = useCallback((kind: Capability, prompt = "", amendmentId?: string) => {
    const id = activeRef.current; const base = patients.find(p => p.id === id); const patient = base ? effectivePatient(base, stateRef.current[base.id]) : undefined;
    if (!id || !patient) return;
    clearTimers();
    const revision = stateRef.current[id]!.revision;
    const req: RequestState = { id: `request-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, prompt, patientId: id, encounterId: patient.encounterId, revision, status: "streaming" };
    setEncounters(prev => {
      const next = beginRequest(prev[id]!, req), operation = next.amendmentOperation;
      if (operation && !["complete", "failed", "cancelled"].includes(operation.phase)) next.amendmentOperation = amendmentId === operation.id ? { ...operation, phase: kind === "medication" ? "reviewing" : "issuing", requestId: req.id } : { ...operation, phase: "cancelled", error: "A different request superseded the amendment. The earlier receipt is retained." };
      return { ...prev, [id]: next };
    });
    if (kind === "briefing" || kind === "xray" || kind === "prescription") {
      for (const [sections, delay] of [[1, 400], [2, 850]] as const) {
        timers.current.push(setTimeout(() => {
          if (activeRef.current !== id) return;
          setEncounters(prev => {
            const current = prev[id]!;
            return { ...prev, [id]: sections === 1 ? acceptCard(current, patient, { ...createCard(req), sections: 1 }) : revealSections(current, req.id, 2) };
          });
        }, delay));
      }
    }
    timers.current.push(setTimeout(() => {
      if (activeRef.current !== id) return;
      setEncounters(prev => {
        let current = prev[id]!;
        if (current.revision !== revision || current.requests.find(r => r.id === req.id)?.status !== "streaming") return prev;
        if (simulateInvalid) return { ...prev, [id]: reconcileAmendment(finishRequest(current, req.id, "failed", "This response requested an unsupported component. The renderer kept your existing content. Turn off the invalid-component fixture and retry."), req.id) };
        if (simulateFailure) return { ...prev, [id]: reconcileAmendment(finishRequest(current, req.id, "failed", "The fixture stream was interrupted. Your completed results and edits are kept."), req.id) };
        current = acceptCard(current, patient, createCard(req));
        if (kind === "briefing" || kind === "xray" || kind === "prescription") current = revealSections(current, req.id, 3);
        if (kind === "medication") current = { ...current, medicationCheckedRevision: revision };
        if (kind === "prescription") {
          current = issueSimulation(current, patient, `simulation-${id}-${revision}`);
          current = { ...current, cards: current.cards.map(card => card.requestId === req.id ? { ...card, prescription: current.prescription ? { ...current.prescription } : undefined } : card) };
        }
        return { ...prev, [id]: reconcileAmendment(finishRequest(current, req.id, "complete"), req.id) };
      });
    }, kind === "prescription" ? 1800 : 1150));
  }, [clearTimers, simulateFailure, simulateInvalid]);
  // The prescribe card runs the review and the simulation where they are, without adding answers.
  const runInPlace = useCallback((kind: "medication" | "prescription") => {
    const id = activeRef.current; const base = patients.find(p => p.id === id); const patient = base ? effectivePatient(base, stateRef.current[base.id]) : undefined;
    if (!id || !patient) return;
    const revision = stateRef.current[id]!.revision;
    setEncounters(prev => ({ ...prev, [id]: { ...prev[id]!, working: kind } }));
    timers.current.push(setTimeout(() => setEncounters(prev => {
      let current: Encounter = { ...prev[id]!, working: undefined };
      if (current.revision !== revision) return { ...prev, [id]: current };
      current = kind === "medication" ? { ...current, medicationCheckedRevision: revision, reviewInvalidated: false } : issueSimulation(current, patient, `simulation-${id}-${revision}-${Date.now()}`);
      return { ...prev, [id]: current };
    }), kind === "prescription" ? 1500 : 900));
  }, []);
  const startAmendment = useCallback((reason: string) => {
    const id = activeRef.current; if (!id) return;
    const operationId = `amendment-${id}-${Date.now()}`;
    setEncounters(prev => ({ ...prev, [id]: queueAmendment(prev[id]!, reason, operationId) }));
  }, []);
  const pendingAmendment = patientId ? encounters[patientId]?.amendmentOperation : undefined;
  useEffect(() => {
    if (!pendingAmendment || pendingAmendment.revision !== encounters[patientId!]?.revision) return;
    if (pendingAmendment.phase === "queued-review") request("medication", "Review amended medication context", pendingAmendment.id);
    if (pendingAmendment.phase === "queued-issue") request("prescription", "Create amended prescribing simulation", pendingAmendment.id);
  }, [patientId, pendingAmendment?.id, pendingAmendment?.phase, pendingAmendment?.revision, request]);
  const reset = useCallback(() => { cancel(); setEncounters(initialEncounters()); setPatientId(undefined); activeRef.current = undefined; setSimulateFailure(false); setSimulateInvalid(false); }, [cancel]);
  const currentPatients = patients.map(p => effectivePatient(p, encounters[p.id]));
  const patient = currentPatients.find(p => p.id === patientId);
  return <Context value={{ patient, patients: currentPatients, encounters, encounter: patientId ? encounters[patientId] : undefined, selectPatient, leaveVisit, request, cancel, startAmendment, updateEncounter, runInPlace, voiceInput, setVoiceInput, compactResponses, setCompactResponses, simulateInvalid, setSimulateInvalid, simulateFailure, setSimulateFailure, showDemoControls, setShowDemoControls, reset }}>{children}</Context>;
}
export function useEncounter() { const value = use(Context); if (!value) throw new Error("EncounterProvider is required"); return value; }
