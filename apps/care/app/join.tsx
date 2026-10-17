import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Text } from "@/lib/text";
import { errorText } from "@/features/errors";
import { Head, Label } from "@/features/sign-in/head";
import "@/features/sign-in/strings";
import { tFor, useLang } from "@/lib/i18n";
import { authClient } from "@/lib/auth-client";
import { palette, type } from "@/lib/theme";
import { BackButton, Button, Field, pillStyle, useBelowStatusBar } from "@/lib/ui";
import { hospitalName } from "@/features/me";
import { client, queryClient } from "@/utils/orpc";

/**
 * Joining from the discharge paper (the kit's "Please scan / your code", then its "Hello! I'm …"
 * card): scan the QR (or type its code), confirm it is for you, create an account (or use the one you
 * are signed in with), and the code links it to your record.
 * The QR holds Sona Care web's https://…/care/join?code=… (any phone camera opens it); the scanner
 * reads `code=` from it, and a sona-care://join?code=… link still opens this screen directly.
 * A page pushed from home (steps, a camera and typing, so not a modal): back, or the swipe, leaves it.
 */
const codeFrom = (text: string) => text.match(/code=([A-Za-z0-9-]+)/)?.[1] ?? text;
const QR = "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM6 6h1v1H6zM17 6h1v1h-1zM6 17h1v1H6zM14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2";
/** The confirm card springs in (the kit's sheets and cards, after Canopi); still under Reduce Motion. */
const SPRING_IN = FadeInDown.springify().duration(380).dampingRatio(1);

