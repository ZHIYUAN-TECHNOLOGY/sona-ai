import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Text, TextInput } from "@/lib/text";
import Animated, { FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useReducedMotion, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { authClient } from "@/lib/auth-client";
import { palette, type } from "@/lib/theme";
import { Button, CircleButton, field, ICON } from "@/lib/ui";
import { orpc, queryClient } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { LanguageRow } from "@/features/language/picker";
import { tFor, translate, useLang, useT, type Lang } from "@/lib/i18n";
import { Head, Label } from "./head";
import "./strings";
import { HeroOrb } from "./hero";
import { codeDigits, toE164 } from "./phone";

/**
 * Sona Care's welcome (the AI Health Companion kit's sign-in, with the Sona orb in place of its photo):
 * the orb large on the aurora, the "Sona Care" wordmark over a two-line head ("Your recovery, / between
 * visits"), then the ways in: phone in a full-width white capsule, Google and Apple in two glass
 * capsules, email as a quiet link. Choosing phone shrinks the hero into the header on a subtle spring
 * while the options fade and the kit's one-field screen rises, the black capsule above the keyboard;
 * then a six-box code. First-time patients sign in the same way, then link their record with the code
 * on their discharge paper.
 */
type Step = "options" | "phone" | "code" | "email";
const SPRING = { duration: 450, dampingRatio: 0.86 } as const;

export function Welcome() {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [step, setStep] = useState<Step>("options");
  const [error, setError] = useState<string>();
  const [phone, setPhone] = useState("");
  const go = (next: Step) => { setError(undefined); setStep(next); };
  const signedIn = () => { void queryClient.refetchQueries(); };
  // Staging only (DEMO_SIGN_IN): the seeded synthetic demo patient's number and fixed code, shown so judges can sign in.
  const demo = useQuery({ ...orpc.care.demoSignIn.queryOptions(), staleTime: Infinity }).data ?? undefined;

  // The hero is the shared element: large over the options, a small mark above the forms.
  const small = step !== "options";
  const heroStyle = useAnimatedStyle(() => {
    const to = (v: number) => reduced ? v : withSpring(v, SPRING);
    return { height: to(small ? 110 : 250), marginTop: to(small ? -8 : 12), transform: [{ scale: to(small ? 0.45 : 1) }] };
  });
  const enter = (i: number) => reduced ? FadeIn.duration(160) : FadeInDown.springify().duration(420).dampingRatio(0.9).delay(60 + i * 40);
  const leave = FadeOut.duration(120);

  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}>
      <View style={{ height: 48, justifyContent: "center" }}>
        {small && <Animated.View entering={FadeIn.duration(200)} exiting={leave} style={{ alignSelf: "flex-start" }}>
          <CircleButton d={ICON.back} label={t("common.back")} onPress={() => go(step === "code" ? "phone" : "options")} />
        </Animated.View>}
      </View>
      <Animated.View style={[{ alignItems: "center", justifyContent: "center" }, heroStyle]}><HeroOrb size={180} roll={step} /></Animated.View>

      {step === "options" && <Animated.View key="options" exiting={leave} style={{ flex: 1, justifyContent: "space-between", gap: 28 }}>
        <Animated.View entering={enter(0)} style={{ alignItems: "center", gap: 10, paddingTop: 8 }}>
          <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2, color: palette.ink }}>Sona <Text style={{ color: palette.blue }}>Care</Text></Text>
          <Head light={t("in.light")} bold={t("in.bold")} size={34} />
          <Text lineBreakStrategyIOS="standard" style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{t("in.line")}</Text>
        </Animated.View>
        <View style={{ gap: 10 }}>
          <Animated.View entering={enter(1)}>
            <Way label={t("in.phone")} hint={t("in.phoneHint")} onPress={() => go("phone")}
              icon={<Glyph d={ICON.phone} color={palette.ink} size={20} />} />
          </Animated.View>
          <Animated.View entering={enter(2)} style={{ flexDirection: "row", gap: 10 }}>
            <GoogleChoice onError={setError} />
            <AppleChoice onDone={signedIn} onError={setError} />
          </Animated.View>
          {error && <Text selectable accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red, textAlign: "center" }}>{error}</Text>}
          <Animated.View entering={enter(3)} style={{ alignItems: "center" }}>
            <Pressable accessibilityRole="button" onPress={() => go("email")} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 12 }}>
              <Text style={{ ...type.footnote, fontWeight: "600", color: palette.ink, textDecorationLine: "underline" }}>{t("in.email")}</Text>
            </Pressable>
            <Text style={{ ...type.footnote, color: palette.faint, textAlign: "center" }}>{t("in.first")}</Text>
            {/* Before sign-in there is no plan to take the language from: the patient picks it here. */}
            <LanguageRow />
          </Animated.View>
        </View>
      </Animated.View>}

      {step === "phone" && <Animated.View key="phone" exiting={leave} style={{ flex: 1, gap: 24, paddingTop: 12 }}>
        <Animated.View entering={enter(0)} style={{ gap: 6 }}>
          <Head light={t("in.phoneLight")} bold={t("in.phoneBold")} />
          <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{t("in.phoneLine")}</Text>
        </Animated.View>
        <Animated.View entering={enter(1)} style={{ flex: 1 }}><PhoneStep phone={phone} setPhone={setPhone} onSent={() => go("code")} demo={demo} /></Animated.View>
      </Animated.View>}

      {step === "code" && <Animated.View key="code" exiting={leave} style={{ flex: 1, gap: 24, paddingTop: 12 }}>
        <Animated.View entering={enter(0)} style={{ gap: 6 }}>
          <Head light={t("in.codeLight")} bold={t("in.codeBold")} />
          <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>{t("in.codeLine", { phone: toE164(phone) ?? "" })}</Text>
        </Animated.View>
        <Animated.View entering={enter(1)}><CodeStep phone={toE164(phone)!} onDone={signedIn} onChangeNumber={() => go("phone")} demoCode={demo && toE164(phone) === demo.phone ? demo.code : undefined} /></Animated.View>
      </Animated.View>}

      {step === "email" && <Animated.View key="email" exiting={leave} style={{ flex: 1, gap: 24, paddingTop: 12 }}>
        <Animated.View entering={enter(0)}><Head light={t("in.emailLight")} bold={t("in.emailBold")} /></Animated.View>
        <Animated.View entering={enter(1)} style={{ flex: 1 }}><EmailStep onDone={signedIn} /></Animated.View>
      </Animated.View>}
    </ScrollView>
  </KeyboardAvoidingView>;
}

