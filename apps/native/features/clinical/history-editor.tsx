import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, TextInput, View, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";
import { Text } from "@/components/sona/text";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { palette, type } from "@/components/sona/theme";
import { SourceRef, useSourceScope, type SourceEntry } from "@/components/sona/sources";
import { Action, Chip, Expand, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { Capability, FeatureProps, HistoryFact } from "@/features/encounter/types";
import { useEncounterEdit } from "@/features/live/sync";
import { Caption, Disclosure, haptic, IconDisc } from "./reasoning-parts";

const categories: { value: HistoryFact["category"]; label: string; icon: string }[] = [
  { value: "presenting", label: "Presenting history", icon: "text.bubble" }, { value: "medical", label: "Medical history", icon: "cross.case" },
  { value: "family", label: "Family history", icon: "figure.2.and.child.holdinghands" }, { value: "social", label: "Social history", icon: "house" }, { value: "allergy", label: "Allergies", icon: "allergens" },
];
const categoryOf = (value: HistoryFact["category"]) => categories.find(category => category.value === value)!;
const shortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
/** Each recorded change is its own source; the detail line tells revisions apart in the sources sheet. */
const sourceOf = (fact: HistoryFact, onSource: (id: string) => void): SourceEntry => ({
  id: fact.id, label: "History update", kind: "record", detail: `Revision ${fact.revision} · ${categoryOf(fact.category).label} · ${shortDate(fact.date)} · ${fact.source}`, onPress: () => onSource(fact.id),
});
function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

const field: TextStyle = { fontSize: 17, lineHeight: 23, color: palette.ink, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderCurve: "continuous", backgroundColor: "rgba(20,28,40,0.04)" };
const placeholder = "rgba(89,97,107,0.55)";
function FieldLabel({ children }: { children: string }) { return <Text style={{ ...type.footnote, fontWeight: "600", color: palette.muted }}>{children}</Text>; }

/**
 * History collapses to one quiet row, "Update history ›", that opens in place: the latest recorded
 * change, then the correction form and the version trail. Saving bumps the encounter revision and
 * requests a refreshed `refresh` answer; this result keeps the history it was built from.
 */
export function HistoryEditor({ patient, result, onSource, onRequest, refresh }: Pick<FeatureProps, "patient" | "result" | "onSource" | "onRequest"> & { refresh: Capability }) {
  const { encounters, patient: activePatient, updateEncounter } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const edit = useEncounterEdit(patient);
  const scope = useSourceScope();
  const layout = reducedMotion ? undefined : LAYOUT;
  const encounter = encounters[patient.id];
  const draft = encounter?.historyDraft;
  const [shown, setShown] = useState(!!draft);
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<number>();
  const [recorded, setRecorded] = useState<HistoryFact>();
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
    // Live: saved to the server first; the draft stays open until it is, so a refusal loses nothing.
    edit.save({ historyFacts: [...(encounter.historyFacts ?? []), fact] }, value => ({ ...value, historyFacts: [...(value.historyFacts ?? []), fact], historyDraft: undefined, noteReviewed: false }),
      () => { haptic("done"); setRecorded(fact); setPendingRevision(revision); setOpen(false); Keyboard.dismiss(); });
  };
  const discard = () => { updateEncounter(value => ({ ...value, historyDraft: undefined })); setOpen(false); };
  const ready = Boolean(draft?.value.trim() && draft.source.trim());
  const count = facts.length ? `${facts.length} ${facts.length === 1 ? "change" : "changes"} in this result` : undefined;
  const title = current && edit.allowed ? "Update history" : "History used";

  return <Animated.View layout={layout} style={{ gap: 12 }}>
    {/* Under a section header every change registers up front, so the pill counts them while this stays collapsed. */}
    {scope && facts.map(fact => <SourceRef key={fact.id} {...sourceOf(fact, onSource)} />)}
    <Pressable accessibilityRole="button" accessibilityLabel={count ? `${title}. ${count}` : title} accessibilityState={{ expanded: shown }}
      onPress={() => { haptic(); setShown(value => !value); }}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", transform: [{ scale: pressed ? 0.96 : 1 }], transitionProperty: "transform", transitionDuration: 120 } as never)}>
      <Icon name="clock.arrow.circlepath" size={15} color={palette.muted} />
      <Text style={{ ...type.callout, fontWeight: "500", color: palette.ink }}>{title}</Text>
      {count && <Text style={{ ...type.footnote, color: palette.muted, fontVariant: ["tabular-nums"] }}>{count}</Text>}
      <Animated.View style={{ transform: [{ rotate: shown ? "90deg" : "0deg" }], transitionProperty: "transform", transitionDuration: reducedMotion ? 0 : 240 }}>
        <Icon name="chevron.right" size={12} color={palette.muted} />
      </Animated.View>
    </Pressable>
    {recorded && <Animated.View entering={reducedMotion ? undefined : riseIn({ distance: 6, duration: 260 })}>
      <Caption icon="checkmark.circle" color={palette.blue}>Recorded at revision {recorded.revision}: {recorded.value}. The refreshed response will reflect this update; the earlier result remains unchanged.</Caption>
    </Animated.View>}
    {shown && <Expand style={{ gap: 12 }}>
      {!current && <Caption>This result retains the history available at revision {result?.revision}. Open the latest response to add a correction.</Caption>}
      {!last && <Caption>No earlier visit record to compare. This reflects the encounter’s intake.</Caption>}
      {(last || (current && edit.allowed) || facts.length > 0) && <Surface layout={layout} style={{ paddingHorizontal: 16 }}>
        {last && <View style={{ flexDirection: "row", gap: 12, paddingVertical: 16 }}>
          <IconDisc icon={categoryOf(last.category).icon} />
          <View style={{ flex: 1, gap: 3, paddingTop: 1 }}>
            <Text selectable style={{ fontSize: 13, lineHeight: 18, color: palette.muted }}>{categoryOf(last.category).label} · {last.date} · revision {last.revision}</Text>
            <Text selectable style={{ fontSize: 16, lineHeight: 23, color: palette.ink }}>{last.value}</Text>
            <SourceRef {...sourceOf(last, onSource)} />
          </View>
        </View>}

        {current && edit.allowed && <Disclosure first={!last} icon="pencil" title={!open && draft ? "Continue history draft" : "Add or correct history"} detail="Saving refreshes this answer. Earlier results stay as they were."
          accessibilityLabel={open ? "Hide history form" : draft ? "Continue history draft" : "Add or correct history"} open={open && !!draft} onToggle={() => open && draft ? setOpen(false) : start()}>
          {draft && <>
            <View style={{ gap: 8 }}>
              <FieldLabel>Category</FieldLabel>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {categories.map(category => <Chip key={category.value} label={category.label} selected={draft.category === category.value} onPress={() => { haptic(); updateDraft({ category: category.value }); }} />)}
              </View>
            </View>
            <View style={{ gap: 8 }}>
              <FieldLabel>Recorded fact</FieldLabel>
              <TextInput testID="clinical-recorded-fact" accessibilityLabel="Recorded fact" value={draft.value} onChangeText={value => updateDraft({ value })} multiline maxLength={600}
                placeholder="What was reported or found" placeholderTextColor={placeholder} style={[field, { minHeight: 88, textAlignVertical: "top" }]} />
            </View>
            <View style={{ gap: 8 }}>
              <FieldLabel>Source or speaker</FieldLabel>
              <TextInput testID="clinical-source-or-speaker" accessibilityLabel="Source or speaker" value={draft.source} onChangeText={source => updateDraft({ source })} maxLength={120} returnKeyType="done"
                placeholder="Patient, relative, referral letter…" placeholderTextColor={placeholder} style={[field, { minHeight: 48 }]} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <FieldLabel>Date</FieldLabel>
              <DateTimePicker style={{ width: 124 }} value={new Date(`${draft.date}T12:00:00`)} mode="date" display="compact" themeVariant="light" accentColor={palette.blue} onValueChange={(_, date) => updateDraft({ date: localDate(date) })} />
            </View>
            <Caption>This correction replaces the current summary for its category. Earlier facts and their sources remain inspectable.</Caption>
            {edit.error && <Caption icon="exclamationmark.triangle" color={palette.amber}>{edit.error}</Caption>}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Action label="Discard" accessibilityLabel="Discard this history draft" secondary onPress={discard} />
              <View style={{ flex: 1 }}><Action label="Save & update" accessibilityLabel="Save history and update response" icon="checkmark" disabled={!ready || edit.saving} onPress={save} /></View>
            </View>
          </>}
        </Disclosure>}

        {facts.length > 0 && <Disclosure first={!last && !(current && edit.allowed)} icon="clock.arrow.circlepath" title="History versions" detail={`${facts.length} recorded ${facts.length === 1 ? "change" : "changes"} in this result`}
          accessibilityLabel={versions ? "Hide history versions" : "Inspect history versions"} open={versions} onToggle={() => setVersions(value => !value)}>
          {/* A trail: the current fact for each category is a filled dot, superseded ones hollow. */}
          <View>{facts.map((fact, index) => {
            const superseded = facts.slice(index + 1).some(next => next.category === fact.category);
            return <View key={fact.id} style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ width: 36, alignItems: "center", paddingTop: 5 }}>
                <View style={{ width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.5, borderColor: superseded ? palette.muted : palette.blue, backgroundColor: superseded ? "transparent" : palette.blue }} />
                {index < facts.length - 1 && <View style={{ flex: 1, width: 1.5, marginTop: 4, borderRadius: 1, backgroundColor: palette.line }} />}
              </View>
              <View style={{ flex: 1, gap: 3, paddingBottom: index < facts.length - 1 ? 16 : 0 }}>
                <Text selectable style={{ fontSize: 12, lineHeight: 17, color: palette.muted }}>Revision {fact.revision} · {categoryOf(fact.category).label} · {fact.date}</Text>
                <Text selectable style={{ fontSize: 15, lineHeight: 21, color: superseded ? palette.muted : palette.ink }}>{fact.value}</Text>
                <Text selectable style={{ fontSize: 13, lineHeight: 18, color: palette.muted }}>Source: {fact.source} · {superseded ? "Superseded in this result" : "Current for this category"}</Text>
                <SourceRef {...sourceOf(fact, onSource)} />
              </View>
            </View>;
          })}</View>
        </Disclosure>}
      </Surface>}
    </Expand>}
  </Animated.View>;
}
