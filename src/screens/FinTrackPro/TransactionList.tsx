import React, { useEffect, useMemo, useState } from "react";
import { View, Platform, KeyboardAvoidingView, Alert } from "react-native";
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
  orderBy,
  onSnapshot,
  DocumentData,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { getAuth, User } from "firebase/auth";

import { SwipeListView } from "react-native-swipe-list-view";
import { TouchableOpacity } from "react-native";

import { Picker } from "@react-native-picker/picker";

type Props = NativeStackScreenProps<MainStackParamList, "TransactionList">;

interface TransactionItem {
  id: string;
  amount: number;
  type: string;
  category: string;
  note?: string;
  transactionDate?: number; // stored as getTime()
}

// ✅ Mobile-friendly category icons (optional)
const CATEGORY_ICON: Record<string, string> = {
  Shopping: "🛒",
  Food: "🍔",
  fuel: "⛽",
  Fuel: "⛽",
  Salary: "💼",
  Transport: "🚗",
  Bills: "🧾",
  Grocery: "🛍️",
  Badminton: "🏸",
};

const getIcon = (category?: string) =>
  (category && CATEGORY_ICON[category]) || "💳";

// ---- helpers ----
const monthKey = (ms?: number) => {
  if (!ms) return "Unknown";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`; // e.g. 2025-12
};

const monthLabel = (key: string) => {
  if (key === "ALL") return "All months";
  if (key === "Unknown") return "Unknown date";
  const [y, m] = key.split("-");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const idx = Number(m) - 1;
  return `${monthNames[idx] ?? m} ${y}`;
};

const normalize = (s?: string) => (s ?? "").trim();

export default function TransactionList({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();

  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // ✅ filters
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");

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
      where("CreatedUser.CreatedUserId", "==", currentUser.uid),
      orderBy("transactionDate", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: TransactionItem[] = [];
        snapshot.forEach((d) => {
          const data = d.data() as DocumentData;
          list.push({
            id: d.id,
            amount: data.amount,
            type: data.type,
            category: data.category,
            note: data.note,
            transactionDate: data.transactionDate,
          });
        });
        setTransactions(list);
        setLoading(false);
      },
      (error) => {
        console.log("Error fetching transactions:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // ✅ auto generate month options from data
  const monthOptions = useMemo(() => {
    const keys = new Set<string>();
    transactions.forEach((t) => keys.add(monthKey(t.transactionDate)));
    // Sort latest first (string works for YYYY-MM)
    const sorted = Array.from(keys).sort((a, b) => (a < b ? 1 : -1));
    return ["ALL", ...sorted];
  }, [transactions]);

  // ✅ auto generate category options from data
  const categoryOptions = useMemo(() => {
    const keys = new Set<string>();
    transactions.forEach((t) => keys.add(normalize(t.category)));
    const sorted = Array.from(keys)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return ["ALL", ...sorted];
  }, [transactions]);

  // ✅ apply filters (no re-fetch)
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const m = monthKey(t.transactionDate);
      const c = normalize(t.category);

      const okMonth = selectedMonth === "ALL" ? true : m === selectedMonth;
      const okCat = selectedCategory === "ALL" ? true : c === selectedCategory;

      return okMonth && okCat;
    });
  }, [transactions, selectedMonth, selectedCategory]);

  const handleDelete = (id: string) => {
    const db = getFirestore();

    if (Platform.OS === "web") {
      const ok = window.confirm("Delete this transaction?");
      if (!ok) return;

      deleteDoc(doc(db, "Transactions", id)).catch((error: any) => {
        console.log(">>> Web deleteDoc ERROR:", error);
        window.alert("Error deleting transaction: " + error.message);
      });
      return;
    }

    Alert.alert("Delete Transaction", "Are you sure you want to delete this?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "Transactions", id));
          } catch (error: any) {
            alert("Error deleting transaction: " + error.message);
          }
        },
      },
    ]);
  };

  const handleEdit = (item: TransactionItem) => {
    navigation.navigate("TransactionAdd", { transactionId: item.id });
  };

  // ✅ MOBILE-FIRST CARD ITEM
  const renderItem = (data: { item: TransactionItem }) => {
    const item = data.item;

    const isIncome = item.type?.toLowerCase() === "income";
    const icon = getIcon(item.category);

    const dateString = item.transactionDate
      ? new Date(item.transactionDate).toLocaleDateString()
      : "-";

    const cardBg = isDarkmode ? "#1F2937" : "#FFFFFF";
    const titleColor = isDarkmode ? themeColor.white100 : themeColor.dark;
    const subColor = isDarkmode ? "#9CA3AF" : "#6B7280";
    const noteColor = isDarkmode ? "#D1D5DB" : "#374151";

    const accent = isIncome ? "#22C55E" : "#EF4444";

    return (
      <View
        style={{
          backgroundColor: cardBg,
          borderRadius: 18,
          padding: 14,
          marginVertical: 8,
          borderTopWidth: 3,
          borderTopColor: accent,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 6,
          elevation: 2,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text
            fontWeight="bold"
            style={{
              fontSize: 16,
              color: titleColor,
              flexShrink: 1,
            }}
          >
            {icon} {item.category}
          </Text>

          <Text
            fontWeight="bold"
            style={{
              fontSize: 18,
              color: accent,
              marginLeft: 10,
            }}
          >
            {isIncome ? "+" : "-"} RM {item.amount.toFixed(2)}
          </Text>
        </View>

        <Text style={{ marginTop: 4, fontSize: 12, color: subColor }}>
          {dateString}
        </Text>

        {item.note ? (
          <Text style={{ marginTop: 6, fontSize: 14, color: noteColor }}>
            {item.note}
          </Text>
        ) : null}

        <View
          style={{
            marginTop: 10,
            alignSelf: "flex-start",
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor: isDarkmode ? "rgba(255,255,255,0.06)" : "#F3F4F6",
          }}
        >
          <Text style={{ fontSize: 12, color: subColor }}>
            {isIncome ? "Income" : "Expense"}
          </Text>
        </View>
      </View>
    );
  };

  // ✅ swipe actions
  const renderHiddenItem = (data: { item: TransactionItem }) => {
    const item = data.item;

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: isDarkmode ? "#111827" : "#E5E7EB",
          borderRadius: 18,
          marginVertical: 8,
        }}
      >
        <TouchableOpacity
          style={{
            position: "absolute",
            right: 75,
            top: 0,
            bottom: 0,
            width: 75,
            backgroundColor: "#22C55E",
            justifyContent: "center",
            alignItems: "center",
            borderTopLeftRadius: 18,
            borderBottomLeftRadius: 18,
          }}
          onPress={() => handleEdit(item)}
        >
          <Text style={{ color: "white", fontWeight: "bold" }}>Edit</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 75,
            backgroundColor: "#EF4444",
            justifyContent: "center",
            alignItems: "center",
            borderTopRightRadius: 18,
            borderBottomRightRadius: 18,
          }}
          onPress={() => handleDelete(item.id)}
        >
          <Text style={{ color: "white", fontWeight: "bold" }}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ---- UI colors for filter controls ----
  const filterBg = isDarkmode ? "#111827" : "#FFFFFF";
  const filterBorder = isDarkmode ? "rgba(255,255,255,0.10)" : "#E5E7EB";
  const filterText = isDarkmode ? themeColor.white100 : themeColor.dark;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      enabled
      style={{ flex: 1 }}
    >
      <Layout>
        <TopNav
          middleContent="Transaction List"
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
          <Button
            text="Add New Transaction"
            onPress={() => navigation.navigate("TransactionAdd")}
            style={{ marginBottom: 12 }}
          />

          {/* ✅ Filters row */}
          <View
            style={{
              flexDirection: "row",
              marginBottom: 10,
            }}
          >
            {/* Month filter */}
            <View
              style={{
                flex: 1,
                marginRight: 10,
                backgroundColor: filterBg,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: filterBorder,
                overflow: "hidden",
              }}
            >
              <Text
                style={{
                  paddingTop: 10,
                  paddingHorizontal: 12,
                  fontSize: 12,
                  color: isDarkmode ? "#9CA3AF" : "#6B7280",
                }}
              >
                Month
              </Text>
              <Picker
                selectedValue={selectedMonth}
                onValueChange={(v) => setSelectedMonth(String(v))}
                style={{
                  color: filterText,
                  marginTop: -6,
                }}
                dropdownIconColor={filterText as any}
              >
                {monthOptions.map((k) => (
                  <Picker.Item key={k} label={monthLabel(k)} value={k} />
                ))}
              </Picker>
            </View>

            {/* Category filter */}
            <View
              style={{
                flex: 1,
                marginRight: 10,
                backgroundColor: filterBg,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: filterBorder,
                overflow: "hidden",
              }}
            >
              <Text
                style={{
                  paddingTop: 10,
                  paddingHorizontal: 12,
                  fontSize: 12,
                  color: isDarkmode ? "#9CA3AF" : "#6B7280",
                }}
              >
                Category
              </Text>
              <Picker
                selectedValue={selectedCategory}
                onValueChange={(v) => setSelectedCategory(String(v))}
                style={{
                  color: filterText,
                  marginTop: -6,
                }}
                dropdownIconColor={filterText as any}
              >
                <Picker.Item label="All categories" value="ALL" />
                {categoryOptions
                  .filter((x) => x !== "ALL")
                  .map((c) => (
                    <Picker.Item key={c} label={c} value={c} />
                  ))}
              </Picker>
            </View>
          </View>

          {/* ✅ small reset / result count */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: isDarkmode ? "#9CA3AF" : "#6B7280",
              }}
            >
              Showing {filteredTransactions.length} / {transactions.length}
            </Text>

            <TouchableOpacity
              onPress={() => {
                setSelectedMonth("ALL");
                setSelectedCategory("ALL");
              }}
            >
              <Text
                style={{ fontSize: 12, color: "#3B82F6", fontWeight: "bold" }}
              >
                Reset filters
              </Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <Text>Loading...</Text>
          ) : filteredTransactions.length === 0 ? (
            <Text>No transactions found.</Text>
          ) : (
            <SwipeListView
              data={filteredTransactions}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              renderHiddenItem={renderHiddenItem}
              rightOpenValue={-150}
              disableRightSwipe
              closeOnRowPress
              contentContainerStyle={{ paddingBottom: 20 }}
            />
          )}
        </View>
      </Layout>
    </KeyboardAvoidingView>
  );
}