/**
 * One way in as a kit capsule: the lead way full width in white (a soft lift), the others in glass
 * sharing a row. `hint` keeps the reassurance line for VoiceOver without crowding the capsule.
 */
function Way({ icon, label, hint, glass, busy, onPress, accessibilityLabel }: { icon: ReactNode; label: string; hint?: string; glass?: boolean; busy?: boolean; onPress: () => void; accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityHint={hint} accessibilityState={{ busy }} disabled={busy} onPress={onPress}
    style={({ pressed }) => [{ minHeight: 56, borderRadius: 28, borderCurve: "continuous", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 18, borderWidth: 1,
      transform: [{ scale: pressed ? 0.96 : 1 }] },
      glass ? { flex: 1, backgroundColor: "rgba(255,255,255,0.6)", borderColor: "rgba(255,255,255,0.9)" } : { backgroundColor: palette.white, borderColor: palette.line, boxShadow: "0 12px 26px -16px rgba(40,50,110,0.35)" }]}>
    {busy ? <ActivityIndicator color={palette.ink} /> : <>{icon}<Text style={{ flexShrink: 1, fontSize: 16, fontWeight: "600", color: palette.ink, textAlign: "center" }}>{label}</Text></>}
  </Pressable>;
}

function Glyph({ d, color, size = 22 }: { d: string; color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

const APPLE = "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04c-2.04.027-3.91 1.183-4.961 3.014c-2.117 3.675-.546 9.103 1.519 12.09c1.013 1.454 2.208 3.09 3.792 3.039c1.52-.065 2.09-.987 3.935-.987c1.831 0 2.35.987 3.96.948c1.637-.026 2.676-1.48 3.676-2.948c1.156-1.688 1.636-3.325 1.662-3.415c-.039-.013-3.182-1.221-3.22-4.857c-.026-3.04 2.48-4.494 2.597-4.559c-1.429-2.09-3.623-2.324-4.39-2.376c-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83c-1.207.052-2.662.805-3.532 1.818c-.78.896-1.454 2.338-1.273 3.714c1.338.104 2.715-.688 3.559-1.701";

/** Sign in with Apple: the native sheet, then its identity token to the server. iPhone only. */
function AppleChoice({ onDone, onError }: { onDone: () => void; onError: (m?: string) => void }) {
  // Shown on every iPhone; where the native sheet can't run (Expo Go on a simulator) the tap says so.
  const [busy, setBusy] = useState(false);
  const lang = useLang(), t = tFor(lang);
  if (process.env.EXPO_OS !== "ios") return null;
  const start = async () => {
    onError(undefined);
    if (!(await AppleAuthentication.isAvailableAsync().catch(() => false))) return onError(t("in.appleOff"));
    setBusy(true);
    try {
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL] });
      if (!credential.identityToken) throw new Error(t("in.appleFailed"));
      const { error } = await authClient.signIn.social({ provider: "apple", idToken: { token: credential.identityToken } });
      if (error) onError(providerError("Apple", error, lang)); else onDone();
    } catch (e) {
      if ((e as { code?: string }).code !== "ERR_REQUEST_CANCELED") onError(e instanceof Error ? e.message : t("in.appleFailed"));
    }
    setBusy(false);
  };
  return <Way glass busy={busy} label="Apple" accessibilityLabel={t("in.withApple")} onPress={() => { void start(); }}
    icon={<Svg width={18} height={18} viewBox="0 0 24 24"><Path d={APPLE} fill={palette.ink} /></Svg>} />;
}

