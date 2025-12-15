import React, { useMemo } from "react";
import { View, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { MainStackParamList } from "../../types/navigation";

type Props = NativeStackScreenProps<
  MainStackParamList,
  "MoneyManagementModule"
>;

type TabKey = "home" | "list" | "budget" | "insights" | "chart";

export default function MoneyManagementModule({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const [activeTab] = React.useState<TabKey>("home");
  const styles = useMemo(() => makeStyles(!!isDarkmode), [isDarkmode]);

  const iconColor = (active: boolean) => {
    if (active) return "#38BDF8";
    return isDarkmode ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.6)";
  };

  const labelStyle = (tab: TabKey) =>
    StyleSheet.flatten([
      styles.navLabel,
      { color: iconColor(activeTab === tab) },
    ]);

  const go = (tab: TabKey) => {
    if (tab === "home") return;
    if (tab === "list") return navigation.navigate("TransactionList");
    if (tab === "budget") return navigation.navigate("BudgetHub");
    if (tab === "insights") return navigation.navigate("SpendingInsights");
    if (tab === "chart") return navigation.navigate("ExpensesChart");
  };

  return (
    <Layout>
      <TopNav
        middleContent={<Text>Money Management Module</Text>}
        leftContent={
          <Ionicons
            name="chevron-back"
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        leftAction={() => navigation.goBack()}
        rightContent={
          <Ionicons
            name={isDarkmode ? "sunny" : "moon"}
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />

      <View style={styles.container}>
        <Text fontWeight="bold" size="h3" style={{ marginBottom: 10 }}>
          FinTrack Pro
        </Text>
        <Text style={styles.subtitle}>
          Manage your income, expenses and budgets in one place.
        </Text>
      </View>

      <View style={styles.bottomWrap} pointerEvents="box-none">
        <View style={styles.bottomBar}>
          {/* Home */}
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => go("home")}
            activeOpacity={0.85}
          >
            <Ionicons
              name="home-outline"
              size={22}
              color={iconColor(activeTab === "home")}
            />
            <Text style={labelStyle("home")}>Home</Text>
          </TouchableOpacity>

          {/* List */}
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => go("list")}
            activeOpacity={0.85}
          >
            <Ionicons
              name="list-outline"
              size={22}
              color={iconColor(activeTab === "list")}
            />
            <Text style={labelStyle("list")}>List</Text>
          </TouchableOpacity>

          <View style={{ width: 72 }} />

          {/* Budget (with AI pill) */}
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => go("budget")}
            activeOpacity={0.85}
          >
            <View style={{ position: "relative", alignItems: "center" }}>
              <Ionicons
                name="wallet-outline"
                size={22}
                color={iconColor(activeTab === "budget")}
              />

              {/* AI Pill */}
              <View style={styles.budgetAiPill}>
                <Ionicons
                  name="sparkles-outline"
                  size={10}
                  color="#fff"
                  style={{ marginRight: 2 }}
                />
                <Text style={styles.budgetAiText}>AI</Text>
              </View>
            </View>

            <Text style={labelStyle("budget")}>Budget</Text>
          </TouchableOpacity>

          {/* Chart */}
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => go("chart")}
            activeOpacity={0.85}
          >
            <Ionicons
              name="stats-chart-outline"
              size={22}
              color={iconColor(activeTab === "chart")}
            />
            <Text style={labelStyle("chart")}>Chart</Text>
          </TouchableOpacity>
        </View>

        {/* FAB */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => navigation.navigate("TransactionAdd")}
          style={styles.fab}
        >
          <Ionicons name="add" size={32} color="#fff" />
        </TouchableOpacity>

        {/* Global AI Shortcut */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => navigation.navigate("SpendingInsights")}
          style={styles.aiPill}
        >
          <Ionicons
            name="sparkles-outline"
            size={16}
            color="#fff"
            style={{ marginRight: 6 }}
          />
          <Text style={styles.aiText}>AI</Text>
        </TouchableOpacity>
      </View>
    </Layout>
  );
}

const makeStyles = (isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
      paddingBottom: 120,
    },
    subtitle: {
      textAlign: "center",
      marginBottom: 20,
      opacity: isDark ? 0.85 : 0.8,
    },

    bottomWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: Platform.OS === "ios" ? 22 : 14,
      alignItems: "center",
    },

    bottomBar: {
      width: "92%",
      height: 66,
      borderRadius: 33,
      backgroundColor: isDark ? "#111827" : "#EEF2FF",
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 18,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 10,
    },

    navItem: {
      width: 58,
      alignItems: "center",
      justifyContent: "center",
    },
    navLabel: {
      marginTop: 3,
      fontSize: 11,
      fontWeight: "600",
    },

    fab: {
      position: "absolute",
      top: -28,
      width: 66,
      height: 66,
      borderRadius: 33,
      backgroundColor: "#2563EB",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 3,
      borderColor: isDark ? "#0B1220" : "#EEF2FF",
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 14,
    },

    aiPill: {
      position: "absolute",
      right: 16,
      top: -12,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "#7C3AED",
    },
    aiText: {
      color: "#fff",
      fontWeight: "800",
      fontSize: 12,
    },

    /* Budget AI pill */
    budgetAiPill: {
      position: "absolute",
      top: -16,
      right: -24,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: "#7C3AED",
    },
    budgetAiText: {
      color: "#fff",
      fontSize: 9,
      fontWeight: "800",
    },
  });
