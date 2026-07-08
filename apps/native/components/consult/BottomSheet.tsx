import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, font, radius, space } from "@/lib/theme";

/**
 * A calm bottom sheet (Heidi's Export & Share / Session settings pattern):
 * grabber, serif-adjacent title, backdrop fade, spring-ish slide-up. Emil:
 * enter/exit via reanimated layout animations (ease-drawer), tap-backdrop to
 * dismiss. Presented over the current screen with a transparent Modal.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={styles.backdropWrap}>
          <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
        </Animated.View>

        <Animated.View
          entering={SlideInDown.duration(320).easing(Easing.bezier(0.32, 0.72, 0, 1))}
          exiting={SlideOutDown.duration(220).easing(Easing.bezier(0.32, 0.72, 0, 1))}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
        >
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.ink3} />
            </Pressable>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.spacer} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** A tappable action row inside a sheet (leading icon + label). */
export function SheetRow({
  icon,
  label,
  onPress,
  tone = "default",
  first = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  tone?: "default" | "danger";
  first?: boolean;
}) {
  const color = tone === "danger" ? colors.red : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && styles.rowPressed]}
    >
      <Ionicons name={icon} size={20} color={tone === "danger" ? colors.red : colors.green} />
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdropWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  backdrop: { flex: 1, backgroundColor: "rgba(11,30,22,0.35)" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderCurve: "continuous",
    paddingTop: space.sm,
    paddingHorizontal: space.lg,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.lineStrong,
    marginBottom: space.md,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.sm,
  },
  title: { ...font.h3, color: colors.ink },
  spacer: { width: 22 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.lg,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  rowPressed: { opacity: 0.6 },
  rowLabel: { ...font.body, fontWeight: "500" },
});
