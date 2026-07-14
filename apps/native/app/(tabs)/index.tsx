import { router } from "expo-router";

import { ConsultListScreen } from "@/components/consult/ConsultListScreen";
import { SearchField } from "@/components/consult/SearchField";
import { listConsults } from "@/lib/db";

// Tab 1 — Consults: every consult, grouped Today / Earlier by ConsultListScreen (so a
// separate History tab isn't needed; the Notes tab was folded in here too — it showed
// the same rows filtered to noted). The separated Record capsule starts a new one.
export default function ConsultsScreen() {
  return (
    <ConsultListScreen
      title="Consults"
      load={listConsults}
      topSlot={<SearchField placeholder="Search notes" onPress={() => router.push("/search")} />}
      emptyIcon="mic-outline"
      emptyTitle="No consults yet"
      emptyBody="Tap the record capsule to start a consult."
    />
  );
}
