import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, ThemeProvider } from "expo-router";
import { DefaultTheme } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CalmCanvas } from "@/lib/canvas";
import { Dock } from "@/lib/dock";
import { palette } from "@/lib/theme";
import { queryClient } from "@/utils/orpc";

/** Sona Care: the patient's side of their care (check-ins, discharge, follow-ups, messages to the care team). */
export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.canvas }}><KeyboardProvider><SafeAreaProvider><QueryClientProvider client={queryClient}>
    <StatusBar style="dark" />
    <CalmCanvas />
    {/* The navigation theme's own background (#F2F2F2) would cover the canvas; make it clear. */}
    <ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: "transparent" } }}>
    {/* No header band: every screen runs to the top like home; screens off the dock carry their own glass back button. */}
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="join" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="assistant" options={{ presentation: "formSheet", headerShown: false, sheetAllowedDetents: [0.62, 0.95], sheetGrabberVisible: true, sheetCornerRadius: 36, contentStyle: { backgroundColor: "#FDFBFD" } }} />
    </Stack>
    <Dock />
    </ThemeProvider>
  </QueryClientProvider></SafeAreaProvider></KeyboardProvider></GestureHandlerRootView>;
}
