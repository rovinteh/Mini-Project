import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
  Pressable,
} from "react-native";
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

// ✅ ADD: currency store
import {
  CURRENCY_OPTIONS,
  CurrencyCode,
  codeToLabel,
  getCurrencyCode,
  setCurrencyCode,
} from "../../utils/currencyStore";

type Props = NativeStackScreenProps<
  MainStackParamList,
  "MoneyManagementModule"
>;

type TabKey = "home" | "list" | "budget" | "insights" | "chart";

export default function MoneyManagementModule({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const styles = useMemo(() => makeStyles(!!isDarkmode), [isDarkmode]);

  // ✅ ADD: currency state
  const [currency, setCurrency] = useState<CurrencyCode>("MYR");
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);

  // ✅ ADD: load saved currency on mount
  useEffect(() => {
    (async () => {
      const saved = await getCurrencyCode();
      setCurrency(saved);
    })();
  }, []);

  const iconColor = (active: boolean) => {
    if (active) return "#38BDF8";
    return isDarkmode ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.6)";
  };

  const go = (tab: TabKey) => {
    if (tab === "home") return;
    if (tab === "list") return navigation.navigate("TransactionList");
    if (tab === "budget") return navigation.navigate("BudgetHub");
    if (tab === "insights") return navigation.navigate("SpendingInsights");
    if (tab === "chart") return navigation.navigate("ExpensesChart");
  };

  const activeTab: TabKey = "home";

  const pickCurrency = async (code: CurrencyCode) => {
    setCurrency(code);
    await setCurrencyCode(code);
    setShowCurrencyModal(false);
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

        {/* ✅ ADD: currency selector button */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setShowCurrencyModal(true)}
          style={styles.currencyBtn}
        >
          <Ionicons
            name="cash-outline"
            size={16}
            color={isDarkmode ? "#fff" : "#111"}
            style={{ marginRight: 8 }}
          />
          <Text style={styles.currencyBtnText}>
            Currency: {codeToLabel(currency)}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.bottomWrap} pointerEvents="box-none">
        <View style={styles.bottomBar}>
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
            <Text
              style={[
                styles.navLabel,
                { color: iconColor(activeTab === "home") },
              ]}
            >
              Home
            </Text>
          </TouchableOpacity>

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
            <Text
              style={[
                styles.navLabel,
                { color: iconColor(activeTab === "list") },
              ]}
            >
              List
            </Text>
          </TouchableOpacity>

          <View style={{ width: 72 }} />

          <TouchableOpacity
            style={styles.navItem}
            onPress={() => go("budget")}
            activeOpacity={0.85}
          >
            <Ionicons
              name="wallet-outline"
              size={22}
              color={iconColor(activeTab === "budget")}
            />
            <Text
              style={[
                styles.navLabel,
                { color: iconColor(activeTab === "budget") },
              ]}
            >
              Budget
            </Text>
          </TouchableOpacity>

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
            <Text
              style={[
                styles.navLabel,
                { color: iconColor(activeTab === "chart") },
              ]}
            >
              Chart
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => navigation.navigate("TransactionAdd")}
          style={styles.fab}
        >
          <Ionicons name="add" size={32} color="#fff" />
        </TouchableOpacity>

        {/* ✅ REMOVE this if you don’t want “Add” text under the button */}
        <Text style={styles.fabLabel}>Add</Text>

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

      {/* ✅ ADD: Currency modal */}
      <Modal
        visible={showCurrencyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCurrencyModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowCurrencyModal(false)}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text fontWeight="bold" style={{ fontSize: 16, marginBottom: 10 }}>
              Select Currency
            </Text>

            {CURRENCY_OPTIONS.map((c) => {
              const active = c.code === currency;
              return (
                <TouchableOpacity
                  key={c.code}
                  activeOpacity={0.85}
                  onPress={() => pickCurrency(c.code)}
                  style={[
                    styles.currencyRow,
                    active && styles.currencyRowActive,
                  ]}
                >
                  <Text style={{ fontWeight: "700" }}>{c.label}</Text>
                  {active ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color="#22C55E"
                    />
                  ) : (
                    <Ionicons
                      name="ellipse-outline"
                      size={20}
                      color="rgba(255,255,255,0.35)"
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
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
      marginBottom: 16,
      opacity: isDark ? 0.85 : 0.8,
      color: isDark ? "#fff" : "#111",
    },

    // ✅ ADD
    currencyBtn: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
    },
    currencyBtnText: {
      fontWeight: "700",
      color: isDark ? "#fff" : "#111",
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

    fabLabel: {
      marginTop: 48,
      fontSize: 11,
      fontWeight: "700",
      opacity: isDark ? 0.75 : 0.65,
      color: isDark ? "#fff" : "#000",
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

    // ✅ ADD modal styles
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "center",
      paddingHorizontal: 18,
    },
    modalCard: {
      backgroundColor: isDark ? "#0B1220" : "#FFFFFF",
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
    },
    currencyRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderRadius: 12,
      marginTop: 8,
      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
    },
    currencyRowActive: {
      borderWidth: 1,
      borderColor: "#38BDF8",
    },
  });
