import { useLocalSearchParams } from "expo-router";
import { WorkspaceScreen } from "@/features/encounter/workspace-screen";

export default function SessionRoute() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  return <WorkspaceScreen mode="session" sessionId={patientId} />;
}
