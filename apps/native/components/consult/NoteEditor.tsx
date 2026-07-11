import type { ReactElement } from "react";

import { NativeFallbackBoundary } from "@/components/consult/NativeFallbackBoundary";
import { PlainNoteEditor, type NoteEditorProps } from "@/components/consult/PlainNoteEditor";

// The note editor. Prefers the native rich WYSIWYG editor (react-native-enriched-markdown) —
// bold / headings / bullets render live, no raw ** or ## — and falls back to the plain
// Markdown editor if that native module isn't in the binary. Two guards: a require() try/catch
// for a JS import failure, and an error boundary for a native Fabric render failure (the
// svg/skia "Unimplemented component" mode in this precompiled-RN setup). Both editors share
// the markdown-in → markdown-out contract, so editClinicalNote is unchanged either way.
// Set RICH_EDITOR_ENABLED = false to force the plain editor.
const RICH_EDITOR_ENABLED = true;

type EditorComponent = (props: NoteEditorProps) => ReactElement;

let EnrichedNoteEditor: EditorComponent | null = null;
if (RICH_EDITOR_ENABLED) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    EnrichedNoteEditor = require("./EnrichedNoteEditor").EnrichedNoteEditor;
  } catch {
    EnrichedNoteEditor = null; // native module absent — plain editor only
  }
}

export function NoteEditor(props: NoteEditorProps): ReactElement {
  if (!EnrichedNoteEditor) return <PlainNoteEditor {...props} />;
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
