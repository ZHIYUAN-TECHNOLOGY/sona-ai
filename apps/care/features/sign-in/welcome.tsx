import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Text, TextInput } from "@/lib/text";
import Animated, { FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useReducedMotion, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { authClient } from "@/lib/auth-client";
import { HalftoneGlint } from "@/lib/halftone";
import { palette, type } from "@/lib/theme";
import { Button, field, pillStyle, surfaceStyle } from "@/lib/ui";
import { queryClient } from "@/utils/orpc";
import { HeroOrb } from "./hero";
import { codeDigits, toE164 } from "./phone";

/**
 * Sona Care's welcome (after the [untitled] phone sign-in shot): a hero, one line of what this is,
 * and the ways in as rows (Apple in ink, phone and Google in glass, email as a quiet link). Choosing
 * phone shrinks the hero into the header on a subtle spring while the options fade and the number
 * field rises, then a six-box code. First-time patients sign in the same way, then link their
 * record with the code on their discharge paper.
 */
type Step = "options" | "phone" | "code" | "email";
const SPRING = { duration: 450, dampingRatio: 0.86 } as const;

export function Welcome() {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("options");
  const [error, setError] = useState<string>();
  const [phone, setPhone] = useState("");
  const go = (next: Step) => { setError(undefined); setStep(next); };
  const signedIn = () => { void queryClient.refetchQueries(); };

  // The hero is the shared element: full size over the options, a small mark above the forms.
  const small = step !== "options";
  const heroStyle = useAnimatedStyle(() => {
    const to = (v: number) => reduced ? v : withSpring(v, SPRING);
    return { height: to(small ? 100 : 200), marginTop: to(small ? -8 : 28), transform: [{ scale: to(small ? 0.5 : 1) }] };
  });
  const enter = (i: number) => reduced ? FadeIn.duration(160) : FadeInDown.springify().duration(420).dampingRatio(0.9).delay(60 + i * 40);
  const leave = FadeOut.duration(120);

  return <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never"
    contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}>
    <View style={{ height: 44, justifyContent: "center" }}>
      {small && <Animated.View entering={FadeIn.duration(200)} exiting={leave}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => go(step === "code" ? "phone" : "options")}
          style={({ pressed }) => [pillStyle, { width: 44, height: 44, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
          <Glyph d="m15 18l-6-6l6-6" color={palette.ink} />
        </Pressable>
      </Animated.View>}
    </View>
    <Animated.View style={[{ alignItems: "center", justifyContent: "center" }, heroStyle]}><HeroOrb roll={step} /></Animated.View>

    {step === "options" && <Animated.View key="options" exiting={leave} style={{ flex: 1, justifyContent: "space-between", gap: 24 }}>
      <Animated.View entering={enter(0)} style={{ alignItems: "center", gap: 8, paddingTop: 12 }}>
        <Text style={{ fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2, color: palette.ink }}>Sona <Text style={{ color: palette.blue }}>Care</Text></Text>
        <Text accessibilityRole="header" lineBreakStrategyIOS="standard" style={{ ...type.display, fontWeight: "600", color: palette.ink, textAlign: "center" }}>Your care, between visits</Text>
        <Text lineBreakStrategyIOS="standard" style={{ ...type.body, color: palette.muted, textAlign: "center" }}>Check-ins, your discharge plan and your care team, from your hospital.</Text>
      </Animated.View>
      <View style={{ gap: 10 }}>
        <Animated.View entering={enter(1)}><AppleChoice onDone={signedIn} onError={setError} /></Animated.View>
        <Animated.View entering={enter(2)}><Choice icon={<Glyph d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233a14 14 0 0 0 6.392 6.384" color={palette.ink} />}
          title="Continue with phone number" line="We'll text you a 6-digit code" onPress={() => go("phone")} /></Animated.View>
        <Animated.View entering={enter(3)}><GoogleChoice onError={setError} /></Animated.View>
        {error && <Text selectable style={{ ...type.footnote, color: palette.red, textAlign: "center" }}>{error}</Text>}
        <Animated.View entering={enter(4)} style={{ alignItems: "center", gap: 2 }}>
          <Pressable accessibilityRole="button" onPress={() => go("email")} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }}>
            <Text style={{ ...type.body, fontWeight: "600", color: palette.blue }}>Use email instead</Text>
          </Pressable>
          <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>First time? After you sign in, link your record with the code on your discharge paper.</Text>
        </Animated.View>
      </View>
    </Animated.View>}

    {step === "phone" && <Animated.View key="phone" exiting={leave} style={{ gap: 14, paddingTop: 16 }}>
      <Animated.View entering={enter(0)} style={{ alignItems: "center", gap: 6 }}>
        <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>Your phone number</Text>
        <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>We'll text you a 6-digit code to sign in.</Text>
      </Animated.View>
      <Animated.View entering={enter(1)}><PhoneStep phone={phone} setPhone={setPhone} onSent={() => go("code")} /></Animated.View>
    </Animated.View>}

    {step === "code" && <Animated.View key="code" exiting={leave} style={{ gap: 14, paddingTop: 16 }}>
      <Animated.View entering={enter(0)} style={{ alignItems: "center", gap: 6 }}>
        <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>Enter the code</Text>
        <Text style={{ ...type.body, color: palette.muted, textAlign: "center" }}>Sent by SMS to {toE164(phone)}</Text>
      </Animated.View>
      <Animated.View entering={enter(1)}><CodeStep phone={toE164(phone)!} onDone={signedIn} onChangeNumber={() => go("phone")} /></Animated.View>
    </Animated.View>}

    {step === "email" && <Animated.View key="email" exiting={leave} style={{ gap: 14, paddingTop: 16 }}>
      <Animated.View entering={enter(0)} style={{ alignItems: "center", gap: 6 }}>
        <Text accessibilityRole="header" style={{ ...type.title, fontWeight: "600", color: palette.ink }}>Sign in with email</Text>
      </Animated.View>
      <Animated.View entering={enter(1)}><EmailStep onDone={signedIn} /></Animated.View>
    </Animated.View>}
  </ScrollView>;
}

/** One way in: an icon, what it is, one line of reassurance, a chevron. `ink` for the lead choice only. */
function Choice({ icon, title, line, ink, busy, onPress }: { icon: ReactNode; title: string; line: string; ink?: boolean; busy?: boolean; onPress: () => void }) {
  const fg = ink ? palette.white : palette.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${line}`} accessibilityState={{ busy }} disabled={busy} onPress={onPress}
    style={({ pressed }) => [ink ? { backgroundColor: palette.dark, borderRadius: 22, borderCurve: "continuous", overflow: "hidden" } : [surfaceStyle, { borderRadius: 22 }],
      { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18, paddingVertical: 12, opacity: busy ? 0.7 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
    {ink && <HalftoneGlint width={90} height={66} origin={[12, 2]} reach={[80, 56]} pitch={3} strength={0.6} hueShift={0.6} style={{ top: 0, left: 0 }} />}
    <View style={{ width: 24, alignItems: "center" }}>{icon}</View>
    <View style={{ flex: 1, gap: 1 }}>
      <Text style={{ ...type.headline, color: fg }}>{title}</Text>
      <Text style={{ ...type.footnote, color: ink ? "rgba(255,255,255,0.72)" : palette.muted }}>{line}</Text>
    </View>
    <Glyph d="m9 18l6-6l-6-6" color={ink ? "rgba(255,255,255,0.7)" : palette.muted} size={18} />
  </Pressable>;
}

function Glyph({ d, color, size = 22 }: { d: string; color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

const APPLE = "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04c-2.04.027-3.91 1.183-4.961 3.014c-2.117 3.675-.546 9.103 1.519 12.09c1.013 1.454 2.208 3.09 3.792 3.039c1.52-.065 2.09-.987 3.935-.987c1.831 0 2.35.987 3.96.948c1.637-.026 2.676-1.48 3.676-2.948c1.156-1.688 1.636-3.325 1.662-3.415c-.039-.013-3.182-1.221-3.22-4.857c-.026-3.04 2.48-4.494 2.597-4.559c-1.429-2.09-3.623-2.324-4.39-2.376c-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83c-1.207.052-2.662.805-3.532 1.818c-.78.896-1.454 2.338-1.273 3.714c1.338.104 2.715-.688 3.559-1.701";

/** Sign in with Apple: the native sheet, then its identity token to the server. Hidden where Apple sign-in is unavailable. */
function AppleChoice({ onDone, onError }: { onDone: () => void; onError: (m?: string) => void }) {
  // Shown on every iPhone; where the native sheet can't run (Expo Go on a simulator) the tap says so.
  const [busy, setBusy] = useState(false);
  if (process.env.EXPO_OS !== "ios") return null;
  const start = async () => {
    onError(undefined);
    if (!(await AppleAuthentication.isAvailableAsync().catch(() => false))) return onError("Sign in with Apple isn't available on this device. Use your phone number instead.");
    setBusy(true);
    try {
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL] });
      if (!credential.identityToken) throw new Error("Apple did not return a sign-in token");
      const { error } = await authClient.signIn.social({ provider: "apple", idToken: { token: credential.identityToken } });
      if (error) onError(providerError("Apple", error)); else onDone();
    } catch (e) {
      if ((e as { code?: string }).code !== "ERR_REQUEST_CANCELED") onError(e instanceof Error ? e.message : "Apple sign-in did not finish");
    }
    setBusy(false);
  };
  return <Choice ink busy={busy} icon={<Svg width={22} height={22} viewBox="0 0 24 24"><Path d={APPLE} fill={palette.white} /></Svg>}
    title="Continue with Apple" line="Fastest on iPhone" onPress={() => { void start(); }} />;
}

/** Google opens its sign-in page in the browser and comes back to the app. */
function GoogleChoice({ onError }: { onError: (m?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    onError(undefined); setBusy(true);
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
    if (error) onError(providerError("Google", error)); else void queryClient.refetchQueries();
    setBusy(false);
  };
  return <Choice busy={busy} icon={<Svg width={20} height={20} viewBox="0 0 256 262">
    <Path fill="#4285f4" d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" />
    <Path fill="#34a853" d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" />
    <Path fill="#fbbc05" d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z" />
    <Path fill="#eb4335" d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" />
  </Svg>} title="Continue with Google" line="Use your Google account" onPress={() => { void start(); }} />;
}

/** A provider the hospital has not switched on reads as that, not as a raw server error. */
function providerError(name: string, error: { code?: string; message?: string }) {
  return /PROVIDER_NOT_FOUND|not found/i.test(`${error.code} ${error.message}`) ? `${name} sign-in isn't switched on for your hospital yet. Use your phone number instead.` : error.message ?? `${name} sign-in did not finish`;
}

function PhoneStep({ phone, setPhone, onSent }: { phone: string; setPhone: (v: string) => void; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const number = toE164(phone);
  const send = async () => {
    if (!number) return;
    setBusy(true); setError(undefined);
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: number });
    setBusy(false);
    if (error) setError(error.message ?? "The code could not be sent"); else onSent();
  };
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={[field, { justifyContent: "center", paddingHorizontal: 14 }]}><Text style={{ fontSize: 17, fontWeight: "600", color: palette.ink }}>🇲🇾 +60</Text></View>
      <TextInput value={phone} onChangeText={setPhone} placeholder="12-345 6789" placeholderTextColor={palette.muted} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel"
        autoFocus accessibilityLabel="Mobile number" style={[field, { flex: 1, fontSize: 17, fontVariant: ["tabular-nums"] }]} />
    </View>
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    <Button label="Send code" busy={busy} disabled={!number} onPress={() => { void send(); }} />
  </View>;
}

