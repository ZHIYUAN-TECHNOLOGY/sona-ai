import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { initExecutorch } from "react-native-executorch";
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher";
import { StatusBar } from "expo-status-bar";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

// Register the Expo resource fetcher once, before any useLLM/useSpeechToText hook
// runs. Without this, react-native-executorch cannot download models on-device in
// an Expo app and the spike hooks never become ready. (Required as of RN-ExecuTorch 0.9.)
initExecutorch({ resourceFetcher: ExpoResourceFetcher });

import { NAV_THEME } from "@/lib/constants";
import { queryClient } from "@/utils/orpc";

const LIGHT_THEME = {
  ...DefaultTheme,
  colors: NAV_THEME.light,
};

export const unstable_settings = {
  initialRouteName: "(drawer)",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
});

// Sona is a clinical tool used in bright clinics and demoed on projectors — it is
// LIGHT-THEME ONLY, regardless of the device's system appearance. Forcing the nav
// theme + a white root background here keeps every screen legible (some spike/dev
// screens use unstyled RN views that would otherwise inherit a dark window).
export default function RootLayout() {
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={LIGHT_THEME}>
          <StatusBar style="dark" />
          <GestureHandlerRootView style={styles.container}>
            <Stack>
              <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
              <Stack.Screen name="(consult)" options={{ headerShown: false }} />
              <Stack.Screen name="modal" options={{ title: "Modal", presentation: "modal" }} />
            </Stack>
          </GestureHandlerRootView>
        </ThemeProvider>
      </QueryClientProvider>
    </>
  );
}
