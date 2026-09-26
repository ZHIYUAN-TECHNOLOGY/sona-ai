import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { authClient } from "@/lib/auth-client";
import { palette, type } from "@/lib/theme";
import { queryClient } from "@/utils/orpc";

const field = { minHeight: 48, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: palette.ink, backgroundColor: "rgba(20,28,40,0.05)" } as const;

/** Email sign-in and sign-up in one card (Better Auth on the shared server). */
export function SignIn() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = email.trim().includes("@") && password.length >= 8 && (mode === "in" || name.trim().length > 0);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(undefined);
    const done = { onError: (e: { error?: { message?: string } }) => setError(e.error?.message ?? "Something went wrong"), onSuccess: () => { void queryClient.refetchQueries(); } };
    if (mode === "in") await authClient.signIn.email({ email: email.trim(), password }, done);
    else await authClient.signUp.email({ name: name.trim(), email: email.trim(), password }, done);
    setBusy(false);
  };

  return <View style={{ gap: 12, padding: 18, borderRadius: 22, borderCurve: "continuous", backgroundColor: palette.surface }}>
    <Text style={{ ...type.headline, color: palette.ink }}>{mode === "in" ? "Sign in" : "Create your account"}</Text>
    {mode === "up" && <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={palette.muted} autoComplete="name" style={field} />}
    <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={palette.muted} autoCapitalize="none" autoComplete="email" keyboardType="email-address" style={field} />
    <TextInput value={password} onChangeText={setPassword} placeholder="Password (8 characters or more)" placeholderTextColor={palette.muted} secureTextEntry autoComplete={mode === "in" ? "current-password" : "new-password"} style={field} />
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready || busy }} disabled={!ready || busy} onPress={() => { void submit(); }}
      style={({ pressed }) => ({ minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.dark, opacity: !ready ? 0.45 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      {busy ? <ActivityIndicator color={palette.white} /> : <Text style={{ fontSize: 16, fontWeight: "600", color: palette.white }}>{mode === "in" ? "Sign in" : "Create account"}</Text>}
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => { setMode(m => (m === "in" ? "up" : "in")); setError(undefined); }} style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>{mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}</Text>
    </Pressable>
  </View>;
}
