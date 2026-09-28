import { useLocalSearchParams } from "expo-router";
import { ThreadScreen } from "@/features/inbox/thread";

export default function InboxThreadRoute() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  return <ThreadScreen patientId={patientId} />;
}
