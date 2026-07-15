import { Pressable, StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/haptics";
import { colors, radius, space } from "@/lib/theme";

/**
 * A compact two/three-segment pill toggle (Heidi's Transcribe / Dictate control).
 * Controlled — pass `value` + `onChange`. Fires its own selection haptic, so
 * call sites must not add another.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  stretch,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange?: (key: T) => void;
  /** Fill the parent width, segments sharing it equally (default hugs content). */
  stretch?: boolean;
}) {
  return (
    <View style={[styles.track, stretch && styles.trackStretch]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (o.key === value) return; // re-tapping the active segment is a no-op
              haptic("select");
              onChange?.(o.key);
            }}
            style={({ pressed }) => [
              styles.seg,
              stretch && styles.segStretch,
              active && styles.segActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{o.label}</Text>
          </Pressable>
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
  trackStretch: { alignSelf: "stretch" },
  segStretch: { flex: 1, alignItems: "center", paddingHorizontal: 0 },
  segActive: { backgroundColor: colors.card, boxShadow: "0px 1px 2px rgba(11,30,22,0.08)" },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.85 },
  label: { fontSize: 13.5, fontWeight: "600", color: colors.ink3 },
  labelActive: { color: colors.green },
});
