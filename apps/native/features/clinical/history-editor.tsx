import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { Action, Body, Card, Label, Notice, SourceLink } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { Capability, FeatureProps, HistoryFact } from "@/features/encounter/types";
import { ClinicalChoice, ClinicalField } from "./controls";

const categories: { value: HistoryFact["category"]; label: string }[] = [
  { value: "presenting", label: "Presenting history" }, { value: "medical", label: "Medical history" },
  { value: "family", label: "Family history" }, { value: "social", label: "Social history" }, { value: "allergy", label: "Allergies" },
];
function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

export function HistoryEditor({ patient, result, onSource, onRequest, refresh }: Pick<FeatureProps, "patient" | "result" | "onSource" | "onRequest"> & { refresh: Capability }) {
  const { encounters, patient: activePatient, updateEncounter } = useEncounter();
  const encounter = encounters[patient.id];
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState(false);
  const [pickDate, setPickDate] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<number>();
  const [recorded, setRecorded] = useState<HistoryFact>();
  const draft = encounter?.historyDraft;
  const current = !result || result.revision === encounter?.revision;
  const facts = (encounter?.historyFacts ?? []).filter(fact => !result || fact.revision <= result.revision);
  const last = facts.at(-1);
  useEffect(() => {
    if (pendingRevision !== undefined && (activePatient?.id !== patient.id || (encounter?.revision ?? 0) > pendingRevision)) { setPendingRevision(undefined); return; }
    if (pendingRevision !== undefined && encounter?.revision === pendingRevision) { setPendingRevision(undefined); onRequest(refresh); }
  }, [activePatient?.id, patient.id, encounter?.revision, pendingRevision, onRequest, refresh]);
  const updateDraft = (change: Partial<NonNullable<typeof draft>>) => updateEncounter(value => ({ ...value, historyDraft: value.historyDraft ? { ...value.historyDraft, ...change } : undefined }));
  const start = () => { if (!draft) updateEncounter(value => ({ ...value, historyDraft: { category: "presenting", value: "", source: "", date: localDate(new Date()) } })); setOpen(true); };
  const save = () => {
    if (!draft || !draft.value.trim() || !draft.source.trim() || !encounter) return;
    const revision = encounter.revision + 1;
    const fact: HistoryFact = { ...draft, value: draft.value.trim(), source: draft.source.trim(), id: `history-${patient.id}-${Date.now()}`, revision };
    updateEncounter(value => ({ ...value, historyFacts: [...(value.historyFacts ?? []), fact], historyDraft: undefined, noteReviewed: false }), true);
    setRecorded(fact); setPendingRevision(revision); setOpen(false); Keyboard.dismiss();
  };
  return <Card label="History updates" title={last ? "Context updated" : "Keep the history current"}>
    {recorded && <Notice>Recorded at revision {recorded.revision}: {recorded.value}. The refreshed response will reflect this update; the earlier result remains unchanged.</Notice>}
    {last ? <><Body>{last.value}</Body><Body muted>{last.category} · {last.date} · revision {last.revision}</Body><SourceLink label="Source of this update" onPress={() => onSource(last.id)} /></> : <Body muted>No earlier visit record is available for comparison. The timeline reflects this encounter's intake.</Body>}
    {!current && <Notice>This result retains the history available at revision {result?.revision}. Open the latest response to add a correction.</Notice>}
    {current && <Action label={open ? "Hide history form" : draft ? "Continue history draft" : "Add or correct history"} secondary icon={open ? "chevron.up" : "pencil"} onPress={() => open ? setOpen(false) : start()} />}
    {current && open && draft && <View style={{ gap: 14 }}>
      <ClinicalChoice label="Category" value={draft.category} options={categories} onChange={category => updateDraft({ category })} />
      <ClinicalField label="Recorded fact" value={draft.value} onChange={value => updateDraft({ value })} multiline />
      <ClinicalField label="Source or speaker" value={draft.source} onChange={source => updateDraft({ source })} />
      <Body muted>Date: {draft.date}</Body>
      <Action label={pickDate ? "Finish choosing date" : "Change date"} secondary icon="calendar" onPress={() => setPickDate(value => !value)} />
      {pickDate && <DateTimePicker value={new Date(`${draft.date}T12:00:00`)} mode="date" display="inline" presentation="inline" onValueChange={(_, date) => updateDraft({ date: localDate(date) })} themeVariant="light" />}
      <Notice>This correction replaces the current summary for its category. Earlier facts and their sources remain inspectable.</Notice>
      <Action label="Save history & update response" disabled={!draft.value.trim() || !draft.source.trim()} onPress={save} />
      <Action label="Discard this history draft" secondary onPress={() => { updateEncounter(value => ({ ...value, historyDraft: undefined })); setOpen(false); }} />
    </View>}
    {!!facts.length && <Action label={versions ? "Hide history versions" : "Inspect history versions"} secondary onPress={() => setVersions(value => !value)} />}
    {versions && facts.map((fact, index) => <View key={fact.id} style={{ gap: 5, paddingVertical: 10 }}><Label muted>Revision {fact.revision} · {fact.category} · {fact.date}</Label><Body>{fact.value}</Body><Body muted>Source: {fact.source}{facts.slice(index + 1).some(next => next.category === fact.category) ? " · Superseded in this result" : " · Current for this category"}</Body><SourceLink label="Inspect recorded source" onPress={() => onSource(fact.id)} /></View>)}
  </Card>;
}
