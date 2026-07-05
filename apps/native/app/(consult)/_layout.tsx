import { Stack } from "expo-router";

import { PipelineProvider } from "@/lib/pipeline/PipelineProvider";
import { colors } from "@/lib/theme";

// The consult flow is a linear stack: consent → recording → privacy → note →
// sign → complete. Headers are hidden; each screen renders its own TopBar. The
// flow is a fixed light theme (colors.bg) regardless of OS colour scheme.
// PipelineProvider holds the on-device pipeline state (consultId, live transcript,
// redaction) across these routes.
export default function ConsultLayout() {
  return (
    <PipelineProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </PipelineProvider>
  );
}
