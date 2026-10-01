import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack, ThemeProvider } from "expo-router";
import { DefaultTheme } from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LiveUpdates } from "@/features/live";
import { DoseReminders } from "@/features/doses/remind";
import { PushSetup } from "@/features/notifications";
import { CalmCanvas } from "@/lib/canvas";
import { Dock } from "@/lib/dock";
import { FONTS } from "@/lib/text";
import { palette } from "@/lib/theme";
import { queryClient } from "@/utils/orpc";

// Hold the splash until Plus Jakarta Sans has loaded, so no screen draws in the system font first.
SplashScreen.preventAutoHideAsync().catch(() => {});
// The splash is the bare canvas (app.json), so fading it reads as the opening's orb blooming in (features/opening).
SplashScreen.setOptions({ duration: 300, fade: true });

/** Sona Care: the patient's side of their care (check-ins, discharge, follow-ups, messages to the care team). */
export default function RootLayout() {
  const [fonts, fontError] = useFonts(FONTS);
  useEffect(() => { if (fonts || fontError) void SplashScreen.hideAsync(); }, [fonts, fontError]);
  if (!fonts && !fontError) return null;
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.canvas }}><KeyboardProvider><SafeAreaProvider><QueryClientProvider client={queryClient}>
    <StatusBar style="dark" />
    <CalmCanvas />
    {/* The navigation theme's own background (#F2F2F2) would cover the canvas; make it clear. */}
    <ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: "transparent" } }}>
    {/* No header band: every screen runs to the top like home; screens off the dock carry their own glass back button. */}
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="join" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="medicine" options={{ presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 40, contentStyle: { backgroundColor: "#FFFFFF" } }} />
      <Stack.Screen name="about-data" options={{ presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 40, contentStyle: { backgroundColor: "#FFFFFF" } }} />
      {/* Ask Sona Care is a full screen (Life OS AI chat), opened from the orb in the dock. */}
      <Stack.Screen name="assistant" />
    </Stack>
    <Dock />
    <LiveUpdates />
    <PushSetup />
    <DoseReminders />
    </ThemeProvider>
  </QueryClientProvider></SafeAreaProvider></KeyboardProvider></GestureHandlerRootView>;
}
