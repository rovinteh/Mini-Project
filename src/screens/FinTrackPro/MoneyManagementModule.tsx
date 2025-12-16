// app/screens/FinTrackPro/MoneyManagementModule.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
  Pressable,
  ScrollView,
  Dimensions,
  ActivityIndicator,
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

// ✅ Currency store (keep)
import {
  CURRENCY_OPTIONS,
  CurrencyCode,
  codeToLabel,
  codeToSymbol,
  getCurrencyCode,
  setCurrencyCode,
} from "../../utils/currencyStore";

// ✅ Firebase
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  DocumentData,
  doc,
  getDoc,
} from "firebase/firestore";

type Props = NativeStackScreenProps<
  MainStackParamList,
  "MoneyManagementModule"
>;

type TabKey = "home" | "list" | "budget" | "insights" | "chart";

type Tx = {
  amount: number;
  type: "income" | "expense";
  category?: string;
  note?: string;
  transactionDate: number;
};

const MODULE_COLOR = "#38BDF8";

const MONTH_KEY = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// stable pie colors
const PIE_COLORS = [
  "#38BDF8",
  "#A78BFA",
  "#FBBF24",
  "#34D399",
  "#FB7185",
  "#60A5FA",
  "#F97316",
  "#22C55E",
  "#E879F9",
  "#94A3B8",
];

