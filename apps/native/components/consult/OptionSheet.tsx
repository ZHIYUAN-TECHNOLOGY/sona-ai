import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "@/components/consult/BottomSheet";
import { colors, font, radius, space } from "@/lib/theme";

/** One selectable option in an OptionSheet. */
export interface SheetOption<T extends string> {
  key: T;
  name: string;
  desc?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

/**
 * A single-select bottom sheet (same visual language as ChooseTemplateSheet): a titled sheet
 * of option rows, the current one marked with a green pill icon + checkmark. Generic over the
 * option key so any enum setting (accuracy tier, language, …) reuses it. Selecting closes it.
 */
export function OptionSheet<T extends string>({
  visible,
  onClose,
  title,
  options,
  selectedKey,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: SheetOption<T>[];
  selectedKey: T;
  onSelect: (key: T) => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.list}>
        {options.map((o) => {
          const active = o.key === selectedKey;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                onSelect(o.key);
                onClose();
              }}
              style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}
            >
              <View style={[styles.iconWrap, active && styles.iconActive]}>
                <Ionicons name={o.icon ?? "ellipse-outline"} size={19} color={active ? colors.white : colors.green} />
              </View>
              <View style={styles.tt}>
                <Text style={styles.name}>{o.name}</Text>
                {o.desc ? <Text style={styles.desc}>{o.desc}</Text> : null}
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