/** Google opens its sign-in page in the browser and comes back to the app. */
function GoogleChoice({ onError }: { onError: (m?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const lang = useLang(), t = tFor(lang);
  const start = async () => {
    onError(undefined); setBusy(true);
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
    if (error) onError(providerError("Google", error, lang)); else void queryClient.refetchQueries();
    setBusy(false);
  };
  return <Way glass busy={busy} label="Google" accessibilityLabel={t("in.withGoogle")} onPress={() => { void start(); }} icon={<Svg width={18} height={18} viewBox="0 0 256 262">
    <Path fill="#4285f4" d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" />
    <Path fill="#34a853" d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" />
    <Path fill="#fbbc05" d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z" />
    <Path fill="#eb4335" d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" />
  </Svg>} />;
}

/** A provider the hospital has not switched on reads as that, not as a raw server error. */
function providerError(name: string, error: { code?: string; message?: string }, lang: Lang) {
  return /PROVIDER_NOT_FOUND|not found/i.test(`${error.code} ${error.message}`) ? translate(lang, "in.providerOff", { name }) : error.message ?? translate(lang, "in.providerFailed", { name });
}

/** The kit's one field per screen: the labelled number, and the black capsule at the bottom, riding above the keyboard. */
type Demo = { phone: string; code: string };

/** The staging demo hint: a quiet blue line that fills in the demo number or code. */
function DemoHint({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 44, justifyContent: "center", alignSelf: "center" }}>
    <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue, textAlign: "center" }}>{label}</Text>
  </Pressable>;
}

function PhoneStep({ phone, setPhone, onSent, demo }: { phone: string; setPhone: (v: string) => void; onSent: () => void; demo?: Demo }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const t = useT();
  const number = toE164(phone);
  const send = async () => {
    if (!number) return;
    setBusy(true); setError(undefined);
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: number });
    setBusy(false);
    if (error) setError(error.message ?? t("in.codeNotSent")); else onSent();
  };
  return <View style={{ flex: 1, gap: 8 }}>
    <Label>{t("in.mobile")}</Label>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={[field, { justifyContent: "center", paddingHorizontal: 14 }]}><Text style={{ fontSize: 17, fontWeight: "600", color: palette.ink }}>🇲🇾 +60</Text></View>
      <TextInput value={phone} onChangeText={setPhone} placeholder="12-345 6789" placeholderTextColor={palette.muted} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel"
        autoFocus accessibilityLabel={t("in.mobile")}onSubmitEditing={() => { void send(); }} style={[field, { flex: 1, fontSize: 17, fontVariant: ["tabular-nums"] }]} />
    </View>
    {error && <Text selectable accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    {demo && <DemoHint label={t("in.demo", { phone: `0${demo.phone.slice(3)}` })} onPress={() => setPhone(demo.phone.slice(3))} />}
    <View style={{ flex: 1, minHeight: 24 }} />
    <Button label={t("in.sendCode")} busy={busy}disabled={!number} onPress={() => { void send(); }} />
  </View>;
}

