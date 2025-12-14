// FinTrack Pro / screens/SpendingInsights.tsx

import React, { useEffect, useState } from "react";
import { View, Platform, KeyboardAvoidingView } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  Button,
} from "react-native-rapi-ui";

import { Ionicons } from "@expo/vector-icons";

import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  DocumentData,
} from "firebase/firestore";
import { getAuth, User } from "firebase/auth";

type Props = NativeStackScreenProps<MainStackParamList, "SpendingInsights">;

interface TxItem {
  amount: number;
  type: string;
  category: string;
  transactionDate: number;
}

export default function SpendingInsights({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const [transactions, setTransactions] = useState<TxItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Insights
  const [topCategory, setTopCategory] = useState<string>("-");
  const [expenseChange, setExpenseChange] = useState<number | null>(null);
  const [savingsRate, setSavingsRate] = useState<number | null>(null);

  useEffect(() => {
    const auth = getAuth();
    const db = getFirestore();

    if (!auth.currentUser) {
      setLoading(false);
      return;
    }

    const currentUser: User = auth.currentUser;

    const q = query(
      collection(db, "Transactions"),
      where("CreatedUser.CreatedUserId", "==", currentUser.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: TxItem[] = [];

        snapshot.forEach((doc) => {
          const data = doc.data() as DocumentData;

          list.push({
            amount: Number(data.amount),
            type: data.type,
            category: data.category,
            transactionDate: data.transactionDate,
          });
        });

        setTransactions(list);
        setLoading(false);
        generateInsights(list);
      },
      (error) => {
        console.log("Error loading insights:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const generateInsights = (tx: TxItem[]) => {
    if (tx.length === 0) return;

    const now = new Date();

    // Group expenses by category
    const categoryTotals: Record<string, number> = {};

    tx.forEach((t) => {
      if (t.type === "expense") {
        categoryTotals[t.category] =
          (categoryTotals[t.category] || 0) + t.amount;
      }
    });

    // Find top category
    let maxCat = "-";
    let maxAmount = 0;

    for (const cat in categoryTotals) {
      if (categoryTotals[cat] > maxAmount) {
        maxAmount = categoryTotals[cat];
        maxCat = cat;
      }
    }

    setTopCategory(maxCat);

    // Monthly expenses comparison
    const currentMonth = now.getMonth();
    const lastMonth = currentMonth - 1 === -1 ? 11 : currentMonth - 1;
    const currentYear = now.getFullYear();
    const lastMonthYear = lastMonth === 11 ? currentYear - 1 : currentYear;

    let thisMonthExpense = 0;
    let lastMonthExpense = 0;

    tx.forEach((t) => {
      if (t.type !== "expense") return;
      const date = new Date(t.transactionDate);
      const m = date.getMonth();
      const y = date.getFullYear();

      if (m === currentMonth && y === currentYear) {
        thisMonthExpense += t.amount;
      }
      if (m === lastMonth && y === lastMonthYear) {
        lastMonthExpense += t.amount;
      }
    });

    if (lastMonthExpense > 0) {
      const diff =
        ((thisMonthExpense - lastMonthExpense) / lastMonthExpense) * 100;
      setExpenseChange(diff);
    } else {
      setExpenseChange(null);
    }

    // Savings rate (income - expense) / income
    let totalIncome = 0;
    let totalExpense = 0;

    tx.forEach((t) => {
      if (t.type === "income") totalIncome += t.amount;
      else totalExpense += t.amount;
    });

    if (totalIncome > 0) {
      const rate = ((totalIncome - totalExpense) / totalIncome) * 100;
      setSavingsRate(rate);
    } else {
      setSavingsRate(null);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      enabled
      style={{ flex: 1 }}
    >
      <Layout>
        <TopNav
          middleContent="Spending Insights"
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

        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 10 }}>
          {loading ? (
            <Text>Loading insights...</Text>
          ) : transactions.length === 0 ? (
            <Text>No transactions available to analyze.</Text>
          ) : (
            <>
              {/* Top Category Card */}
              <View
                style={{
                  padding: 20,
                  borderRadius: 10,
                  backgroundColor: isDarkmode ? "#1c2935" : "#eaf8ff",
                  marginBottom: 15,
                }}
              >
                <Text size="h3" fontWeight="bold">
                  Top Spending Category
                </Text>
                <Text size="h2" fontWeight="bold" style={{ marginTop: 5 }}>
                  {topCategory}
                </Text>
              </View>

              {/* Expense Trend Card */}
              <View
                style={{
                  padding: 20,
                  borderRadius: 10,
                  backgroundColor: isDarkmode ? "#2b1c1c" : "#ffeaea",
                  marginBottom: 15,
                }}
              >
                <Text size="h3" fontWeight="bold">
                  Monthly Expense Trend
                </Text>
                <Text size="h2" fontWeight="bold" style={{ marginTop: 5 }}>
                  {expenseChange === null
                    ? "No previous month data"
                    : expenseChange >= 0
                    ? `+${expenseChange.toFixed(1)}% this month`
                    : `${expenseChange.toFixed(1)}% (decrease)`}
                </Text>
              </View>

              {/* Savings Rate */}
              <View
                style={{
                  padding: 20,
                  borderRadius: 10,
                  backgroundColor: isDarkmode ? "#2b2b2b" : "#f0f0f0",
                  marginBottom: 15,
                }}
              >
                <Text size="h3" fontWeight="bold">
                  Savings Rate
                </Text>
                <Text size="h2" fontWeight="bold" style={{ marginTop: 5 }}>
                  {savingsRate !== null
                    ? `${savingsRate.toFixed(1)}%`
                    : "Not enough data"}
                </Text>
              </View>

              <Button
                text="Add New Transaction"
                onPress={() => navigation.navigate("TransactionAdd")}
              />
            </>
          )}
        </View>
      </Layout>
    </KeyboardAvoidingView>
  );
}
