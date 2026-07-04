import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassTabBar } from "@/components/consult/GlassTabBar";
import { PhoneStatusBar } from "@/components/consult/PhoneStatusBar";
import { TopBar } from "@/components/consult/TopBar";
import { colors } from "@/lib/theme";

/**
 * Shared consult-flow screen scaffold: fixed light background, the airplane
 * affordance strip, a TopBar, a scrolling body, an optional pinned footer, and
 * an optional glass tab bar. Keeps all 6 screens visually consistent.
 */
export function ConsultScreen({
  time,
  title,
  sub,
  titleColor,
  onBack,
  right,
  children,
  footer,
  scroll = true,
  tabBar,
}: {
  time?: string;
  title: string;
  sub?: string;
  titleColor?: string;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  tabBar?: { activeKey?: string; onRecord?: () => void };
}) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <PhoneStatusBar time={time} />
      <TopBar title={title} sub={sub} onBack={onBack} right={right} titleColor={titleColor} />

      {scroll ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, styles.bodyContent, styles.bodyFlex]}>{children}</View>
      )}

      {footer ? (
        <View style={[styles.footer, { paddingBottom: tabBar ? 8 : bottomPad }]}>{footer}</View>
      ) : null}

      {tabBar ? (
        <View style={[styles.tabWrap, { paddingBottom: bottomPad }]}>
          <GlassTabBar activeKey={tabBar.activeKey} onRecord={tabBar.onRecord} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 17, paddingBottom: 16, gap: 9 },
  bodyFlex: { flex: 1 },
  footer: {
    paddingHorizontal: 17,
    paddingTop: 9,
    gap: 8,
  },
  tabWrap: {
    paddingHorizontal: 10,
    paddingTop: 4,
  },
});