/** Six boxes over one hidden field, so iOS can fill the code from the SMS; it signs in as soon as all six are in. */
function CodeStep({ phone, onDone, onChangeNumber, demoCode }: { phone: string; onDone: () => void; onChangeNumber: () => void; demoCode?: string }) {
  const input = useRef<import("react-native").TextInput>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [wait, setWait] = useState(30);
  const t = useT();
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(id); }, [wait]);

  const verify = async (value: string) => {
    setBusy(true); setError(undefined);
    const { error } = await authClient.phoneNumber.verify({ phoneNumber: phone, code: value });
    setBusy(false);
    if (error) { setError(error.message ?? t("in.codeFailed")); setCode(""); } else onDone();
  };
  const type6 = (typed: string) => { const next = codeDigits(typed); setCode(next); if (next.length === 6) void verify(next); };
  const resend = async () => { setWait(30); setError(undefined); const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: phone }); if (error) setError(error.message); };

  return <View style={{ gap: 14 }}>
    <Pressable accessibilityLabel={t("in.codeA11y", { n: code.length })}onPress={() => input.current?.focus()} style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
      {Array.from({ length: 6 }, (_, i) => {
        const on = i === code.length && !busy;
        // The kit's field: #FAFAFA on the hairline, 16 pt corners; the box being typed into is ringed in ink.
        return <View key={i} style={{ width: 48, height: 58, borderRadius: 16, borderCurve: "continuous", alignItems: "center", justifyContent: "center",
          backgroundColor: palette.card, borderWidth: on ? 1.5 : 1, borderColor: on ? palette.ink : palette.line }}>
          <Text style={{ fontSize: 24, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{code[i] ?? ""}</Text>
        </View>;
      })}
      <TextInput ref={input} value={code} onChangeText={type6} autoFocus keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6}
        editable={!busy} accessibilityLabel={t("in.sixDigits")}style={{ position: "absolute", opacity: 0.01, width: 1, height: 1 }} />
    </Pressable>
    {demoCode && !busy && <DemoHint label={t("in.demoCode", { code: demoCode })} onPress={() => type6(demoCode)} />}
    {busy && <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>{t("in.checking")}</Text>}
    {error && <Text selectable accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red, textAlign: "center" }}>{error}</Text>}
    <View style={{ flexDirection: "row", justifyContent: "center", gap: 20 }}>
      <Pressable accessibilityRole="button" disabled={wait > 0} onPress={() => { void resend(); }} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: wait > 0 ? palette.faint : palette.blue, fontVariant: ["tabular-nums"] }}>{wait > 0 ? t("in.resendIn", { n: wait }) : t("in.resend")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onChangeNumber} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{t("in.changeNumber")}</Text>
      </Pressable>
    </View>
  </View>;
}

function EmailStep({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const t = useT();
  const ready = email.trim().includes("@") && password.length >= 8;
  const submit = async () => {
    setBusy(true); setError(undefined);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message ?? t("in.signInFailed")); else onDone();
  };
  return <View style={{ flex: 1, gap: 8 }}>
    <Label>{t("in.emailLabel")}</Label>
    <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={palette.muted} autoCapitalize="none" autoComplete="email" keyboardType="email-address" autoFocus accessibilityLabel={t("in.emailLabel")} style={field} />
    <View style={{ height: 6 }} />
    <Label>{t("in.password")}</Label>
    <TextInput value={password} onChangeText={setPassword} placeholder={t("in.passwordHint")} placeholderTextColor={palette.muted} secureTextEntry autoComplete="current-password" accessibilityLabel={t("in.password")} style={field} />
    {error && <Text selectable accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    <View style={{ flex: 1, minHeight: 24 }} />
    <Button label={t("in.signIn")}busy={busy} disabled={!ready} onPress={() => { void submit(); }} />
  </View>;
}
