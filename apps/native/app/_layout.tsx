import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  useFonts,
} from "@expo-google-fonts/fraunces";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { initExecutorch } from "react-native-executorch";
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher";

// Register the Expo resource fetcher once, before any useLLM/useSpeechToText hook
// runs. Without this, react-native-executorch cannot download models on-device in
// an Expo app and the spike hooks never become ready. (Required as of RN-ExecuTorch 0.9.)
initExecutorch({ resourceFetcher: ExpoResourceFetcher });

import { initSpeakerModel } from "@/lib/diarize";
import { colors } from "@/lib/theme";
import { queryClient } from "@/utils/orpc";

// Keep the splash up until Fraunces (the serif display face) is ready, so screen
// titles never flash in the fallback system serif.
void SplashScreen.preventAutoHideAsync();

// Nav theme derived from the green design tokens (single source — the old blue
// Better-T-Stack NAV_THEME is deleted). Sona is LIGHT-THEME ONLY, on projectors
// and in bright clinics, regardless of the device appearance.
const LIGHT_THEME = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.green,
    background: colors.bg,
    card: colors.card,
    text: colors.ink,
    border: colors.line,
    notification: colors.red,
  },
};

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Load the real on-device speaker model if one is configured (speakerModel.ts). No-op /
  // instant when none is set — diarization stays on the mock embedder. Never throws.
  useEffect(() => {
    void initSpeakerModel();
  }, []);

  // NOTE: the dev STT self-test used to auto-run here on launch. REMOVED from the launch path:
  // its run5 "audio session dance" deactivates the audio session, and when a user started
  // recording before the ~60s test finished it killed the live mic (0.0s captures). The module
  // (lib/pipeline/sttSelfTest) remains for manual/dev invocation only.

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={LIGHT_THEME}>
        <StatusBar style="dark" />
        <GestureHandlerRootView style={styles.container}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="(consult)" options={{ headerShown: false }} />
            <Stack.Screen name="consult/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="search" options={{ headerShown: false }} />
            <Stack.Screen name="bench" options={{ headerShown: true }} />
            <Stack.Screen name="enroll" options={{ headerShown: true }} />
            <Stack.Screen name="diarize-lab" options={{ headerShown: true }} />
            <Stack.Screen name="ocr-lab" options={{ headerShown: true }} />
            <Stack.Screen name="stt-lab" options={{ headerShown: false }} />
            <Stack.Screen name="ai-models" options={{ headerShown: false }} />
            <Stack.Screen name="on-device" options={{ headerShown: true }} />
            {/* Knowledge moved out of the tab capsule (Smart Scan took the slot) —
                minimal transparent header = just the back chevron; the screen's own
                serif title is the real title. */}
            <Stack.Screen
              name="knowledge"
              options={{ headerShown: true, title: "", headerTransparent: true }}
            />
            <Stack.Screen name="scan-review" options={{ headerShown: false }} />
            <Stack.Screen name="scan-attach" options={{ headerShown: false }} />
          </Stack>
        </GestureHandlerRootView>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
