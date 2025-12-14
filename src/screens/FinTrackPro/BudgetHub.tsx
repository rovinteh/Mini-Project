import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Modal,
  Alert,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  Button,
  TextInput,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";

import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  DocumentData,
  doc,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

type Props = NativeStackScreenProps<MainStackParamList, "BudgetHub">;

const MONTH_KEY = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const DAY_KEY = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

export default function BudgetHub({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();

  const [loading, setLoading] = useState(true);

  // totals (THIS MONTH)
  const [incomeTotal, setIncomeTotal] = useState<number>(0);
  const [expenseTotal, setExpenseTotal] = useState<number>(0);

  // tx dates for streak
  const [txDaySet, setTxDaySet] = useState<Set<string>>(new Set());
  const [txCount, setTxCount] = useState<number>(0);

  // budget limit (THIS MONTH)
  const [budgetLimit, setBudgetLimit] = useState<number | null>(null);
  const [budgetLoading, setBudgetLoading] = useState<boolean>(true);

  // setup budget modal
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>("");

  const auth = getAuth();
  const db = getFirestore();

  const now = new Date();
  const monthKey = MONTH_KEY(now);

  // ---------- Helpers ----------
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  const computeStreak = (daySet: Set<string>) => {
    let streak = 0;
    const cursor = new Date();
    while (true) {
      const key = DAY_KEY(cursor);
      if (!daySet.has(key)) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  };

  // ---------- Listen Transactions (THIS MONTH) ----------
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "Transactions"),
      where("CreatedUser.CreatedUserId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let income = 0;
        let expense = 0;

        const daySet = new Set<string>();
        let count = 0;

        snapshot.forEach((d) => {
          const data = d.data() as DocumentData;

          const txMs =
            typeof data.transactionDate === "number"
              ? data.transactionDate
              : typeof data.createdDate === "number"
              ? data.createdDate
              : null;

          if (txMs) {
            const dt = new Date(txMs);
            daySet.add(DAY_KEY(dt));
          }

          count += 1;

          // filter THIS MONTH
          if (!txMs) return;
          const dt = new Date(txMs);
          const sameMonth =
            dt.getFullYear() === now.getFullYear() &&
            dt.getMonth() === now.getMonth();
          if (!sameMonth) return;

          if (data.type === "income") income += Number(data.amount);
          if (data.type === "expense") expense += Number(data.amount);
        });

        setIncomeTotal(income);
        setExpenseTotal(expense);
        setTxDaySet(daySet);
        setTxCount(count);

        setLoading(false);
      },
      (error) => {
        console.log("Error fetching transactions:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Budget doc (THIS MONTH) ----------
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
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as any;
          const limit = Number(data.amountLimit);
          setBudgetLimit(Number.isFinite(limit) ? limit : null);
        } else {
          setBudgetLimit(null);
        }
      } catch (e: any) {
        console.log("Error reading Budget:", e?.message ?? e);
        setBudgetLimit(null);
      } finally {
        setBudgetLoading(false);
      }
    })();
  }, [monthKey]);

  const balance = incomeTotal - expenseTotal;
  const streak = useMemo(() => computeStreak(txDaySet), [txDaySet]);

  // budget progress
  const budgetUsed = expenseTotal;
  const hasBudget = typeof budgetLimit === "number" && budgetLimit > 0;
  const budgetRemaining = hasBudget ? budgetLimit! - budgetUsed : null;
  const budgetRatio = hasBudget ? clamp01(budgetUsed / budgetLimit!) : 0;

  const milestone = useMemo(() => {
    if (txCount >= 50) return "🏆 Milestone: 50 transactions logged!";
    if (txCount >= 20) return "🏆 Milestone: 20 transactions logged!";
    if (txCount >= 10) return "🏆 Milestone: 10 transactions logged!";
    if (txCount >= 1) return "✨ First transaction recorded!";
    return "Start by adding your first transaction!";
  }, [txCount]);

  const saveBudgetLimit = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Not logged in", "Please login again.");
      return;
    }

    const val = Number(budgetInput);
    if (!Number.isFinite(val) || val <= 0) {
      Alert.alert(
        "Invalid amount",
        "Please enter a valid positive budget limit."
      );
      return;
    }

    try {
      const budgetDocId = `${user.uid}_${monthKey}`;
      await setDoc(doc(db, "Budget", budgetDocId), {
        userID: user.uid,
        monthYear: monthKey,
        amountLimit: val,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      });

      setBudgetLimit(val);
      setShowBudgetModal(false);
      setBudgetInput("");
      Alert.alert(
        "Saved",
        `Budget limit set to RM ${val.toFixed(2)} for ${monthKey}`
      );
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save budget.");
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      <Layout>
        <TopNav
          middleContent="Budget Hub"
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

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: 20,
          }}
        >
          {loading ? (
            <Text>Loading...</Text>
          ) : (
            <>
              <Text size="h4" fontWeight="bold" style={{ marginBottom: 10 }}>
                {`This Month (${monthKey})`}
              </Text>

              {/* Income */}
              <View
                style={{
                  padding: 18,
                  borderRadius: 12,
                  backgroundColor: isDarkmode ? "#1c2935" : "#e0f7e9",
                  marginBottom: 12,
                }}
              >
                <Text size="h4" fontWeight="bold" style={{ color: "green" }}>
                  Total Income
                </Text>
                <Text size="h2" fontWeight="bold">
                  RM {incomeTotal.toFixed(2)}
                </Text>
              </View>

              {/* Expense */}
              <View
                style={{
                  padding: 18,
                  borderRadius: 12,
                  backgroundColor: isDarkmode ? "#2b1c1c" : "#ffe1e1",
                  marginBottom: 12,
                }}
              >
                <Text size="h4" fontWeight="bold" style={{ color: "red" }}>
                  Total Expense
                </Text>
                <Text size="h2" fontWeight="bold">
                  RM {expenseTotal.toFixed(2)}
                </Text>
              </View>

              {/* Balance */}
              <View
                style={{
                  padding: 18,
                  borderRadius: 12,
                  backgroundColor: isDarkmode ? "#1f1f1f" : "#f0f0f0",
                  marginBottom: 12,
                }}
              >
                <Text size="h4" fontWeight="bold">
                  Balance
                </Text>
                <Text
                  size="h2"
                  fontWeight="bold"
                  style={{ color: balance >= 0 ? "green" : "red" }}
                >
                  RM {balance.toFixed(2)}
                </Text>
              </View>

              {/* Budget Progress */}
              <View
                style={{
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: isDarkmode
                    ? themeColor.dark200
                    : themeColor.white,
                  marginBottom: 12,
                  borderWidth: 1,
                  borderColor: isDarkmode
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(0,0,0,0.06)",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text size="h4" fontWeight="bold">
                    Budget Progress
                  </Text>

                  <Button
                    text={hasBudget ? "Edit" : "Set"}
                    onPress={() => {
                      setBudgetInput(hasBudget ? String(budgetLimit) : "");
                      setShowBudgetModal(true);
                    }}
                    size="sm"
                    style={{ width: 90 }}
                  />
                </View>

                {budgetLoading ? (
                  <Text style={{ marginTop: 8 }}>Loading budget...</Text>
                ) : !hasBudget ? (
                  <Text style={{ marginTop: 8, opacity: 0.8 }}>
                    No budget limit set for this month. Tap “Set” to add one.
                  </Text>
                ) : (
                  <>
                    <Text style={{ marginTop: 8 }}>
                      Limit:{" "}
                      <Text fontWeight="bold">
                        RM {budgetLimit!.toFixed(2)}
                      </Text>
                    </Text>
                    <Text style={{ marginTop: 4 }}>
                      Used:{" "}
                      <Text fontWeight="bold">RM {budgetUsed.toFixed(2)}</Text>
                    </Text>
                    <Text style={{ marginTop: 4 }}>
                      Remaining:{" "}
                      <Text
                        fontWeight="bold"
                        style={{
                          color: (budgetRemaining ?? 0) >= 0 ? "green" : "red",
                        }}
                      >
                        RM {(budgetRemaining ?? 0).toFixed(2)}
                      </Text>
                    </Text>

                    <View
                      style={{
                        marginTop: 12,
                        height: 10,
                        borderRadius: 999,
                        backgroundColor: isDarkmode
                          ? "rgba(255,255,255,0.12)"
                          : "rgba(0,0,0,0.08)",
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          height: "100%",
                          width: `${Math.min(1, budgetRatio) * 100}%`,
                          backgroundColor:
                            budgetUsed > (budgetLimit ?? 0)
                              ? "red"
                              : themeColor.primary,
                        }}
                      />
                    </View>

                    <Text style={{ marginTop: 8, opacity: 0.8 }}>
                      {Math.round((budgetRatio || 0) * 100)}% used
                    </Text>
                  </>
                )}
              </View>

              {/* Motivation */}
              <View
                style={{
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: isDarkmode
                    ? themeColor.dark200
                    : themeColor.white,
                  marginBottom: 14,
                  borderWidth: 1,
                  borderColor: isDarkmode
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(0,0,0,0.06)",
                }}
              >
                <Text size="h4" fontWeight="bold">
                  Motivation
                </Text>
                <Text style={{ marginTop: 8 }}>
                  🔥 Tracking Streak:{" "}
                  <Text fontWeight="bold">{streak} day(s)</Text>
                </Text>
                <Text style={{ marginTop: 6, opacity: 0.9 }}>{milestone}</Text>
              </View>

              <Button
                text="Add New Transaction"
                onPress={() => navigation.navigate("TransactionAdd")}
              />
            </>
          )}
        </ScrollView>

        {/* Budget Modal */}
        <Modal
          visible={showBudgetModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowBudgetModal(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.5)",
              justifyContent: "center",
              paddingHorizontal: 18,
            }}
          >
            <View
              style={{
                backgroundColor: isDarkmode
                  ? themeColor.dark
                  : themeColor.white,
                borderRadius: 14,
                padding: 18,
              }}
            >
              <Text size="h3" fontWeight="bold">
                Set Monthly Budget
              </Text>
              <Text style={{ marginTop: 6, opacity: 0.85 }}>
                Month: {monthKey}
              </Text>

              <Text style={{ marginTop: 12 }}>Budget Limit (RM)</Text>
              <TextInput
                containerStyle={{ marginTop: 10 }}
                placeholder="e.g. 800"
                keyboardType="numeric"
                value={budgetInput}
                onChangeText={setBudgetInput}
              />

              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <Button
                  text="Cancel"
                  onPress={() => setShowBudgetModal(false)}
                  style={{
                    flex: 1,
                    backgroundColor: isDarkmode
                      ? themeColor.dark200
                      : "#e5e7eb",
                  }}
                  textStyle={{
                    color: isDarkmode ? themeColor.white100 : themeColor.dark,
                  }}
                />
                <Button
                  text="Save"
                  onPress={saveBudgetLimit}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      </Layout>
    </KeyboardAvoidingView>
  );
}
