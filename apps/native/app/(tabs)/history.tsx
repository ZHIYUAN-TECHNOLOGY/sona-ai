import { ConsultListScreen } from "@/components/consult/ConsultListScreen";
import { isToday } from "@/lib/consultFormat";
import { listConsults } from "@/lib/db";

// Tab 2 — History: consults from previous days (today's live on the Today tab).
const loadHistory = async () => (await listConsults()).filter((c) => !isToday(c.createdAt));

export default function HistoryScreen() {
  return (
    <ConsultListScreen
      title="History"
      load={loadHistory}
      emptyIcon="time-outline"
      emptyTitle="No past consults"
      emptyBody="Consults from previous days appear here."
    />
  );
}
