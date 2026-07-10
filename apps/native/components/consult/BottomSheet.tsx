import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassSurface } from "@/components/consult/GlassSurface";
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
  const ty = useSharedValue(0);

  // Drag the sheet down to dismiss: translateY follows the finger (clamped so it
  // can't be dragged up), release past ~120px or with a flick closes it, else it
  // springs back. Runs on the UI thread via gesture-handler + reanimated.
  const pan = Gesture.Pan()
    .onChange((e) => {
      ty.value = Math.max(0, ty.value + e.changeY);
    })
    .onEnd((e) => {
      if (ty.value > 120 || e.velocityY > 800) {
        runOnJS(onClose)();
      } else {
        ty.value = withSpring(0, { damping: 20, stiffness: 240 });
      }
    });

  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={styles.backdropWrap}>
          <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View
            entering={SlideInDown.duration(320).easing(Easing.bezier(0.32, 0.72, 0, 1))}
            exiting={SlideOutDown.duration(220).easing(Easing.bezier(0.32, 0.72, 0, 1))}
            style={[styles.sheetWrap, dragStyle]}
          >
            {/* Translucent glass surface (liquid glass → blur → solid fallback). The
                transform/layout animation stays on the wrapper; the glass is static. */}
            <GlassSurface style={styles.sheet}>
              <View style={[styles.sheetInner, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
                <View style={styles.grabber} />
                <View style={styles.head}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}>
                    <Ionicons name="close" size={22} color={colors.ink3} />
                  </Pressable>
                  <Text style={styles.title}>{title}</Text>
                  <View style={styles.spacer} />
                </View>
                {children}
              </View>
            </GlassSurface>
          </Animated.View>
        </GestureDetector>
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
  // Wrapper owns the drag transform + slide animation and clips the glass to the
  // sheet's rounded top corners (overflow:hidden). No background — the glass is the fill.
  sheetWrap: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  sheet: { width: "100%" },
  sheetInner: { paddingTop: space.sm, paddingHorizontal: space.lg },
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
