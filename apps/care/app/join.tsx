import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { errorText } from "@/features/errors";
import { authClient } from "@/lib/auth-client";
import { palette, type } from "@/lib/theme";
import { Button, Card, field, Title } from "@/lib/ui";
import { client, queryClient } from "@/utils/orpc";

/**
 * Joining from the discharge paper: scan the QR (or type its code), confirm it is for you, create an
 * account (or use the one you are signed in with), and the code links it to your record.
 * The QR holds sona-care://join?code=…, so the phone's camera can also open this screen directly.
 */
const codeFrom = (text: string) => text.match(/code=([A-Za-z0-9-]+)/)?.[1] ?? text;

export default function Join() {
  const params = useLocalSearchParams<{ code?: string }>();
  const { data: session } = authClient.useSession();
  const [code, setCode] = useState(params.code ?? "");
  const [who, setWho] = useState<{ firstName: string; hospital: string }>();
  const [scanning, setScanning] = useState(false);
  const [permission, askPermission] = useCameraPermissions();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const check = async (value = code) => {
    setBusy(true); setError(undefined);
    try { setWho(await client.care.preview({ code: value })); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  // A code from the QR's link is checked straight away.
  useEffect(() => { if (params.code) void check(params.code); }, [params.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = async () => {
    setBusy(true); setError(undefined);
    try {
      if (!session?.user) {
        const signedUp = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
        if (signedUp.error) throw new Error(signedUp.error.message ?? "Could not create the account");
      }
      await client.care.join({ code });
      await queryClient.refetchQueries();
      router.replace("/");
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  const accountReady = Boolean(session?.user) || (name.trim().length > 1 && email.trim().includes("@") && password.length >= 8);

  return <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 32, gap: 20 }} keyboardShouldPersistTaps="handled">
    <Title overline="Sona Care">{who ? `Hi ${who.firstName}` : "Join with your discharge code"}</Title>
    {!who && <Card>
      {scanning && permission?.granted
        ? <View style={{ height: 260, borderRadius: 16, overflow: "hidden" }}>
          <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={e => { setScanning(false); const c = codeFrom(e.data); setCode(c); void check(c); }} />
        </View>
        : <Button label="Scan the QR code" quiet onPress={() => { void (permission?.granted ? Promise.resolve() : askPermission()).then(() => setScanning(true)); }} />}
      <Text style={{ ...type.footnote, color: palette.muted, textAlign: "center" }}>or type the code under it</Text>
      <TextInput key="code" value={code} onChangeText={setCode} placeholder="ABCD-2345" placeholderTextColor={palette.muted} autoCapitalize="characters" autoCorrect={false} style={{ ...field, fontSize: 20, letterSpacing: 2, textAlign: "center" }} />
      <Button label="Continue" busy={busy} disabled={code.replace(/[^A-Za-z0-9]/g, "").length < 8} onPress={() => { void check(); }} />
    </Card>}
    {who && <Card>
      <Text style={{ ...type.body, color: palette.ink }}>This code is for <Text style={{ fontWeight: "700" }}>{who.firstName}</Text> at {who.hospital}.</Text>
      {session?.user
        ? <Text style={{ ...type.footnote, color: palette.muted }}>It will be linked to {session.user.email}.</Text>
        : <>
          <TextInput key="name" value={name} onChangeText={setName} placeholder="Your full name" placeholderTextColor={palette.muted} autoComplete="name" style={field} />
          <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={palette.muted} autoCapitalize="none" autoComplete="email" keyboardType="email-address" style={field} />
          <TextInput value={password} onChangeText={setPassword} placeholder="Password (8 characters or more)" placeholderTextColor={palette.muted} secureTextEntry autoComplete="new-password" style={field} />
        </>}
      <Button label={session?.user ? "Link my record" : "Create account and link"} busy={busy} disabled={!accountReady} onPress={() => { void join(); }} />
      <Button label="Not me" quiet onPress={() => { setWho(undefined); setCode(""); }} />
    </Card>}
    {error && <Text selectable style={{ ...type.footnote, color: palette.red }}>{error}</Text>}
  </ScrollView>;
}