export default function Join() {
  const still = useReducedMotion();
  const insets = useSafeAreaInsets();
  const below = useBelowStatusBar();
  const lang = useLang(), t = tFor(lang);
  const params = useLocalSearchParams<{ code?: string }>();
  const { data: session } = authClient.useSession();
  const [code, setCode] = useState(params.code ?? "");
  const [who, setWho] = useState<{ firstName: string; hospital: string }>();
  const [scanning, setScanning] = useState(false);
  const [typing, setTyping] = useState(false);
  const [permission, askPermission] = useCameraPermissions();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const check = async (value = code) => {
    setBusy(true); setError(undefined);
    try { setWho(await client.care.preview({ code: value })); } catch (e) { setError(errorText(e, lang)); }
    setBusy(false);
  };
  // A code from the QR's link is checked straight away.
  useEffect(() => { if (params.code) void check(params.code); }, [params.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = async () => {
    setBusy(true); setError(undefined);
    try {
      if (!session?.user) {
        const signedUp = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
        if (signedUp.error) throw new Error(signedUp.error.message ?? t("join.accountFailed"));
      }
      await client.care.join({ code });
      await queryClient.refetchQueries();
      router.replace("/");
    } catch (e) { setError(errorText(e, lang)); }
    setBusy(false);
  };
  const scan = () => { void (permission?.granted ? Promise.resolve() : askPermission()).then(() => setScanning(true)); };
  const accountReady = Boolean(session?.user) || (name.trim().length > 1 && email.trim().includes("@") && password.length >= 8);
  const cameraOff = permission && !permission.granted && !permission.canAskAgain;
  const showField = typing || code !== "";

  return <KeyboardAvoidingView behavior="padding" style={[{ flex: 1 }, below]}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 20, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) + 8, gap: 20 }}>
      <BackButton />

      {!who ? <>
        <Head light={t("join.scanLight")} bold={t("join.scanBold")} />
        <View style={{ borderRadius: 24, borderCurve: "continuous", backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, padding: 16, gap: 12 }}>
          {scanning && permission?.granted
            ? <View style={{ height: 280, borderRadius: 24, borderCurve: "continuous", overflow: "hidden" }}>
              <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={e => { setScanning(false); const c = codeFrom(e.data); setCode(c); void check(c); }} />
            </View>
            : <Pressable accessibilityRole="button" accessibilityLabel={t("join.scan")} accessibilityHint={t("join.scanHint")} onPress={scan}
              style={({ pressed }) => ({ height: 280, borderRadius: 24, borderCurve: "continuous", alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: palette.card, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Svg width={96} height={96} viewBox="0 0 24 24"><Path d={QR} fill="none" stroke={palette.ink} strokeWidth={1.4} strokeLinejoin="round" /></Svg>
              <Text style={{ ...type.body, fontWeight: "600", color: palette.ink }}>{t("join.tap")}</Text>
            </Pressable>}
          <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{cameraOff ? t("join.cameraOff") : t("join.where")}</Text>
        </View>

        {showField ? <Animated.View entering={still ? undefined : FadeIn.duration(180)} style={{ gap: 8 }}>
          <Label>{t("join.codeLabel")}</Label>
          <Field autoFocus={typing} value={code} onChangeText={setCode} placeholder="ABCD-2345" autoCapitalize="characters" autoCorrect={false}
            accessibilityLabel={t("join.codeLabel")} style={{ fontSize: 20, letterSpacing: 2, textAlign: "center" }} />
        </Animated.View>
          : <Pressable accessibilityRole="button" onPress={() => setTyping(true)} style={{ minHeight: 48, alignSelf: "center", justifyContent: "center", paddingHorizontal: 12 }}>
            <Text style={{ ...type.body, fontWeight: "600", color: palette.ink, textDecorationLine: "underline" }}>{t("join.type")}</Text>
          </Pressable>}
        {error && <Text selectable accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red, textAlign: "center" }}>{error}</Text>}
        <View style={{ flex: 1 }} />
        <Button label={t("join.continue")} busy={busy}disabled={code.replace(/[^A-Za-z0-9]/g, "").length < 8} onPress={() => { void check(); }} />
      </> : <>
        <Head light={t("join.helloLight")} bold={t("join.helloBold")} />
        <Animated.View entering={still ? undefined : SPRING_IN} style={[pillStyle, { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 30, backgroundColor: palette.greenWash, borderColor: palette.greenWash }]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.success }} />
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.green }}>{t("join.found")}</Text>
        </Animated.View>
        <Animated.View entering={still ? undefined : SPRING_IN.delay(40)}
          style={{ borderRadius: 24, borderCurve: "continuous", backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, padding: 22, gap: 12, alignItems: "center" }}>
          <View accessible={false} style={{ width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: palette.white,
            experimental_backgroundImage: "linear-gradient(145deg, #EBF1FF, #D8CBFF)", boxShadow: "0 10px 22px -12px rgba(51,92,255,0.45)" } as ViewStyle}>
            <Text allowFontScaling={false} style={{ fontSize: 32, fontWeight: "500", color: palette.blue }}>{who.firstName[0]?.toUpperCase()}</Text>
          </View>
          <View accessible style={{ alignItems: "center", gap: 2 }}>
            <Text style={{ fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.6, color: palette.ink }}>{who.firstName}</Text>
            <Text style={{ ...type.footnote, color: palette.faint }}>{hospitalName(who.hospital)}</Text>
          </View>
          <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>
            {session?.user ? t("join.linked", { account: accountName(session.user) }) : t("join.create")}
          </Text>
          {!session?.user && <View style={{ alignSelf: "stretch", gap: 8 }}>
            <Label>{t("join.name")}</Label>
            <Field value={name} onChangeText={setName} placeholder={t("join.nameHint")} autoComplete="name" accessibilityLabel={t("join.name")} />
            <Label>{t("in.emailLabel")}</Label>
            <Field value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="email" keyboardType="email-address" accessibilityLabel={t("in.emailLabel")} />
            <Label>{t("in.password")}</Label>
            <Field secret value={password} onChangeText={setPassword} placeholder={t("in.passwordHint")} autoComplete="new-password" accessibilityLabel={t("in.password")} />
          </View>}
        </Animated.View>
        {error && <Text selectable accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red, textAlign: "center" }}>{error}</Text>}
        <View style={{ flex: 1 }} />
        <View style={{ gap: 4 }}>
          <Button label={session?.user ? t("join.start") : t("join.createStart")} busy={busy}disabled={!accountReady} onPress={() => { void join(); }} />
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setWho(undefined); setCode(""); setTyping(false); }} style={{ minHeight: 48, alignSelf: "center", justifyContent: "center", paddingHorizontal: 12 }}>
            <Text style={{ ...type.body, fontWeight: "600", color: palette.muted }}>{t("join.notMe")}</Text>
          </Pressable>
        </View>
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}

/** How the patient knows their account: the phone number they signed in with, else their email (a phone account's email is a placeholder). */
function accountName(user: { email: string; phoneNumber?: string | null }) {
  return user.phoneNumber ?? user.email;
}
