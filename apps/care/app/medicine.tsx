import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { palette, type } from "@/lib/theme";

/** One medicine as a sheet (placeholder until the medicines agent lands). */
export default function Medicine() {
  const { name } = useLocalSearchParams<{ name: string }>();
  return <View style={{ padding: 24 }}><Text style={{ ...type.title, color: palette.ink }}>{name}</Text></View>;
}
