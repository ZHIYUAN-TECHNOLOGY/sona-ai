import { View } from "react-native";
import { Text } from "@/lib/text";
import { palette, type } from "@/lib/theme";

/** All doctors (placeholder until the doctors agent lands). */
export default function Doctors() {
  return <View style={{ padding: 24, paddingTop: 80 }}><Text style={{ ...type.title, color: palette.ink }}>All Doctors</Text></View>;
}
