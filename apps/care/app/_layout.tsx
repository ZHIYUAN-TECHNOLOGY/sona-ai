import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CalmCanvas } from "@/lib/canvas";
import { palette } from "@/lib/theme";
import { queryClient } from "@/utils/orpc";

/** Sona Care: the patient's side of their care (check-ins, discharge, follow-ups, messages to the care team). */
export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.canvas }}><KeyboardProvider><SafeAreaProvider><QueryClientProvider client={queryClient}>
    <StatusBar style="dark" />
    <CalmCanvas />
    <Stack screenOptions={{ headerTransparent: true, headerBlurEffect: "systemUltraThinMaterialLight", headerShadowVisible: false, headerTitle: "", headerBackButtonDisplayMode: "minimal", headerTintColor: palette.ink, contentStyle: { backgroundColor: "transparent" } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="join" options={{ presentation: "modal", headerShown: false }} />
    </Stack>
  </QueryClientProvider></SafeAreaProvider></KeyboardProvider></GestureHandlerRootView>;
}
