// app/screens/FinTrackPro/BudgetHub.tsx
import React, { useEffect, useMemo, useState } from "react";
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
    : "http://10.10.20.66:11434";

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

  // ✅ NEW: AI Saving Planner modal + state
  const [showSavingModal, setShowSavingModal] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState(""); // YYYY-MM-DD

  const [aiPlanLoading, setAiPlanLoading] = useState(false);
  const [aiPlanText, setAiPlanText] = useState("");

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

  const sanitizeAiText = (s: string) => {
    if (!s) return "";
    return (
      s
        // remove markdown bold/italics markers
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/__/g, "")
        .replace(/_/g, "")
        // normalize bullets to "- "
        .replace(/^\s*[-•]\s+/gm, "- ")
        .replace(/^\s*\d+\.\s+/gm, "- ")
        // trim extra whitespace
        .trim()
    );
  };

  // Parse YYYY-MM-DD safely (no timezone shifting)
  const parseYMD = (ymd: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d))
      return null;
    // local noon to avoid DST edge cases
    return new Date(y, mo - 1, d, 12, 0, 0, 0);
  };

  const diffDaysCeil = (from: Date, to: Date) => {
    const MS_DAY = 24 * 60 * 60 * 1000;
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 12);
    return Math.ceil((b.getTime() - a.getTime()) / MS_DAY);
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
      Alert.alert(
        "Saved",
        `Budget limit set to RM ${val.toFixed(2)} for ${monthKey}`
      );
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save budget.");
    }
  };

  // fetch user location
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

  const partTimeKeywords = useMemo(() => {
    return [
      "part time barista",
      "part time promoter",
      "part time cashier",
      "grabfood rider",
      "tuition teacher",
      "event crew",
      "warehouse packer",
      "retail assistant",
    ];
  }, []);

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

  // Auto fetch location when low balance (only once per low period)
  useEffect(() => {
    if (isLowBalance && !coords && !locLoading) {
      fetchLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLowBalance]);

  // ✅ AI Saving Planner: deterministic calculation + AI advice (no numbers)
  const generateSavingPlanAi = async () => {
    try {
      const g = goalName.trim();
      const amt = Number(targetAmount);

      if (!g) {
        Alert.alert("Missing goal", "Please enter a goal name.");
        return;
      }
      if (!Number.isFinite(amt) || amt <= 0) {
        Alert.alert("Invalid amount", "Please enter a valid target amount.");
        return;
      }

      const td = parseYMD(targetDate);
      if (!td) {
        Alert.alert("Invalid date", "Please enter date in YYYY-MM-DD format.");
        return;
      }

      const daysLeft = diffDaysCeil(new Date(), td);
      if (daysLeft <= 0) {
        Alert.alert("Target date passed", "Please choose a future date.");
        return;
      }

      const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
      const monthsLeft = Math.max(1, Math.ceil(daysLeft / 30));

      const weeklySavingRM = amt / weeksLeft;
      const monthlySavingRM = amt / monthsLeft;

      const currentBudgetRemaining =
        typeof budgetRemaining === "number" ? budgetRemaining : null;

      const facts = {
        currency: "MYR",
        currencySymbol: "RM",
        goalName: g,
        targetAmountRM: Number(amt.toFixed(2)),
        targetDate: targetDate.trim(),
        daysLeft,
        weeksLeft,
        monthsLeft,
        budgetLimitRM: hasBudget ? Number(budgetLimit!.toFixed(2)) : null,
        budgetUsedRM: hasBudget ? Number(budgetUsed.toFixed(2)) : null,
        budgetRemainingRM:
          currentBudgetRemaining !== null
            ? Number(currentBudgetRemaining.toFixed(2))
            : null,
        recommendedWeeklySavingRM: Number(weeklySavingRM.toFixed(2)),
        recommendedMonthlySavingRM: Number(monthlySavingRM.toFixed(2)),
      };

      setAiPlanLoading(true);
      setAiPlanText("");

      const prompt = `
You are a personal finance assistant.

IMPORTANT RULES:
- Currency is RM (MYR).
- DO NOT calculate dates/weeks/months/money.
- DO NOT mention any numbers at all.
- DO NOT use Markdown.
- Use plain text only.
- Each line must start with "- "

TASK:
Give general saving advice ONLY (no numbers).
Focus on:
- Motivation
- Spending habits
- One practical saving tip
- One reminder habit
- If budgetRemainingRM is low, suggest reducing discretionary spending

FACTS (JSON):
${JSON.stringify(facts, null, 2)}
`.trim();

      const res = await fetch(API_HOST + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
        }),
      });

      if (!res.ok) throw new Error(`Ollama error ${res.status}`);
      const data = await res.json();

      const adviceOnly = sanitizeAiText(String(data?.response || ""));

      // ✅ You control all numbers (guaranteed correct)
      const finalText =
        `- Goal: ${facts.goalName}
- Target amount: RM ${facts.targetAmountRM.toFixed(2)}
- Target date: ${facts.targetDate}
- Time left: ${facts.daysLeft} day(s) (~${facts.weeksLeft} week(s), ~${
          facts.monthsLeft
        } month(s))
- Weekly saving target: RM ${facts.recommendedWeeklySavingRM.toFixed(2)}
- Monthly saving target: RM ${facts.recommendedMonthlySavingRM.toFixed(2)}
` + (adviceOnly ? `\n${adviceOnly}` : "");

      setAiPlanText(finalText.trim());
    } catch (e: any) {
      setAiPlanText(
        "Error generating saving plan: " + (e?.message ?? String(e))
      );
    } finally {
      setAiPlanLoading(false);
    }
  };

  const bg = isDarkmode ? themeColor.dark : themeColor.white;
  const cardBg = isDarkmode ? themeColor.dark200 : themeColor.white;
  const border = isDarkmode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const subtle = isDarkmode ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.75)";

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
            backgroundColor: bg,
          }}
        >
          {loading ? (
            <View style={{ paddingVertical: 30, alignItems: "center" }}>
              <ActivityIndicator />
              <Text style={{ marginTop: 10, opacity: 0.8 }}>Loading...</Text>
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
                  backgroundColor: cardBg,
                  marginBottom: 12,
                  borderWidth: 1,
                  borderColor: border,
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

              {/* ✅ AI Goal-Based Saving Planner (Objective 1) */}
              <View
                style={{
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: cardBg,
                  marginBottom: 12,
                  borderWidth: 1,
                  borderColor: border,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text size="h3" fontWeight="bold">
                    AI Goal-Based Saving Planner (RM)
                  </Text>
                  <Ionicons
                    name="sparkles"
                    size={18}
                    color={isDarkmode ? "#A78BFA" : "#7C3AED"}
                  />
                </View>

                <Text style={{ marginTop: 8, opacity: 0.85 }}>
                  Create a saving goal (trip / purchase). The system calculates
                  weekly & monthly saving targets, then AI gives advice to stay
                  on track.
                </Text>

                <Button
                  text="Open Saving Planner (AI)"
                  style={{ marginTop: 12 }}
                  onPress={() => {
                    setAiPlanText("");
                    setShowSavingModal(true);
                  }}
                />
              </View>

              {/* Low-Balance Support */}
              {hasBudget ? (
                <View
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    backgroundColor: cardBg,
                    marginBottom: 12,
                    borderWidth: 1,
                    borderColor: border,
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
                  backgroundColor: cardBg,
                  marginBottom: 14,
                  borderWidth: 1,
                  borderColor: border,
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

        {/* ✅ AI Saving Planner Modal */}
        <Modal
          visible={showSavingModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowSavingModal(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.55)",
              justifyContent: "center",
              paddingHorizontal: 18,
            }}
          >
            <View
              style={{
                backgroundColor: isDarkmode
                  ? themeColor.dark
                  : themeColor.white,
                borderRadius: 16,
                padding: 18,
                borderWidth: 1,
                borderColor: border,
                maxHeight: "85%", // ✅ keeps modal within screen
              }}
            >
              {/* ✅ ONLY CHANGE: add ScrollView inside modal to allow long content scrolling */}
              <ScrollView
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text size="h3" fontWeight="bold">
                    AI Saving Planner (RM)
                  </Text>
                  <Ionicons
                    name="sparkles"
                    size={18}
                    color={isDarkmode ? "#A78BFA" : "#7C3AED"}
                  />
                </View>

                <Text style={{ marginTop: 8, opacity: 0.85 }}>
                  Enter your goal and target date. The system will calculate the
                  correct time left and saving targets, then AI will provide
                  tips.
                </Text>

                <Text style={{ marginTop: 12, opacity: 0.9 }}>Goal name</Text>
                <TextInput
                  containerStyle={{ marginTop: 10 }}
                  placeholder="e.g. Thailand trip / New laptop"
                  value={goalName}
                  onChangeText={setGoalName}
                />

                <Text style={{ marginTop: 12, opacity: 0.9 }}>
                  Target amount (RM)
                </Text>
                <TextInput
                  containerStyle={{ marginTop: 10 }}
                  placeholder="e.g. 1500"
                  keyboardType="numeric"
                  value={targetAmount}
                  onChangeText={setTargetAmount}
                />

                <Text style={{ marginTop: 12, opacity: 0.9 }}>
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
                    aiPlanLoading
                      ? "Generating..."
                      : "Generate Saving Plan (AI)"
                  }
                  style={{ marginTop: 14 }}
                  onPress={generateSavingPlanAi}
                  disabled={aiPlanLoading}
                />

                <View style={{ marginTop: 12 }}>
                  {aiPlanLoading ? (
                    <View style={{ paddingVertical: 10, alignItems: "center" }}>
                      <ActivityIndicator />
                      <Text style={{ marginTop: 8, opacity: 0.8 }}>
                        Calling AI...
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ color: subtle }}>
                      {aiPlanText
                        ? aiPlanText
                        : "Your saving plan will appear here."}
                    </Text>
                  )}
                </View>

                <Button
                  text="Close"
                  style={{
                    marginTop: 14,
                    backgroundColor: isDarkmode
                      ? themeColor.dark200
                      : "#e5e7eb",
                    marginBottom: 6, // ✅ small bottom padding inside scroll
                  }}
                  textStyle={{
                    color: isDarkmode ? themeColor.white100 : themeColor.dark,
                  }}
                  onPress={() => setShowSavingModal(false)}
                />
              </ScrollView>
            </View>
          </View>
        </Modal>
      </Layout>
    </KeyboardAvoidingView>
  );
}
