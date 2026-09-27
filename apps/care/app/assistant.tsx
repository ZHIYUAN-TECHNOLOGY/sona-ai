import { Text, View } from "react-native";
import { palette, type } from "@/lib/theme";

/** Ask Sona Care (placeholder until the assistant sheet lands). */
export default function Assistant() {
  return <View style={{ padding: 24 }}><Text style={{ ...type.title, color: palette.ink }}>How can I help?</Text></View>;
}
