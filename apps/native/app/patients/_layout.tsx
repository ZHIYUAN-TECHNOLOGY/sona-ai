import { Stack, useNavigation } from "expo-router";
import { palette } from "@/components/sona/theme";
import { IconButton } from "@/components/sona/ui";

// A patient's card opened straight from elsewhere (a flagged check-in) still has the list under it, for its back chevron.
export const unstable_settings = { initialRouteName: "index" };

/**
 * One sheet: the list, and a patient's card pushed inside it (the native push: slide, header and swipe back), so a
 * card never stacks a second sheet over the list. Close shuts the whole sheet, from the list or the card.
 */
export default function PatientsSheet() {
  const sheet = useNavigation();
  return <Stack screenOptions={{ headerTransparent: true, headerStyle: { backgroundColor: "transparent" }, headerBlurEffect: "none", headerTintColor: palette.ink, headerShadowVisible: false, contentStyle: { backgroundColor: palette.canvas },
    headerRight: () => <IconButton name="xmark" label="Close" onPress={() => sheet.goBack()} /> }}>
    <Stack.Screen name="index" options={{ headerLeft: () => null }} />
    <Stack.Screen name="[id]" options={{ headerBackTitle: "Patients", headerBackButtonDisplayMode: "default" }} />
  </Stack>;
}