export default function MoneyManagementModule({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const styles = useMemo(() => makeStyles(!!isDarkmode), [isDarkmode]);

  // ✅ currency state (keep)
  const [currency, setCurrency] = useState<CurrencyCode>("MYR");
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);

  // ✅ Home dashboard states
  const [loadingHome, setLoadingHome] = useState(true);
  const [incomeThisMonth, setIncomeThisMonth] = useState(0);
  const [expenseThisMonth, setExpenseThisMonth] = useState(0);
  const [txThisMonth, setTxThisMonth] = useState<Tx[]>([]);

  // ✅ Budget remaining (from BudgetHub collection/doc)
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [budgetLimit, setBudgetLimit] = useState<number | null>(null);

  const auth = getAuth();
  const db = getFirestore();

  const now = new Date();
  const monthKey = MONTH_KEY(now);

  // ✅ load saved currency on mount (keep)
  useEffect(() => {
    (async () => {
      const saved = await getCurrencyCode();
      setCurrency(saved);
    })();
  }, []);

  const iconColor = (active: boolean) => {
    if (active) return MODULE_COLOR;
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

  const symbol = codeToSymbol(currency);

  const fmt = (n: number) => {
    const v = Number.isFinite(n) ? n : 0;
    return `${symbol} ${v.toFixed(2)}`;
  };

  // ---------- Listen transactions (THIS MONTH) ----------
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoadingHome(false);
      return;
    }

    const q = query(
      collection(db, "Transactions"),
      where("CreatedUser.CreatedUserId", "==", user.uid)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        let inc = 0;
        let exp = 0;
        const arr: Tx[] = [];

        snapshot.forEach((d) => {
          const data = d.data() as DocumentData;

          const txMs =
            typeof data.transactionDate === "number"
              ? data.transactionDate
              : typeof data.createdDate === "number"
              ? data.createdDate
              : null;

          if (!txMs) return;

          const dt = new Date(txMs);
          const sameMonth =
            dt.getFullYear() === now.getFullYear() &&
            dt.getMonth() === now.getMonth();
          if (!sameMonth) return;

          const tx: Tx = {
            amount: Number(data.amount) || 0,
            type: data.type,
            category: data.category || "Uncategorized",
            note: data.note || "",
            transactionDate: Number(txMs),
          };

          arr.push(tx);

          if (tx.type === "income") inc += tx.amount;
          if (tx.type === "expense") exp += tx.amount;
        });

        arr.sort((a, b) => b.transactionDate - a.transactionDate);

        setIncomeThisMonth(inc);
        setExpenseThisMonth(exp);
        setTxThisMonth(arr);
        setLoadingHome(false);
      },
      (err) => {
        console.log("MoneyManagementModule tx error:", err);
        setLoadingHome(false);
      }
    );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Read Budget doc for this month ----------
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setBudgetLoading(false);
      return;
    }

    const budgetDocId = `${user.uid}_${monthKey}`;
    const ref = doc(db, "Budget", budgetDocId);

    (async () => {
      try {
        setBudgetLoading(true);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data: any = snap.data();
          const limit = Number(data?.amountLimit);
          setBudgetLimit(Number.isFinite(limit) ? limit : null);
        } else {
          setBudgetLimit(null);
        }
      } catch (e) {
        console.log("Budget read error:", e);
        setBudgetLimit(null);
      } finally {
        setBudgetLoading(false);
      }
    })();
  }, [monthKey]);

  // ---------- Derived dashboard data ----------
  const monthlyBalance = incomeThisMonth - expenseThisMonth;

  const hasBudget = typeof budgetLimit === "number" && budgetLimit > 0;
  const budgetUsed = expenseThisMonth;
  const budgetRemaining = hasBudget ? budgetLimit! - budgetUsed : null;
  const budgetRatio = hasBudget ? clamp01(budgetUsed / budgetLimit!) : 0;

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    txThisMonth.forEach((t) => {
      if (t.type !== "expense") return;
      const c = t.category || "Uncategorized";
      map[c] = (map[c] || 0) + (Number(t.amount) || 0);
    });
    return map;
  }, [txThisMonth]);

  const categorySorted = useMemo(() => {
    return Object.entries(byCategory)
      .map(([k, v]) => ({ name: k, value: v }))
      .sort((a, b) => b.value - a.value);
  }, [byCategory]);

  const top3 = categorySorted.slice(0, 3);

  // PieChart from chart-kit (same library you already use in ExpensesChart)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PieChart } = require("react-native-chart-kit");

  const pieData = useMemo(() => {
    const total = expenseThisMonth > 0 ? expenseThisMonth : 1;

    const sliced = categorySorted.slice(0, 6);
    const rest = categorySorted.slice(6);
    const restSum = rest.reduce((a, b) => a + b.value, 0);

    const combined =
      restSum > 0
        ? [...sliced, { name: "Others", value: restSum }]
        : [...sliced];

    return combined.map((x, idx) => ({
      name: x.name,
      population: x.value,
      color: PIE_COLORS[idx % PIE_COLORS.length],
      legendFontColor: isDarkmode
        ? "rgba(255,255,255,0.75)"
        : "rgba(0,0,0,0.7)",
      legendFontSize: 12,
      pct: Math.round((x.value / total) * 100),
    }));
  }, [categorySorted, expenseThisMonth, isDarkmode]);

  const screenW = Dimensions.get("window").width;
  const chartW = Math.min(screenW - 40, 360);

  const StatCard = ({
    title,
    value,
    icon,
    color,
  }: {
    title: string;
    value: string;
    icon: string;
    color: string;
  }) => (
    <View style={styles.statCard}>
      <Text style={styles.statTitle}>
        {icon} {title}
      </Text>
      <Text fontWeight="bold" style={{ fontSize: 18, color, marginTop: 6 }}>
        {value}
      </Text>
    </View>
  );

  const Card = ({
    title,
    right,
    children,
  }: {
    title: string;
    right?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text fontWeight="bold" style={{ fontSize: 15 }}>
          {title}
        </Text>
        {right ?? <View style={styles.dot} />}
      </View>
      {children}
    </View>
  );

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

      {/* ✅ NEW: Attractive Home */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 140,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Title + subtitle */}
        <View style={{ alignItems: "center", marginBottom: 10 }}>
          <Text fontWeight="bold" size="h3" style={{ marginBottom: 6 }}>
            FinTrack Pro
          </Text>
          <Text style={styles.subtitle}>
            Manage your income, expenses and budgets in one place.
          </Text>

          {/* Currency button (keep) */}
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

        {loadingHome ? (
          <View style={{ paddingVertical: 30, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, opacity: 0.8 }}>Loading...</Text>
          </View>
        ) : (
          <>
            {/* Month badge */}
            <View style={styles.monthBadge}>
              <Ionicons name="calendar-outline" size={16} color="#fff" />
              <Text style={styles.monthBadgeText}>This Month: {monthKey}</Text>
            </View>

            {/* Stats row */}
            <View style={{ flexDirection: "row", marginTop: 12 }}>
              <StatCard
                title="Income"
                icon="🟢"
                value={fmt(incomeThisMonth)}
                color="#22C55E"
              />
              <View style={{ width: 10 }} />
              <StatCard
                title="Expense"
                icon="🔴"
                value={fmt(expenseThisMonth)}
                color="#EF4444"
              />
            </View>

            <View style={{ flexDirection: "row", marginTop: 10 }}>
              <StatCard
                title="Monthly Balance"
                icon={monthlyBalance >= 0 ? "💰" : "⚠️"}
                value={fmt(monthlyBalance)}
                color={monthlyBalance >= 0 ? MODULE_COLOR : "#FB7185"}
              />
              <View style={{ width: 10 }} />
              <StatCard
                title="Budget Remaining"
                icon="🎯"
                value={
                  budgetLoading
                    ? "Loading..."
                    : hasBudget
                    ? fmt(budgetRemaining ?? 0)
                    : "Not set"
                }
                color={
                  !hasBudget
                    ? isDarkmode
                      ? "rgba(255,255,255,0.8)"
                      : "rgba(0,0,0,0.7)"
                    : (budgetRemaining ?? 0) >= 0
                    ? "#22C55E"
                    : "#EF4444"
                }
              />
            </View>

            {/* Budget progress */}
            <Card
              title="Budget Progress"
              right={
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate("BudgetHub")}
                  style={styles.smallPill}
                >
                  <Ionicons name="open-outline" size={16} color="#001018" />
                  <Text style={styles.smallPillText}>Open</Text>
                </TouchableOpacity>
              }
            >
              {!hasBudget ? (
                <Text style={{ opacity: 0.8 }}>
                  No budget set for this month. Open Budget Hub to set a limit.
                </Text>
              ) : (
                <>
                  <Text style={{ opacity: 0.85 }}>
                    Limit: <Text fontWeight="bold">{fmt(budgetLimit!)}</Text> •
                    Used: <Text fontWeight="bold">{fmt(budgetUsed)}</Text>
                  </Text>

                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.min(1, budgetRatio) * 100}%`,
                          backgroundColor:
                            budgetUsed > (budgetLimit ?? 0)
                              ? "#EF4444"
                              : MODULE_COLOR,
                        },
                      ]}
                    />
                  </View>

                  <Text style={{ marginTop: 8, opacity: 0.8 }}>
                    {Math.round(budgetRatio * 100)}% used
                  </Text>
                </>
              )}
            </Card>

            {/* Pie chart */}
            <Card title="Expense Categories (This Month)">
              {expenseThisMonth <= 0 ? (
                <Text style={{ opacity: 0.8 }}>
                  No expense data yet. Add an expense to see the category pie
                  chart.
                </Text>
              ) : (
                <>
                  <View style={{ alignItems: "center" }}>
                    <PieChart
                      data={pieData.map((p: any) => ({
                        name: p.name,
                        population: p.population,
                        color: p.color,
                        legendFontColor: p.legendFontColor,
                        legendFontSize: p.legendFontSize,
                      }))}
                      width={chartW}
                      height={220}
                      accessor="population"
                      backgroundColor="transparent"
                      paddingLeft="12"
                      hasLegend={false}
                      absolute
                      chartConfig={{
                        color: () => MODULE_COLOR,
                      }}
                    />
                  </View>

                  <View style={{ marginTop: 8 }}>
                    {top3.length === 0 ? (
                      <Text style={{ opacity: 0.8 }}>No categories yet.</Text>
                    ) : (
                      top3.map((x, idx) => (
                        <View
                          key={`${x.name}-${idx}`}
                          style={[
                            styles.rowLine,
                            {
                              borderTopWidth:
                                idx === 0 ? 0 : StyleSheet.hairlineWidth,
                            },
                          ]}
                        >
                          <Text style={{ fontWeight: "700" }}>
                            {idx + 1}. {x.name}
                          </Text>
                          <Text style={{ opacity: 0.8 }}>{fmt(x.value)}</Text>
                        </View>
                      ))
                    )}
                  </View>
                </>
              )}
            </Card>

            {/* Quick actions */}
            <Card title="Quick Actions">
              <View style={{ flexDirection: "row" }}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.actionBtn, { marginRight: 10 }]}
                  onPress={() => navigation.navigate("TransactionAdd")}
                >
                  <Ionicons name="add-circle-outline" size={18} color="#fff" />
                  <Text style={styles.actionText}>Add</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.actionBtn, { backgroundColor: "#7C3AED" }]}
                  onPress={() => navigation.navigate("SpendingInsights")}
                >
                  <Ionicons name="sparkles" size={18} color="#fff" />
                  <Text style={styles.actionText}>AI Insights</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: "row", marginTop: 10 }}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[
                    styles.actionBtn,
                    { marginRight: 10, backgroundColor: "#22C55E" },
                  ]}
                  onPress={() => navigation.navigate("BudgetHub")}
                >
                  <Ionicons name="wallet-outline" size={18} color="#fff" />
                  <Text style={styles.actionText}>Budget</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.actionBtn, { backgroundColor: "#0EA5E9" }]}
                  onPress={() => navigation.navigate("ExpensesChart")}
                >
                  <Ionicons name="stats-chart-outline" size={18} color="#fff" />
                  <Text style={styles.actionText}>Chart</Text>
                </TouchableOpacity>
              </View>
            </Card>
          </>
        )}
      </ScrollView>

      {/* Bottom bar (keep your original) */}
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

      {/* Currency modal (keep) */}
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
                      color={
                        isDarkmode
                          ? "rgba(255,255,255,0.35)"
                          : "rgba(0,0,0,0.35)"
                      }
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
    subtitle: {
      textAlign: "center",
      marginBottom: 12,
      opacity: isDark ? 0.85 : 0.8,
      color: isDark ? "#fff" : "#111",
    },

    monthBadge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "center",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: "#2563EB",
      marginTop: 6,
    },
    monthBadgeText: {
      color: "#fff",
      fontWeight: "800",
      marginLeft: 8,
      fontSize: 12,
    },

    statCard: {
      flex: 1,
      padding: 14,
      borderRadius: 14,
      backgroundColor: isDark ? "#0B1220" : "#FFFFFF",
      borderWidth: 1,
      borderColor: isDark ? "rgba(56,189,248,0.22)" : "rgba(56,189,248,0.18)",
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    statTitle: {
      opacity: 0.8,
      color: isDark ? "#fff" : "#111",
      fontSize: 12,
      fontWeight: "700",
    },

    card: {
      marginTop: 12,
      padding: 14,
      borderRadius: 16,
      backgroundColor: isDark ? "#0B1220" : "#FFFFFF",
      borderWidth: 1,
      borderColor: isDark ? "rgba(56,189,248,0.22)" : "rgba(56,189,248,0.18)",
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    cardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 999,
      backgroundColor: MODULE_COLOR,
      opacity: 0.9,
    },

    progressTrack: {
      marginTop: 12,
      height: 10,
      borderRadius: 999,
      backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)",
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: 999,
    },

    rowLine: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 8,
      borderTopColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
    },

    actionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 12,
      borderRadius: 14,
      backgroundColor: "#2563EB",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.12)",
    },
    actionText: {
      marginLeft: 8,
      color: "#fff",
      fontWeight: "800",
    },

    smallPill: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: MODULE_COLOR,
    },
    smallPillText: {
      marginLeft: 6,
      fontWeight: "900",
      color: "#001018",
      fontSize: 12,
    },

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
      borderColor: MODULE_COLOR,
    },
  });
