import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "@/components/consult/BottomSheet";
import { TEMPLATES } from "@/lib/pipeline/templates";
import { colors, font, radius, space } from "@/lib/theme";

/** The "Choose template" bottom sheet — Heidi's pattern, our clinical set. */
export function ChooseTemplateSheet({
  visible,
  onClose,
  selectedId,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Choose template">
      <View style={styles.list}>
        {TEMPLATES.map((t) => {
          const active = t.id === selectedId;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                onSelect(t.id);
                onClose();
              }}
              style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}
            >
              <View style={[styles.iconWrap, active && styles.iconActive]}>
                <Ionicons name={t.icon} size={19} color={active ? colors.white : colors.green} />
              </View>
              <View style={styles.tt}>
                <Text style={styles.name}>{t.name}</Text>
                <Text style={styles.desc}>{t.description}</Text>
              </View>
              {active ? <Ionicons name="checkmark-circle" size={22} color={colors.green} /> : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderCurve: "continuous",
  },
  rowActive: { backgroundColor: colors.greenSoft },
  pressed: { opacity: 0.6 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconActive: { backgroundColor: colors.green },
  tt: { flex: 1, minWidth: 0 },
  name: { ...font.body, fontWeight: "600", color: colors.ink },
  desc: { ...font.bodySm, color: colors.ink3, marginTop: 1 },
});
