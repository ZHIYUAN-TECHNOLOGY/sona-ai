import type { ReactElement } from "react";
import { UIManager } from "react-native";

import { NativeFallbackBoundary } from "@/components/consult/NativeFallbackBoundary";
import { PlainNoteEditor, type NoteEditorProps } from "@/components/consult/PlainNoteEditor";

// The note editor. Prefers the native rich WYSIWYG editor (react-native-enriched-markdown) —
// bold / headings / bullets render live, no raw ** or ## — and falls back to the plain
// Markdown editor when that native Fabric component isn't compiled into the binary.
//
// THREE guards, because an unregistered Fabric component fails SILENTLY (it renders RN's
// "Unimplemented component" placeholder — it does NOT throw, so a require()-guard and an
// error boundary alone miss it):
//   1. require() try/catch — a JS import failure of the package.
//   2. UIManager.hasViewManagerConfig(name) — New Arch (bridgeless) routes this to
//      unstable_hasComponent, which reports whether the native component is actually
//      registered in THIS binary. False on a JS-only reload of a build without the module.
//   3. NativeFallbackBoundary — catches any render-time throw as a last resort.
// Set RICH_EDITOR_ENABLED = false to force the plain editor.
const RICH_EDITOR_ENABLED = true;
const RICH_COMPONENT = "EnrichedMarkdownTextInput";

type EditorComponent = (props: NoteEditorProps) => ReactElement;

let EnrichedNoteEditor: EditorComponent | null = null;
if (RICH_EDITOR_ENABLED) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    EnrichedNoteEditor = require("./EnrichedNoteEditor").EnrichedNoteEditor;
  } catch {
    EnrichedNoteEditor = null; // package JS failed to import
  }
}

let registered: boolean | null = null;
function isRichRegistered(): boolean {
  if (registered !== null) return registered;
  try {
    registered = !!UIManager.hasViewManagerConfig?.(RICH_COMPONENT);
  } catch {
    registered = false;
  }
  return registered;
}

export function NoteEditor(props: NoteEditorProps): ReactElement {
  if (!EnrichedNoteEditor || !isRichRegistered()) return <PlainNoteEditor {...props} />;
  return (
    <NativeFallbackBoundary
      fallback={<PlainNoteEditor {...props} />}
      onError={(e) => console.warn("[NoteEditor] rich editor failed, using plain:", e?.message)}
    >
      <EnrichedNoteEditor {...props} />
    </NativeFallbackBoundary>
  );
}

export type { NoteEditorProps };