/** Six boxes over one hidden field, so iOS can fill the code from the SMS; it signs in as soon as all six are in. */
function CodeStep({ phone, onDone, onChangeNumber }: { phone: string; onDone: () => void; onChangeNumber: () => void }) {
  const input = useRef<import("react-native").TextInput>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [wait, setWait] = useState(30);
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(id); }, [wait]);

  const verify = async (value: string) => {
    setBusy(true); setError(undefined);
    const { error } = await authClient.phoneNumber.verify({ phoneNumber: phone, code: value });
    setBusy(false);
    if (error) { setError(error.message ?? "That code didn't work"); setCode(""); } else onDone();
  };
  const type6 = (typed: string) => { const next = codeDigits(typed); setCode(next); if (next.length === 6) void verify(next); };
  const resend = async () => { setWait(30); setError(undefined); const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: phone }); if (error) setError(error.message); };

  return <View style={{ gap: 14 }}>
    <Pressable accessibilityLabel={`Code, ${code.length} of 6 digits`} onPress={() => input.current?.focus()} style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
      {Array.from({ length: 6 }, (_, i) => {
        const on = i === code.length && !busy;
        return <View key={i} style={[surfaceStyle, { width: 48, height: 58, borderRadius: 16, alignItems: "center", justifyContent: "center", borderColor: on ? palette.blue : "rgba(255,255,255,0.9)", borderWidth: on ? 1.5 : 1 }]}>
          <Text style={{ fontSize: 24, fontWeight: "600", color: palette.ink, fontVariant: ["tabular-nums"] }}>{code[i] ?? ""}</Text>
        </View>;
      })}
      <TextInput ref={input} value={code} onChangeText={type6} autoFocus keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6}
        editable={!busy} accessibilityLabel="Six-digit code" style={{ position: "absolute", opacity: 0.01, width: 1, height: 1 }} />
    </Pressable>
    {busy && <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>Checking…</Text>}
    {error && <Text selectable style={{ ...type.footnote, color: palette.red, textAlign: "center" }}>{error}</Text>}
    <View style={{ flexDirection: "row", justifyContent: "center", gap: 20 }}>
      <Pressable accessibilityRole="button" disabled={wait > 0} onPress={() => { void resend(); }} style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: wait > 0 ? palette.muted : palette.blue, fontVariant: ["tabular-nums"] }}>{wait > 0 ? `Resend in ${wait} s` : "Resend code"}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onChangeNumber} style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Change number</Text>
      </Pressable>
    </View>
  </View>;
}

function EmailStep({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = email.trim().includes("@") && password.length >= 8;
  const submit = async () => {
    setBusy(true); setError(undefined);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message ?? "Could not sign in"); else onDone();
  };
  return <View style={{ gap: 10 }}>
    <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={palette.muted} autoCapitalize="none" autoComplete="email" keyboardType="email-address" autoFocus style={field} />
    <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={palette.muted} secureTextEntry autoComplete="current-password" style={field} />
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    <Button label="Sign in" busy={busy} disabled={!ready} onPress={() => { void submit(); }} />
  </View>;
}
