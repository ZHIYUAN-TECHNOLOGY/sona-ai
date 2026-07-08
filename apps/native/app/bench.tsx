import { Stack } from "expo-router";

import BenchmarkScreen from "@/spike/BenchmarkScreen";

// Dev-only route: the on-device Gate-0 benchmark harness. Reached from Settings.
export default function BenchRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "On-device bench" }} />
      <BenchmarkScreen />
    </>
  );
}
