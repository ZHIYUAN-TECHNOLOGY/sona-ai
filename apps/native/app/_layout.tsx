import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, Keyboard } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { poke, slide } from "@/components/sona/idle";
import { palette } from "@/components/sona/theme";
import { BackButton, CloseButton } from "@/components/sona/ui";
import { CriticalAlert } from "@/features/critical";
import { LiveUpdates } from "@/features/live/channel";
import { underVisit } from "@/features/encounter/navigation";
import { EncounterProvider } from "@/features/encounter/store";
import { ScribePlayback } from "@/features/scribe";

export const unstable_settings = { initialRouteName: "index" };
// One rule: pushed pages get the back chevron (screenOptions); modals and sheets get one close control on the right.
const closable = { headerLeft: () => null, headerRight: () => <CloseButton /> };

const touched = () => { poke(); return false; };
/** Stops re-rendering while a visit covers it (`underVisit`). */
const rests = ({ navigation, route }: { navigation: { getState: () => { routes: readonly { key: string; name: string }[] } }; route: { key: string } }) => ({ freezeOnBlur: underVisit(navigation.getState().routes, route.key) });
/** Placed under a closing sheet without a slide of its own (openSessionFromSheet); cleared once it has arrived, so back slides. */
const quiet = (route: { params?: object }) => Boolean((route.params as { quiet?: string } | undefined)?.quiet);

/** The keyboard opening or closing, and the app coming back to the front, are activity too. */
function ActivityWatch() {
  useEffect(() => {
    const subs = [Keyboard.addListener("keyboardWillShow", poke), Keyboard.addListener("keyboardWillHide", poke),
      AppState.addEventListener("change", s => { if (s === "active") poke(); })];
    return () => subs.forEach(sub => sub.remove());
  }, []);
  return null;
}

export default function RootLayout() {
  // Every touch start is activity (./components/sona/idle): seen on the way down, never claimed, so the touch goes on as before.
  // Every screen's and sheet's transition is reported too (`slide`): ambient motion holds its frame while one slides.
  return <GestureHandlerRootView style={{ flex: 1 }} onStartShouldSetResponderCapture={touched}><ActivityWatch /><KeyboardProvider><SafeAreaProvider><EncounterProvider><ScribePlayback /><StatusBar style="dark" /><Stack screenListeners={({ navigation, route }) => ({ transitionStart: e => { if (e.target) slide(e.target, true); }, transitionEnd: e => { if (e.target) slide(e.target, false); if (quiet(route)) navigation.setParams({ quiet: undefined }); } })} screenOptions={({ route }) => ({ animation: quiet(route) ? "none" : "default", headerLeft: () => <BackButton />, headerTransparent: true, headerStyle: { backgroundColor: "transparent" }, headerBlurEffect: "none", headerTintColor: palette.ink, headerShadowVisible: false, headerBackButtonDisplayMode: "minimal", contentStyle: { backgroundColor: palette.canvas } })}>
    {/* Today, a visit, Patients and a patient's card stop re-rendering while a visit covers them (`rests`); `quiet` (screenOptions): a page placed under a closing sheet, whose slide down is then the one transition (both ./features/encounter/navigation). */}
    <Stack.Screen name="index" options={p => ({ headerShown: false, ...rests(p) })} />
    <Stack.Screen name="session/[patientId]" options={p => ({ headerShown: false, ...rests(p) })} />
    {/* Patients and a patient's card are pages (owner's decision, 6 Oct): back goes card, list, Today, and a visit opened from the card returns to it. */}
    <Stack.Screen name="patients/index" options={p => ({ title: "Patients", ...rests(p) })} />
    <Stack.Screen name="patients/[id]" options={p => ({ title: "", ...rests(p) })} />
    <Stack.Screen name="source" options={{ ...closable, title: "Source detail", presentation: "formSheet", sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
    <Stack.Screen name="visits" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
    <Stack.Screen name="sources" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
    <Stack.Screen name="about-data" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
    <Stack.Screen name="recording" options={{ title: "Consultation" }} />
    <Stack.Screen name="note" options={{ title: "Consultation note" }} />
    <Stack.Screen name="xray" options={{ title: "Chest X-ray" }} />
    <Stack.Screen name="scan" options={{ title: "Scan a note" }} />
    <Stack.Screen name="tasks" options={{ title: "Follow-up tasks" }} />
    <Stack.Screen name="view/[id]" options={{ title: "" }} />
    <Stack.Screen name="inbox/index" options={{ title: "Messages" }} />
    <Stack.Screen name="inbox/[patientId]" options={{ title: "" }} />
    <Stack.Screen name="handover" options={{ title: "Shift handover" }} />
    <Stack.Screen name="ward" options={{ title: "Ward" }} />
    <Stack.Screen name="results" options={{ title: "Results" }} />
    <Stack.Screen name="health-summary" options={{ title: "Health summary" }} />
    <Stack.Screen name="audit" options={{ title: "Coding audit" }} />
    <Stack.Screen name="training" options={{ title: "Training data" }} />
    <Stack.Screen name="discharge" options={{ title: "Discharge" }} />
    <Stack.Screen name="claim" options={{ title: "Guarantee letter" }} />
    <Stack.Screen name="history" options={{ title: "Settings" }} />
    <Stack.Screen name="library-scan" options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
    <Stack.Screen name="library-ocr" options={{ title: "Read with OCR" }} />
    <Stack.Screen name="library-scanned" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: "fitToContents", sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
    <Stack.Screen name="library-add" options={{ title: "Add a source" }} />
  </Stack><LiveUpdates /><CriticalAlert /></EncounterProvider></SafeAreaProvider></KeyboardProvider></GestureHandlerRootView>;
}
