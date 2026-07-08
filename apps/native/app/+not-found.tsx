import { Stack, router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { colors, font } from "@/lib/theme";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 44 }}>🤔</Text>
        <Text style={[font.h2, { color: colors.ink, textAlign: "center" }]}>Page not found</Text>
        <Text style={[font.body, { color: colors.ink3, textAlign: "center" }]}>
          That screen doesn&apos;t exist.
        </Text>
        <Pressable
          onPress={() => router.replace("/")}
          style={{
            marginTop: 8,
            backgroundColor: colors.green,
            paddingVertical: 13,
            paddingHorizontal: 22,
            borderRadius: 16,
            borderCurve: "continuous",
          }}
        >
          <Text style={{ color: colors.white, fontSize: 15, fontWeight: "600" }}>Go home</Text>
        </Pressable>
      </View>
    </>
  );
}
