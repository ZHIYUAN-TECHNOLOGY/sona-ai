import { Stack } from "expo-router";

import { colors } from "@/lib/theme";

// The consult flow is a linear stack: consent → recording → privacy → note →
// sign → complete. Headers are hidden; each screen renders its own TopBar. The
// flow is a fixed light theme (colors.bg) regardless of OS colour scheme.
export default function ConsultLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
