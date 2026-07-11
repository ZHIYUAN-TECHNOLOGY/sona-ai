import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Card } from "@/components/consult/Card";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { colors, font, space } from "@/lib/theme";

/** Shared contract for both the plain and rich note editors (markdown in → markdown out). */
export interface NoteEditorProps {
  initial: string;
  onSave: (markdown: string) => void;
  onCancel: () => void;
  saving?: boolean;
}

/**
 * Plain-Markdown note editor (fallback). The clinician edits the rebuilt note Markdown (##
 * sections + `- ` orders); the caller parses it back into structured SOAP on save (see
 * editClinicalNote). On-device only — the edited text never leaves the phone. Used when the
 * native rich editor (react-native-enriched-markdown) isn't available on the build.
 */
export function PlainNoteEditor({ initial, onSave, onCancel, saving = false }: NoteEditorProps) {
  const [text, setText] = useState(initial);
  const dirty = text.trim() !== initial.trim();

  return (
    <>
      <Card>
        <View style={styles.head}>
          <Ionicons name="create-outline" size={16} color={colors.green} />
          <Text style={styles.headLabel}>Editing note</Text>
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          editable={!saving}
          textAlignVertical="top"
          style={styles.input}
          placeholder="Note is empty. Type the note here…"
          placeholderTextColor={colors.ink3}
          scrollEnabled={false}
        />
      </Card>
      <Text style={styles.hint}>
        Edits stay on this device. Use ## for a section heading and - for an order.
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
          onPress={() => onSave(text)}
          disabled={saving || !dirty}
          icon={saving ? undefined : <Ionicons name="checkmark" size={17} color={colors.white} />}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: space.sm },
  headLabel: { ...font.label, color: colors.green, textTransform: "uppercase" },
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
