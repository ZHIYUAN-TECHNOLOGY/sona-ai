import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
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
import { useColorScheme } from "@/lib/use-color-scheme";
import { queryClient } from "@/utils/orpc";

const LIGHT_THEME = {
  ...DefaultTheme,
  colors: NAV_THEME.light,
};
const DARK_THEME = {
  ...DarkTheme,
  colors: NAV_THEME.dark,
};

export const unstable_settings = {
  initialRouteName: "(drawer)",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default function RootLayout() {
  const { isDarkColorScheme } = useColorScheme();

  return (
    <>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={isDarkColorScheme ? DARK_THEME : LIGHT_THEME}>
          <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
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
