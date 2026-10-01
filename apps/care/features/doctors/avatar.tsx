import { Image } from "expo-image";
import { View, type ViewStyle } from "react-native";
import { Text } from "@/lib/text";
import { palette } from "@/lib/theme";
import { DOCTORS, initials, type Doctor } from "./data";

/** Soft washes (ice blue, lilac, sky), one per doctor in turn, so neighbours in the grid differ. */
const WASH = [["#EBF1FF", "#C9D5FF"], ["#F2ECFF", "#D8CBFF"], ["#E6F4FF", "#BFDDF7"]] as const;

/**
 * Each SYNTHETIC doctor's drawn portrait (never a photo of a real person): Notionists by Zoish via DiceBear, CC0 1.0
 * (assets/images/doctors/LICENSE.md). A doctor without one keeps their initials.
 */
const FACES: Record<string, number> = {
  lim: require("@/assets/images/doctors/lim.png"),
  aisyah: require("@/assets/images/doctors/aisyah.png"),
  priya: require("@/assets/images/doctors/priya.png"),
  tan: require("@/assets/images/doctors/tan.png"),
  arjun: require("@/assets/images/doctors/arjun.png"),
  farah: require("@/assets/images/doctors/farah.png"),
};

/** A doctor's face: their portrait (or initials) on a soft gradient disc with a white rim. Decorative; the card or header around it carries the name for VoiceOver. */
export function DoctorAvatar({ doctor, size = 48 }: { doctor: Pick<Doctor, "id" | "name">; size?: number }) {
  const [from, to] = WASH[Math.max(0, DOCTORS.findIndex(d => d.id === doctor.id)) % WASH.length]!;
  const face = FACES[doctor.id];
  return <View accessible={false} importantForAccessibility="no-hide-descendants"
    style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: Math.max(2, size / 28), borderColor: palette.white,
      experimental_backgroundImage: `linear-gradient(145deg, ${from}, ${to})`, boxShadow: "0 8px 18px -10px rgba(51,92,255,0.45)" } as ViewStyle}>
    {face ? <Image source={face} contentFit="cover" style={{ width: size * 0.98, height: size * 0.98, marginTop: size * 0.16 }} />
      : <Text allowFontScaling={false} style={{ fontSize: size * 0.34, fontWeight: "500", letterSpacing: -0.5, color: palette.blue }}>{initials(doctor.name)}</Text>}
  </View>;
}
