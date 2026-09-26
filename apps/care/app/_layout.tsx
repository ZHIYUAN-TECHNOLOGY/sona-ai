import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "@/lib/theme";
import { queryClient } from "@/utils/orpc";

/** Sona Care: the patient's side of their care (check-ins, messages to the care team). */
export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1 }}><KeyboardProvider><SafeAreaProvider><QueryClientProvider client={queryClient}>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.canvas } }} />
  </QueryClientProvider></SafeAreaProvider></KeyboardProvider></GestureHandlerRootView>;
}
