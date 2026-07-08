import { ConsultListScreen } from "@/components/consult/ConsultListScreen";
import { listNotedConsults } from "@/lib/db";

// Tab 3 — Notes: consults that have a drafted/signed clinical note.
export default function NotesScreen() {
  return (
    <ConsultListScreen
      title="Notes"
      load={listNotedConsults}
      emptyIcon="document-text-outline"
      emptyTitle="No notes yet"
      emptyBody="Drafted clinical notes appear here."
    />
  );
}
