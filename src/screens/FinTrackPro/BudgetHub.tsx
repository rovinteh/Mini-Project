// app/screens/FinTrackPro/BudgetHub.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Modal,
  Alert,
  Linking,
  ActivityIndicator,
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

// location
import * as Location from "expo-location";

type Props = NativeStackScreenProps<MainStackParamList, "BudgetHub">;

const MONTH_KEY = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const DAY_KEY = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

// ✅ Your hotspot PC IP (keep it correct)
const API_HOST =
  Platform.OS === "web"
    ? "http://localhost:11434"
    : "http://192.168.68.118:11434";

const OLLAMA_MODEL = "gemma3:1b";

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

  // location states
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string>("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [placeText, setPlaceText] = useState<string>("");

  // ✅ AI Goal-Based Saving Planner states
  const [goalName, setGoalName] = useState<string>("");
  const [goalAmount, setGoalAmount] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>(""); // YYYY-MM-DD
  const [aiSavingPlan, setAiSavingPlan] = useState<string>("");
  const [aiSavingLoading, setAiSavingLoading] = useState<boolean>(false);

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

  const sanitizePlainText = (s: string) => {
    if (!s) return "";
    let t = String(s);

    // Remove markdown bold/italics/code markers & common bullet symbols
    t = t.replace(/\*\*/g, "");
    t = t.replace(/__/g, "");
    t = t.replace(/```/g, "");
    t = t.replace(/`/g, "");
    t = t.replace(/^(\s*[•●▪︎◦]\s*)/gm, "- ");
    t = t.replace(/^\s*\*\s+/gm, "- ");
    t = t.replace(/^\s*•\s+/gm, "- ");

    // Keep it readable
    t = t.replace(/\n{3,}/g, "\n\n").trim();
    return t;
  };

  const parseYmdLocal = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map((x) => Number(x));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  };

  const ceilTo2 = (n: number) => Math.ceil(n * 100) / 100;

  const diffDays = (from: Date, to: Date) => {
    const ms = to.getTime() - from.getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
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

  // low balance detection
  const isLowBalance = useMemo(() => {
    if (!hasBudget) return false;
    const remaining = budgetRemaining ?? 0;
    const ratioLeft = budgetLimit! > 0 ? remaining / budgetLimit! : 0;
    return remaining <= 0 || ratioLeft <= 0.15;
  }, [hasBudget, budgetRemaining, budgetLimit]);

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
      Alert.alert("Saved", `Budget limit set to RM ${val.toFixed(2)}.`);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save budget.");
    }
  };

  // fetch user location for suggestions
  const fetchLocation = async () => {
    try {
      setLocError("");
      setLocLoading(true);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocError("Location permission denied.");
        return;
      }

      const pos = await Location.getCurrentPositionAsync({});
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      setCoords({ lat, lng });

      const places = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });
      const p = places?.[0];

      const city =
        p?.city || p?.subregion || p?.district || p?.region || p?.country || "";
      const region = p?.region || p?.country || "";
      const label = city
        ? `${city}${region && region !== city ? ", " + region : ""}`
        : "Your area";

      setPlaceText(label);
    } catch (e: any) {
      setLocError(e?.message ?? "Failed to get location.");
    } finally {
      setLocLoading(false);
    }
  };

  const partTimeKeywords = useMemo(
    () => [
      "part time barista",
      "part time promoter",
      "part time cashier",
      "grabfood rider",
      "tuition teacher",
      "event crew",
      "warehouse packer",
      "retail assistant",
    ],
    []
  );

  const openMapsSearch = async (keyword: string) => {
    const q = encodeURIComponent(`${keyword} near ${placeText || "me"}`);
    const url = `https://www.google.com/maps/search/?api=1&query=${q}`;
    await Linking.openURL(url);
  };

  const openGoogleSearch = async (keyword: string) => {
    const q = encodeURIComponent(`${keyword} ${placeText || ""}`);
    const url = `https://www.google.com/search?q=${q}`;
    await Linking.openURL(url);
  };

  // Auto fetch location when low balance
  useEffect(() => {
    if (isLowBalance && !coords && !locLoading) {
      fetchLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLowBalance]);

  // ✅ AI Goal-Based Saving Planner (accurate date math in code)
  const generateSavingPlanWithAi = useCallback(async () => {
    const goal = goalName.trim();
    const amt = Number(goalAmount);
    const dateStr = targetDate.trim();

    if (!goal) {
      Alert.alert("Missing", "Please enter a goal name.");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert("Invalid", "Please enter a valid target amount (RM).");
      return;
    }
    if (!dateStr) {
      Alert.alert("Missing", "Please enter a target date (YYYY-MM-DD).");
      return;
    }

    const target = parseYmdLocal(dateStr);
    if (!target) {
      Alert.alert(
        "Invalid date",
        "Use format YYYY-MM-DD (example: 2026-02-01)."
      );
      return;
    }

    const today = new Date();
    const todayLocal = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      0,
      0,
      0,
      0
    );

    const daysLeft = diffDays(todayLocal, target);
    if (daysLeft <= 0) {
      Alert.alert("Target date", "Target date must be in the future.");
      return;
    }

    const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
    const monthsLeft = Math.max(1, Math.ceil(daysLeft / 30.4375));
    const weeklyRM = ceilTo2(amt / weeksLeft);
    const monthlyRM = ceilTo2(amt / monthsLeft);

    try {
      setAiSavingLoading(true);
      setAiSavingPlan("");

      const payload = {
        currency: "MYR",
        currencySymbol: "RM",

        today: todayLocal.toISOString().slice(0, 10),
        targetDate: dateStr,
        daysLeft,
        weeksLeft,
        monthsLeft,
        targetAmountRM: Number(amt.toFixed(2)),
        recommendedWeeklyRM: weeklyRM,
        recommendedMonthlyRM: monthlyRM,

        currentMonth: monthKey,
        totalIncomeThisMonth: Number(incomeTotal.toFixed(2)),
        totalExpenseThisMonth: Number(expenseTotal.toFixed(2)),
        balanceThisMonth: Number(balance.toFixed(2)),
        hasBudget: !!hasBudget,
        budgetLimit: hasBudget ? Number(budgetLimit!.toFixed(2)) : null,
        budgetRemaining: hasBudget
          ? Number((budgetRemaining ?? 0).toFixed(2))
          : null,

        goalName: goal,
      };

      const prompt = `
You are a personal finance assistant for a Malaysian student.

IMPORTANT RULES:
- Currency is Malaysian Ringgit (RM / MYR). Do NOT use "$".
- Do NOT use Markdown. No **bold**, no bullet symbols like "•", no numbering.
- Use plain text only.
- Output format: 6 to 10 short lines. Each line must start with "- ".

CRITICAL:
- DO NOT recalculate dates/weeks/months.
- Use the provided daysLeft/weeksLeft/monthsLeft and recommendedWeeklyRM/recommendedMonthlyRM exactly.

TASK:
Using the JSON, write a goal-based saving plan:
- State the time left (weeks/months) using the given values
- State weekly + monthly saving amounts (RM) using the given values
- Give 2–3 practical adjustments based on budgetRemaining/spending
- If budgetRemaining is low, suggest a smaller starter plan for the first 2–4 weeks

DATA (JSON):
${JSON.stringify(payload, null, 2)}
      `.trim();

      const res = await fetch(API_HOST + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      });

      if (!res.ok) throw new Error(`Ollama error ${res.status}`);
      const data = await res.json();

      const txt = sanitizePlainText(data?.response || "");
      setAiSavingPlan(txt || "No response from AI.");
    } catch (e: any) {
      setAiSavingPlan("AI Error: " + (e?.message || String(e)));
    } finally {
      setAiSavingLoading(false);
    }
  }, [
    goalName,
    goalAmount,
    targetDate,
    monthKey,
    incomeTotal,
    expenseTotal,
    balance,
    hasBudget,
    budgetLimit,
    budgetRemaining,
  ]);

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
            <View style={{ paddingVertical: 30, alignItems: "center" }}>
              <ActivityIndicator />
              <Text style={{ marginTop: 10 }}>Loading...</Text>
            </View>
          ) : (
            <>
              <Text size="h3" fontWeight="bold" style={{ marginBottom: 10 }}>
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
                <Text size="h3" fontWeight="bold" style={{ color: "green" }}>
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
                <Text size="h3" fontWeight="bold" style={{ color: "red" }}>
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
                <Text size="h3" fontWeight="bold">
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
                  <Text size="h3" fontWeight="bold">
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

              {/* ✅ AI Goal-Based Saving Planner */}
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
                <Text size="h3" fontWeight="bold">
                  AI Goal-Based Saving Planner
                </Text>
                <Text style={{ marginTop: 6, opacity: 0.85 }}>
                  Enter a saving goal and AI will suggest weekly/monthly savings
                  (RM) to reach your target date.
                </Text>

                <Text style={{ marginTop: 12, opacity: 0.85 }}>Goal name</Text>
                <TextInput
                  containerStyle={{ marginTop: 10 }}
                  placeholder="e.g. Thailand trip"
                  value={goalName}
                  onChangeText={setGoalName}
                />

                <Text style={{ marginTop: 12, opacity: 0.85 }}>
                  Target amount (RM)
                </Text>
                <TextInput
                  containerStyle={{ marginTop: 10 }}
                  placeholder="e.g. 1500"
                  keyboardType="numeric"
                  value={goalAmount}
                  onChangeText={setGoalAmount}
                />

                <Text style={{ marginTop: 12, opacity: 0.85 }}>
                  Target date (YYYY-MM-DD)
                </Text>
                <TextInput
                  containerStyle={{ marginTop: 10 }}
                  placeholder="e.g. 2026-02-01"
                  value={targetDate}
                  onChangeText={setTargetDate}
                />

                <Button
                  text={
                    aiSavingLoading
                      ? "Generating..."
                      : "Generate Saving Plan (AI)"
                  }
                  onPress={generateSavingPlanWithAi}
                  disabled={aiSavingLoading}
                  style={{ marginTop: 14 }}
                />

                <View style={{ marginTop: 12 }}>
                  <Text style={{ opacity: 0.9 }}>
                    {aiSavingPlan
                      ? aiSavingPlan
                      : "Your saving plan will appear here after generating."}
                  </Text>
                </View>
              </View>

              {/* Low-Balance Support */}
              {hasBudget ? (
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
                      justifyContent: "space-between",
                    }}
                  >
                    <Text size="h3" fontWeight="bold">
                      Low-Balance Support
                    </Text>

                    <Button
                      text={locLoading ? "..." : "Refresh"}
                      size="sm"
                      style={{ width: 95 }}
                      onPress={fetchLocation}
                      disabled={locLoading}
                    />
                  </View>

                  {!isLowBalance ? (
                    <Text style={{ marginTop: 8, opacity: 0.85 }}>
                      ✅ Budget is healthy. Suggestions will appear when balance
                      becomes low.
                    </Text>
                  ) : (
                    <>
                      <Text style={{ marginTop: 8, opacity: 0.9 }}>
                        ⚠️ Your remaining budget is low. Here are nearby
                        part-time ideas.
                      </Text>

                      <Text style={{ marginTop: 8, opacity: 0.85 }}>
                        📍 Area:{" "}
                        <Text fontWeight="bold">
                          {placeText ||
                            (locLoading ? "Detecting..." : "Unknown")}
                        </Text>
                      </Text>

                      {locError ? (
                        <Text style={{ marginTop: 8, color: "red" }}>
                          {locError}
                        </Text>
                      ) : null}

                      <View style={{ marginTop: 10 }}>
                        {partTimeKeywords.slice(0, 5).map((k) => (
                          <View key={k} style={{ marginBottom: 10 }}>
                            <Text style={{ marginBottom: 6 }}>💡 {k}</Text>
                            <View style={{ flexDirection: "row" }}>
                              <Button
                                text="Maps"
                                size="sm"
                                style={{ flex: 1, marginRight: 10 }}
                                onPress={() => openMapsSearch(k)}
                              />
                              <Button
                                text="Search"
                                size="sm"
                                style={{
                                  flex: 1,
                                  backgroundColor: isDarkmode
                                    ? themeColor.dark200
                                    : "#e5e7eb",
                                }}
                                textStyle={{
                                  color: isDarkmode
                                    ? themeColor.white100
                                    : themeColor.dark,
                                }}
                                onPress={() => openGoogleSearch(k)}
                              />
                            </View>
                          </View>
                        ))}
                      </View>

                      <Text
                        style={{ marginTop: 6, opacity: 0.8, fontSize: 12 }}
                      >
                        Tip: Use “Maps” to find jobs near you faster.
                      </Text>
                    </>
                  )}
                </View>
              ) : null}

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
                <Text size="h3" fontWeight="bold">
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

              <View style={{ flexDirection: "row", marginTop: 14 }}>
                <Button
                  text="Cancel"
                  onPress={() => setShowBudgetModal(false)}
                  style={{
                    flex: 1,
                    marginRight: 10,
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
