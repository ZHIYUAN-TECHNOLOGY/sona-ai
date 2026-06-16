import { Column, Host, Text as ExpoUIText } from "@expo/ui";
import { useQuery } from "@tanstack/react-query";
import { View, ScrollView, StyleSheet } from "react-native";

import { Container } from "@/components/container";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/use-color-scheme";
import { orpc } from "@/utils/orpc";

export default function Home() {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const healthCheck = useQuery(orpc.healthCheck.queryOptions());

  return (
    <Container>
      <ScrollView style={styles.scrollView} contentInsetAdjustmentBehavior="never">
        <View style={styles.content}>
          <Host style={styles.titleHost}>
            <ExpoUIText
              textStyle={{
                color: theme.text,
                fontSize: 24,
                fontWeight: "bold",
                textAlign: "center",
              }}
            >
              BETTER T STACK
            </ExpoUIText>
          </Host>

          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusIndicator,
                  { backgroundColor: healthCheck.data ? "#10b981" : "#f59e0b" },
                ]}
              />
              <View style={styles.statusContent}>
                <Host matchContents={{ vertical: true }}>
                  <Column spacing={4}>
                    <ExpoUIText textStyle={{ color: theme.text, fontSize: 14, fontWeight: "bold" }}>
                      ORPC
                    </ExpoUIText>
                    <ExpoUIText
                      textStyle={{ color: theme.text, fontSize: 12 }}
                      style={{ opacity: 0.7 }}
                    >
                      {healthCheck.isLoading
                        ? "Checking connection..."
                        : healthCheck.data
                          ? "All systems operational"
                          : "Service unavailable"}
                    </ExpoUIText>
                  </Column>
                </Host>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </Container>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 32,
  },
  titleHost: {
    alignSelf: "stretch",
    height: 34,
    marginBottom: 24,
  },
  card: {
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusIndicator: {
    height: 10,
    width: 10,
    borderRadius: 999,
  },
  statusContent: {
    flex: 1,
  },
  userCard: {
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
    borderRadius: 16,
  },
  userHeader: {
    marginBottom: 8,
  },
  paymentActions: {
    marginTop: 12,
  },
  authHost: {
    marginBottom: 12,
  },
  authActionsHost: {
    marginTop: 4,
  },
  statusCard: {
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
    borderRadius: 16,
  },
  statusCardTitleHost: {
    marginBottom: 8,
  },
});
