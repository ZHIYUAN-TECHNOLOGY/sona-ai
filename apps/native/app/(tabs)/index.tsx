import { ConsultListScreen } from "@/components/consult/ConsultListScreen";
import { isToday } from "@/lib/consultFormat";
import { listConsults } from "@/lib/db";

const loadToday = async () => (await listConsults()).filter((c) => isToday(c.createdAt));

// Tab 1 — Today: only today's consults. The raised Record FAB (in TabScaffold)
// starts a new consult.
export default function TodayScreen() {
  return (
    <ConsultListScreen
      title="Consults"
      load={loadToday}
      emptyIcon="mic-outline"
      emptyTitle="No consults today"
      emptyBody="Tap the record button to start a consult."
    />
  );
}
