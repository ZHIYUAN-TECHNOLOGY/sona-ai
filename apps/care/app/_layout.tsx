import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack, ThemeProvider } from "expo-router";
import { DefaultTheme } from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, Keyboard, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LiveUpdates } from "@/features/live";
import { DoseReminders } from "@/features/doses/remind";
import { PushSetup } from "@/features/notifications";
import { CalmCanvas } from "@/lib/canvas";
import { Dock } from "@/lib/dock";
import { poke, slide } from "@/lib/idle";
import { FONTS } from "@/lib/text";
import { palette } from "@/lib/theme";
import { queryClient } from "@/utils/orpc";

// Hold the splash until Plus Jakarta Sans has loaded, so no screen draws in the system font first.
SplashScreen.preventAutoHideAsync().catch(() => {});
// The splash is the bare canvas (app.json), so fading it reads as the opening's orb blooming in (features/opening).
SplashScreen.setOptions({ duration: 300, fade: true });

// Form sheets draw on their own white, not the canvas.
const SHEETS = new Set(["medicine", "about-data"]);

const touched = () => { poke(); return false; };

/** The keyboard opening or closing, and the app coming back to the front, are activity too. */
function ActivityWatch() {
  useEffect(() => {
    const subs = [Keyboard.addListener("keyboardWillShow", poke), Keyboard.addListener("keyboardWillHide", poke),
      AppState.addEventListener("change", s => { if (s === "active") poke(); })];
    return () => subs.forEach(sub => sub.remove());
  }, []);
  return null;
}

/** Sona Care: the patient's side of their care (check-ins, discharge, follow-ups, messages to the care team). */
export default function RootLayout() {
  const [fonts, fontError] = useFonts(FONTS);
  useEffect(() => { if (fonts || fontError) void SplashScreen.hideAsync(); }, [fonts, fontError]);
  if (!fonts && !fontError) return null;
  // Every touch start is activity (lib/idle): seen on the way down, never claimed, so the touch goes on as before.
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.canvas }} onStartShouldSetResponderCapture={touched}><ActivityWatch /><KeyboardProvider><SafeAreaProvider><QueryClientProvider client={queryClient}>
    <StatusBar style="dark" />
    {/* The navigation theme's own background (#F2F2F2) would cover the canvas; make it clear. */}
    <ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: "transparent" } }}>
    {/* No header band: every screen runs to the top like home; screens off the dock carry their own glass back button.
        Every screen carries its own living canvas (screenLayout), so it is opaque, and a page opened on top slides in
        with the native push; the swipe back (from anywhere on the screen) slides it off and uncovers the page beneath.
        When screens were clear over one shared canvas, a swipe back showed both pages' text on top of each other.
        Sheets keep their white. Screens out of sight are frozen, so their clocks and live queries don't re-render.
        Every screen's and sheet's transition is reported (`slide`): the canvas and the orb hold their frame while one slides. */}
    <Stack screenLayout={({ route, children }) => SHEETS.has(route.name) ? children : <View style={{ flex: 1 }}><CalmCanvas />{children}</View>}
      screenListeners={{ transitionStart: e => { if (e.target) slide(e.target, true); }, transitionEnd: e => { if (e.target) slide(e.target, false); } }}
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" },
      fullScreenGestureEnabled: true, freezeOnBlur: true }}>
      {/* The dock's four places are one tab navigator (app/(tabs)): they switch at once, with no swipe back between them. */}
      <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
      {/* Zoom destinations (iOS 18+ native zoom from the row or card tapped): opaque like every screen, so the zoom never shows both. */}
      <Stack.Screen name="find-doctor" />
      <Stack.Screen name="doctor" />
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
