import { useState } from "react";
import { TextInput, View } from "react-native";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action } from "@/components/sona/ui";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

/**
 * Sign in to the hospital record: email and password, one action, and the server's reason if it refuses.
 * Shared by Settings and the judge build's gate (./judge-gate), so there is one way in.
 */
/** better-auth signs in by email, so a demo username typed bare (`doctor`) becomes its account's address. */
const demoEmail = (input: string) => { const v = input.trim(); return v.includes("@") ? v : `${v}@sona.test`; };

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = email.trim().length > 0 && password.length > 0 && !busy;
  const submit = () => {
    if (!ready) return;
    setBusy(true); setError(undefined);
    void authClient.signIn.email({ email: demoEmail(email), password }, {
      onError: e => { setError(e.error?.message || "Couldn’t sign in. Check the email and password."); setBusy(false); },
      onSuccess: () => { setPassword(""); setBusy(false); void queryClient.refetchQueries(); },
    });
  };
  const field = { minHeight: 48, borderRadius: radius.control, paddingHorizontal: 14, backgroundColor: palette.surface, ...type.body, lineHeight: undefined, color: palette.ink } as const;
  return <View style={{ gap: 10 }}>
    <TextInput accessibilityLabel="Username or email" placeholder="doctor" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" placeholderTextColor={palette.placeholder} style={field} />
    <TextInput accessibilityLabel="Password" placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} placeholderTextColor={palette.placeholder} style={field} />
    {error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    <Action label={busy ? "Signing in…" : "Sign in"} disabled={!ready} onPress={submit} />
  </View>;
}

/** The judge build's line over the form, in Settings and on the gate: no promise of sample data. */
export const SIGN_IN_PROMPT = "Sign in to use your hospital's records.";

/** Signs out, then re-runs the open queries without the session. */
export const signOut = () => { void authClient.signOut().then(() => queryClient.refetchQueries()); };
