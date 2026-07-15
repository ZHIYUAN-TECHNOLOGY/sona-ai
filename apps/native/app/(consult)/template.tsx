import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";

import { ConsultScreen } from "@/components/consult/ConsultScreen";
import { useConsultPipeline } from "@/lib/pipeline/PipelineProvider";
import { TEMPLATES } from "@/lib/pipeline/templates";
import { colors, font, radius, space } from "@/lib/theme";

// Full-screen note-template picker. Pushed from the New-consult screen (was a
// bottom sheet). Standard app header + iOS back chevron; tapping a template sets
// it and returns. Purely a UI preference — no PHI involved.
export default function TemplateScreen() {
  const { templateId, setTemplate } = useConsultPipeline();
  const reduce = useReducedMotion();

  const choose = (id: string) => {
    setTemplate(id);
    router.back();
  };

  return (
    <ConsultScreen
      time="9:41"
      title="Note template"
      sub="How Aurio structures the note"
      onBack={() => router.back()}
    >
      <View style={styles.list}>
        {TEMPLATES.map((t, i) => {
          const active = t.id === templateId;
          return (
            <Animated.View
              key={t.id}
              entering={reduce ? FadeIn.duration(200) : FadeInDown.delay(i * 45).duration(280)}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => choose(t.id)}
                style={({ pressed }) => [
                  styles.row,
                  active && styles.rowActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.iconWrap, active && styles.iconActive]}>
                  <Ionicons name={t.icon} size={20} color={active ? colors.white : colors.green} />
                </View>
                <View style={styles.tt}>
                  <Text style={styles.name}>{t.name}</Text>
                  <Text style={styles.desc}>{t.description}</Text>
                </View>
                {active ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.green} />
                ) : (
                  <View style={styles.dot} />
                )}
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </ConsultScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowActive: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconActive: { backgroundColor: colors.green },
  tt: { flex: 1, minWidth: 0 },
  name: { ...font.body, fontWeight: "600", color: colors.ink },
  desc: { ...font.bodySm, color: colors.ink3, marginTop: 1 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
});
