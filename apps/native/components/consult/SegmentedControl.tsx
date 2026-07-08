import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, radius, space } from "@/lib/theme";

/**
 * A compact two/three-segment pill toggle (Heidi's Transcribe / Dictate control).
 * Controlled — pass `value` + `onChange`.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange?: (key: T) => void;
}) {
  return (
    <View style={styles.track}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            activeOpacity={0.8}
            onPress={() => onChange?.(o.key)}
            style={[styles.seg, active && styles.segActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
    alignSelf: "center",
  },
  seg: {
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderCurve: "continuous",
  },
  segActive: { backgroundColor: colors.card, boxShadow: "0px 1px 2px rgba(11,30,22,0.08)" },
  label: { fontSize: 13.5, fontWeight: "600", color: colors.ink3 },
  labelActive: { color: colors.green },
});
