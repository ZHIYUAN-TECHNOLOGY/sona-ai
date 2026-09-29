import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "@/components/sona/theme";
import { IconButton } from "@/components/sona/ui";
import { CriticalAlert } from "@/features/critical";
import { LiveUpdates } from "@/features/live/channel";
import { EncounterProvider } from "@/features/encounter/store";
import { ScribePlayback } from "@/features/scribe";

export const unstable_settings = { initialRouteName: "index" };

export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1 }}><KeyboardProvider><SafeAreaProvider><EncounterProvider><ScribePlayback /><StatusBar style="dark" /><Stack screenOptions={{ headerLeft: () => <IconButton name="chevron.left" label="Return to previous screen" onPress={() => router.canGoBack() ? router.back() : router.replace("/")} />, headerTransparent: true, headerStyle: { backgroundColor: "transparent" }, headerBlurEffect: "none", headerTintColor: palette.ink, headerShadowVisible: false, headerBackButtonDisplayMode: "minimal", contentStyle: { backgroundColor: palette.canvas } }}>
    <Stack.Screen name="index" options={{ headerShown: false }} />
    <Stack.Screen name="session/[patientId]" options={{ headerShown: false }} />
    <Stack.Screen name="patients" options={{ title: "Choose a patient", presentation: "formSheet", sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true }} />
    <Stack.Screen name="source" options={{ title: "Source detail", presentation: "formSheet", sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
    <Stack.Screen name="visits" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
    <Stack.Screen name="sources" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
    <Stack.Screen name="about-data" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
    <Stack.Screen name="recording" options={{ title: "Consultation", presentation: "modal" }} />
    <Stack.Screen name="note" options={{ title: "Consultation note" }} />
    <Stack.Screen name="xray" options={{ title: "Chest X-ray", presentation: "modal" }} />
    <Stack.Screen name="scan" options={{ title: "Scan a note", presentation: "modal" }} />
    <Stack.Screen name="tasks" options={{ title: "Follow-up tasks" }} />
    <Stack.Screen name="inbox/index" options={{ title: "Messages" }} />
    <Stack.Screen name="inbox/[patientId]" options={{ title: "" }} />
    <Stack.Screen name="handover" options={{ title: "Shift handover" }} />
    <Stack.Screen name="ward" options={{ title: "Ward" }} />
    <Stack.Screen name="audit" options={{ title: "Coding audit" }} />
    <Stack.Screen name="training" options={{ title: "Training data" }} />
    <Stack.Screen name="discharge" options={{ headerShown: false, presentation: "modal" }} />
    <Stack.Screen name="claim" options={{ headerShown: false, presentation: "modal" }} />
    <Stack.Screen name="history" options={{ title: "Settings", presentation: "modal" }} />
    <Stack.Screen name="library-scan" options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
    <Stack.Screen name="library-ocr" options={{ title: "Read with OCR", presentation: "modal" }} />
    <Stack.Screen name="library-scanned" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
    <Stack.Screen name="library-add" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
  </Stack><LiveUpdates /><CriticalAlert /></EncounterProvider></SafeAreaProvider></KeyboardProvider></GestureHandlerRootView>;
}
