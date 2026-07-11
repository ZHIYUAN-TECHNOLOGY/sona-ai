import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
  type StyleState,
} from "react-native-enriched-markdown";

import { Card } from "@/components/consult/Card";
import type { NoteEditorProps } from "@/components/consult/PlainNoteEditor";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { colors, font, radius, space } from "@/lib/theme";

// Rich WYSIWYG note editor (react-native-enriched-markdown). The clinician edits the note
// with bold / headings / bullets rendered LIVE — no raw ** or ## — and the component emits
// Markdown, so the save contract (markdown in → markdown out → editClinicalNote parses SOAP)
// is unchanged. Native Fabric view; wrapped by NoteEditor in an error boundary so a build
// where it isn't registered falls back to the plain editor. On-device only.

function ToolBtn({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.toolBtn, active && styles.toolBtnActive]}
    >
      <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>{label}</Text>
    </Pressable>
  );
}

export function EnrichedNoteEditor({ initial, onSave, onCancel, saving = false }: NoteEditorProps) {
  const ref = useRef<EnrichedMarkdownTextInputInstance>(null);
  const [state, setState] = useState<StyleState | null>(null);

  // Read the authoritative markdown from the native side on save (not the onChangeMarkdown
  // echo, which may emit canonicalized text on mount). Falls back to `initial` if unavailable.
  const save = async () => {
    const md = (await ref.current?.getMarkdown().catch(() => undefined)) ?? initial;
    onSave(md);
  };

  return (
    <>
      <Card>
        <View style={styles.head}>
          <Ionicons name="sparkles-outline" size={16} color={colors.green} />
          <Text style={styles.headLabel}>Editing note</Text>
        </View>

        <View style={styles.toolbar}>
          <ToolBtn label="B" active={state?.bold.isActive} onPress={() => ref.current?.toggleBold()} />
          <ToolBtn label="I" active={state?.italic.isActive} onPress={() => ref.current?.toggleItalic()} />
          <ToolBtn label="U" active={state?.underline.isActive} onPress={() => ref.current?.toggleUnderline()} />
        </View>

        <EnrichedMarkdownTextInput
          ref={ref}
          defaultValue={initial}
          onChangeState={setState}
          editable={!saving}
          autoFocus
          placeholder="Note is empty. Type the note here…"
          placeholderTextColor={colors.ink3}
          markdownStyle={{ strong: { color: colors.ink }, em: { color: colors.ink } }}
          style={styles.input}
        />
      </Card>
      <Text style={styles.hint}>
        Rich editor · edits stay on this device. Bold, ## headings and - lists render live.
      </Text>
      <View style={styles.actions}>
        <PrimaryButton
          label="Cancel"
          variant="ghost"
          style={styles.action}
          onPress={onCancel}
          disabled={saving}
        />
        <PrimaryButton
          label={saving ? "Saving…" : "Save"}
          style={styles.action}
          onPress={save}
          disabled={saving}
          icon={saving ? undefined : <Ionicons name="checkmark" size={17} color={colors.white} />}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: space.sm },
  headLabel: { ...font.label, color: colors.green, textTransform: "uppercase" },
  toolbar: { flexDirection: "row", gap: space.xs, marginBottom: space.sm },
  toolBtn: {
    width: 34,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  toolBtnActive: { backgroundColor: colors.green50, borderColor: colors.green100 },
  toolLabel: { fontSize: 15, fontWeight: "700", color: colors.ink2 },
  toolLabelActive: { color: colors.greenInk },
  input: {
    ...font.body,
    color: colors.ink,
    minHeight: 260,
    lineHeight: 22,
    padding: 0,
  },
  hint: { ...font.bodySm, color: colors.ink3, marginTop: space.xs, marginBottom: space.sm },
  actions: { flexDirection: "row", gap: space.sm },
  action: { flex: 1 },
});
