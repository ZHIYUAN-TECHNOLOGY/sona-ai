import { useState } from "react";
import { Text, TextInput } from "react-native";
import { authClient } from "@/lib/auth-client";
import { palette, type } from "@/lib/theme";
import { Button, Card, field } from "@/lib/ui";
import { queryClient } from "@/utils/orpc";

/** Sign in to an existing Sona Care account; new accounts are created by joining with a discharge code. */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = email.trim().includes("@") && password.length >= 8;

  const submit = async () => {
    setBusy(true); setError(undefined);
    await authClient.signIn.email({ email: email.trim(), password }, {
      onError: e => setError(e.error?.message ?? "Could not sign in"),
      onSuccess: () => { void queryClient.refetchQueries(); },
    });
    setBusy(false);
  };

  return <Card>
    <Text style={{ ...type.headline, color: palette.ink }}>Already joined? Sign in</Text>
    <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={palette.muted} autoCapitalize="none" autoComplete="email" keyboardType="email-address" style={field} />
    <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={palette.muted} secureTextEntry autoComplete="current-password" style={field} />
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
    <Button label="Sign in" quiet busy={busy} disabled={!ready} onPress={() => { void submit(); }} />
  </Card>;
}
