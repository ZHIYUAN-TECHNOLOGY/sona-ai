import { ConsultListScreen } from "@/components/consult/ConsultListScreen";
import { listConsults } from "@/lib/db";

// Tab 1 — Consults: every consult, grouped Today / Earlier by ConsultListScreen (so a
// separate History tab isn't needed). The separated Record capsule starts a new one.
export default function ConsultsScreen() {
  return (
    <ConsultListScreen
      title="Consults"
      load={listConsults}
      emptyIcon="mic-outline"
      emptyTitle="No consults yet"
      emptyBody="Tap the record capsule to start a consult."
    />
  );
}
