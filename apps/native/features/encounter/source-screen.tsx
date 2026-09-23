import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking } from "react-native";
import { Action, Body, Card, Label, Notice, Screen, SourceLink } from "@/components/sona/ui";
import { useEncounter } from "./store";

export function SourceScreen() {
  const { id, patientId, cardId, revision, taskId } = useLocalSearchParams<{ id: string; patientId: string; cardId?: string; revision?: string; taskId?: string }>();
  const { patients, encounters } = useEncounter();
  const [loading, setLoading] = useState(true), [linkError, setLinkError] = useState(false);
  useEffect(() => { setLoading(true); setLinkError(false); const timer = setTimeout(() => setLoading(false), 250); return () => clearTimeout(timer); }, [id, patientId, cardId]);
  const currentPatient = patients.find(p => p.id === patientId), encounter = currentPatient && encounters[currentPatient.id];
  const result = encounter?.cards.find(card => cardId ? card.id === cardId : revision ? card.revision === Number(revision) : false);
  const taskSource = taskId ? (encounter?.tasks.find(task => task.id === taskId)?.sourceSnapshot ?? (encounter?.taskDraft?.operationId === taskId ? encounter.taskDraft.sourceSnapshot : undefined) ?? (encounter?.taskEditDraft?.operationId === taskId ? encounter.taskEditDraft.sourceSnapshot : undefined)) : undefined;
  const patient = result?.patientSnapshot ?? currentPatient, source = taskSource ?? (revision && Number(revision) !== encounter?.revision && !result ? undefined : patient?.sources.find(s => s.id === id));
  const transcript = result?.transcriptSnapshot ?? encounter?.transcript;
  const openOriginal = async () => { if (!source?.url) return; try { await Linking.openURL(source.url); setLinkError(false); } catch { setLinkError(true); } };
  return <Screen><Label>Evidence & provenance</Label>{loading ? <Card title="Loading source"><Body muted>Opening the recorded source version…</Body></Card> : source ? <>
    {result && result.revision !== encounter?.revision && <Notice>Retained evidence for revision {result.revision}. The current encounter is revision {encounter?.revision}. Later corrections have not overwritten this version.</Notice>}
    <Card label={source.kind} title={source.title}><Body muted>{source.date}</Body><Body>{source.excerpt}</Body>{source.url && <SourceLink label="Open original reference" onPress={openOriginal} />}{linkError && <><Notice warning>The original reference could not be opened. Its recorded excerpt remains available.</Notice><Action label="Retry opening reference" secondary onPress={openOriginal} /></>}</Card>
    {id === "history" && patient && <Card title="Context in this version"><Body>{patient.complaint}</Body><Body>{patient.history.join(". ")}</Body><Body>Family: {patient.family}</Body><Body>Social: {patient.social}</Body><Body>Allergies: {patient.allergies ?? "Unknown"}</Body><Body>{patient.medicines.join("\n")}</Body>{patient.sources.filter(s => (s.id.startsWith("fact-") || s.id.startsWith("history-"))).map(s => <Body key={s.id}>{s.date} · {s.excerpt}</Body>)}</Card>}
    {id === "consultation" && !!transcript?.length && <Card title={result ? `Transcript at revision ${result.revision}` : "Current transcript"}>{transcript.map(line => <Body key={line.id}>{line.speaker}: {line.original}{line.corrected && !line.englishReviewed ? " · Interpretation needs review" : ""}{line.englishReviewed ? `\nConfirmed English: ${line.english}` : ""}</Body>)}</Card>}
    <Notice>{source.synthetic ? "Authored demonstration source. It supports this UI fixture, not a validated clinical recommendation." : source.kind === "image" ? "Teaching material. This asset is not a radiograph of the fictional patient." : "General reference, summarised for the demonstration. Applying it to this fictional encounter is illustrative, not a validated model result."}</Notice>
  </> : <Card title="Source unavailable"><Body>The referenced evidence is not included in this encounter. No supporting source has been inferred.</Body><Action label="Retry source" secondary onPress={() => { setLoading(true); setTimeout(() => setLoading(false), 250); }} /></Card>}</Screen>;
}
