import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
  type StyleState,
} from "react-native-enriched-markdown";

import { Card } from "@/components/consult/Card";
import type { NoteEditorProps } from "@/components/consult/PlainNoteEditor";
import { PrimaryButton } from "@/components/consult/PrimaryButton";
import { colors, font, radius, space } from "@/lib/theme";

// Rich WYSIWYG note editor (react-native-enriched-markdown). The clinician edits with the
// styles the library's INPUT actually supports — headings (H1/H2) + inline bold / italic /
// underline / strikethrough / link — rendered live, no raw ** or ##. The component emits
// Markdown, so the save contract (markdown → editClinicalNote → SOAP parse) is unchanged.
// Note: the input is a flat inline+heading surface — bullets/blockquote/code are not
// rendered by the editor (library limit); they stay as markdown text and render in the
// read-only note view. Native Fabric view; NoteEditor guards + falls back if unregistered.
// On-device only.

interface ToolProps {
  label: string;
  active?: boolean;
  strike?: boolean;
  onPress: () => void;
}
function ToolBtn({ label, active, strike, onPress }: ToolProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.toolBtn,
        active && styles.toolBtnActive,
        pressed && styles.toolBtnPressed,
      ]}
    >
      <Text style={[styles.toolLabel, active && styles.toolLabelActive, strike && styles.strike]}>{label}</Text>
    </Pressable>
  );
}

export function EnrichedNoteEditor({ initial, onSave, onCancel, saving = false }: NoteEditorProps) {
  const ref = useRef<EnrichedMarkdownTextInputInstance>(null);
  const [state, setState] = useState<StyleState | null>(null);

  // Read the authoritative markdown from the native side on save (not an onChangeMarkdown
  // echo, which can emit canonicalized text on mount). Falls back to `initial`.
  const save = async () => {
    const md = (await ref.current?.getMarkdown().catch(() => undefined)) ?? initial;
    onSave(md);
  };

  const onLink = () => {
    if (state?.link.isActive) return ref.current?.removeLink();
    if (Platform.OS === "ios") {
      Alert.prompt("Add link", "Enter a URL", (url) => url && ref.current?.insertLink(url, url), "plain-text", "https://");
    } else {
      ref.current?.insertLink("https://", "https://");
    }
  };

  const headingActive = (level: number) => !!state?.heading.isActive && state.heading.level === level;

  return (
    <>
      <Card>
        <View style={styles.head}>
          <Ionicons name="sparkles-outline" size={16} color={colors.green} />
          <Text style={styles.headLabel}>Editing note</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toolbar}
          keyboardShouldPersistTaps="always"
        >
          <ToolBtn label="H1" active={headingActive(1)} onPress={() => ref.current?.toggleHeading(1)} />
          <ToolBtn label="H2" active={headingActive(2)} onPress={() => ref.current?.toggleHeading(2)} />
          <View style={styles.sep} />
          <ToolBtn label="B" active={state?.bold.isActive} onPress={() => ref.current?.toggleBold()} />
          <ToolBtn label="I" active={state?.italic.isActive} onPress={() => ref.current?.toggleItalic()} />
          <ToolBtn label="U" active={state?.underline.isActive} onPress={() => ref.current?.toggleUnderline()} />
          <ToolBtn label="S" strike active={state?.strikethrough.isActive} onPress={() => ref.current?.toggleStrikethrough()} />
          <View style={styles.sep} />
          <ToolBtn label="Link" active={state?.link.isActive} onPress={onLink} />
        </ScrollView>

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
        Rich editor · edits stay on this device. Headings + bold/italic/underline render live.
      </Text>
      <View style={styles.actions}>
        <PrimaryButton label="Cancel" variant="ghost" style={styles.action} onPress={onCancel} disabled={saving} />
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
  toolbar: { flexDirection: "row", alignItems: "center", gap: space.xs, marginBottom: space.sm, paddingRight: space.sm },
  sep: { width: 1, height: 20, backgroundColor: colors.line, marginHorizontal: space.xs },
  toolBtn: {
    minWidth: 34,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  toolBtnActive: { backgroundColor: colors.green50, borderColor: colors.green100 },
  toolBtnPressed: { transform: [{ scale: 0.94 }], opacity: 0.8 },
  toolLabel: { fontSize: 14, fontWeight: "700", color: colors.ink2 },
  toolLabelActive: { color: colors.greenInk },
  strike: { textDecorationLine: "line-through" },
  input: { ...font.body, color: colors.ink, minHeight: 260, lineHeight: 22, padding: 0 },
  hint: { ...font.bodySm, color: colors.ink3, marginTop: space.xs, marginBottom: space.sm },
  actions: { flexDirection: "row", gap: space.sm },
  action: { flex: 1 },
});
