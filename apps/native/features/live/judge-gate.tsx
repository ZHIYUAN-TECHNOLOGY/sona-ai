import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette } from "@/components/sona/theme";
import { Action, Body, Card, Notice, Screen, canvasImage } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import { JUDGE, useLive, useLiveSettled } from ".";
import { gateOf } from "./judge";
import { usePatientsRead } from "./patients-sync";
import { SIGN_IN_PROMPT, SignIn, signOut } from "./sign-in";

/**
 * The judge build's gate (rules in ./judge): until someone is signed in and the hospital record has been
 * read, it covers the app, so no screen can show sample data. Signed out it asks to sign in (Settings'
 * own card and form); a server that refuses or does not answer shows its reason with a retry. Mounted
 * once at the root by LiveUpdates (./channel), and only in the judge build.
 */
export function JudgeGate() {
  const insets = useSafeAreaInsets();
  const { user } = useLive();
  const settled = useLiveSettled();
  const { records, error, retry } = usePatientsRead();
  // "Show demo controls in answers" is remembered on the device: a phone that rehearsed with it on must not carry it into this build.
  const { showDemoControls, setShowDemoControls } = useEncounter();
  useEffect(() => { if (showDemoControls) setShowDemoControls(false); }, [showDemoControls, setShowDemoControls]);
  const gate = gateOf({ judge: JUDGE, settled, signedIn: Boolean(user), read: Boolean(records), failed: Boolean(error) });
  if (gate === "open") return null;
  // Above the critical alert (zIndex 100); the canvas alone while the saved sign-in is checked, so nothing flashes.
  return <View accessibilityViewIsModal style={{ position: "absolute", inset: 0, zIndex: 200, paddingTop: insets.top, backgroundColor: palette.canvas, experimental_backgroundImage: canvasImage }}>
    {gate !== "wait" && <Screen><Card label="Connection" title="Hospital record">
      {gate === "sign-in" ? <><Body muted>{SIGN_IN_PROMPT}</Body><SignIn /></> : <>
        <Body>Signed in as {user?.email}</Body>
        {gate === "reading" ? <Body muted>Reading the hospital record…</Body> : <><Notice warning>{error}</Notice><Action label="Try again" onPress={retry} /></>}
        <Action label="Sign out" secondary onPress={signOut} />
      </>}
    </Card></Screen>}
  </View>;
}
