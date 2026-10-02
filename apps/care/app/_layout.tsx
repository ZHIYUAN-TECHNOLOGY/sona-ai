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

const OPAQUE = { backgroundColor: "#FAFAFA", experimental_backgroundImage: "linear-gradient(180deg, #ECEFFC 0%, #F6F4FD 22%, #FAFAFC 55%, #FAFAFA 100%)" } as const;

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
    {/* No header band: every screen runs to the top like home; screens off the dock carry their own glass back button.
        Every screen is clear over the one living canvas, so a push crossfades (250 ms; the stack's default fade is 500)
        rather than slides: a slide would drag one clear page across another, both showing. The swipe back drives the
        same fade from anywhere on the screen. Screens out of sight are frozen, so their clocks and live queries don't
        re-render under the one in front. */}
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" }, animation: "fade", animationDuration: 250,
      animationMatchesGesture: true, fullScreenGestureEnabled: true, freezeOnBlur: true }}>
      {/* The dock's four places switch like tabs: a crossfade, never a swipe back between them. */}
      <Stack.Screen name="index" options={{ gestureEnabled: false }} />
      <Stack.Screen name="follow-ups" options={{ gestureEnabled: false }} />
      <Stack.Screen name="dose" options={{ gestureEnabled: false }} />
      <Stack.Screen name="doctors" options={{ gestureEnabled: false }} />
      {/* Zoom destinations (iOS 18+ native zoom from the row or card tapped) are opaque: a clear page zooming over the
          one it came from would show both. A still wash in the canvas's colours stands in for the living one. */}
      <Stack.Screen name="find-doctor" options={{ contentStyle: OPAQUE }} />
      <Stack.Screen name="doctor" options={{ contentStyle: OPAQUE }} />
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
