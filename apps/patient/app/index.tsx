import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SignIn } from "@/components/sign-in";
import { authClient } from "@/lib/auth-client";
import { palette, type } from "@/lib/theme";
import { orpc } from "@/utils/orpc";

/** Home: signed out, the sign-in card; signed in, the patient's space (features land here). */
export default function Home() {
  const { data: session } = authClient.useSession();
  const health = useQuery(orpc.healthCheck.queryOptions());
  const online = health.data === "OK";
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 72, gap: 20 }}>
    <View style={{ gap: 6 }}>
      <Text style={{ ...type.overline, color: palette.blue }}>Sona · for patients</Text>
      <Text accessibilityRole="header" style={{ ...type.display, fontWeight: "600", color: palette.ink }}>{session?.user ? `Hi, ${session.user.name.split(" ")[0]}` : "Your care, between visits"}</Text>
      <Text style={{ ...type.footnote, color: online ? palette.green : palette.muted }}>{health.isLoading ? "Connecting…" : online ? "Connected to your hospital" : "Offline · check your connection"}</Text>
    </View>
    {session?.user
      ? <View style={{ gap: 12, padding: 18, borderRadius: 22, borderCurve: "continuous", backgroundColor: palette.surface }}>
        <Text style={{ ...type.headline, color: palette.ink }}>Nothing from your care team yet</Text>
        <Text style={{ ...type.body, color: palette.muted }}>Check-ins after a hospital stay and messages from your doctor will appear here.</Text>
        <Pressable accessibilityRole="button" onPress={() => { void authClient.signOut(); }} style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}>
          <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Sign out</Text>
        </Pressable>
      </View>
      : <SignIn />}
  </ScrollView>;
}
