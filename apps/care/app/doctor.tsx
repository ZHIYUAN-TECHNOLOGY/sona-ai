import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { doctorById } from "@/features/doctors/data";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";

/** Doctor details (placeholder until the doctors agent lands). */
export default function Doctor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <View style={{ padding: 24, paddingTop: 80 }}><Text style={{ ...type.title, color: palette.ink }}>{doctorById(id)?.name ?? "Doctor"}</Text></View>;
}
