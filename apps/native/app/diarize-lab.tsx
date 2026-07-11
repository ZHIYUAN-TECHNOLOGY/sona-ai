import { Stack } from "expo-router";

import DiarizationLab from "@/spike/DiarizationLab";

// Dev-only route: the real on-device diarization lab (mic → VAD → embed → cluster).
// Reached from Settings → About.
export default function DiarizeLabRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Diarization lab" }} />
      <DiarizationLab />
    </>
  );
}
