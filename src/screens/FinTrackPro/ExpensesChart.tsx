import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  ActivityIndicator,
  Dimensions,
  Platform,
  ScrollView,
} from "react-native";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  Button,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { LineChart } from "react-native-chart-kit";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import * as Print from "expo-print";
import { shareAsync } from "expo-sharing";

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_SHORT = [
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

// ✅ Your hotspot PC IP (keep it correct)
const API_HOST =
  Platform.OS === "web"
    ? "http://localhost:11434"
    : "http://192.168.68.118:11434";

const OLLAMA_MODEL = "gemma3:1b";

type Tx = {
  amount: number;
  type: "income" | "expense";
  category?: string;
  note?: string;
  transactionDate: number;
};

type Anomaly = {
  id: string;
  dateMs: number;
  category: string;
  amount: number;
  baselineAvg: number;
  ratio: number;
  note?: string;
};

export default function ({
  navigation,
}: NativeStackScreenProps<MainStackParamList, "ExpensesChart">) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const [chartData, setChartData] = useState<number[]>(new Array(12).fill(0));
  const [loading, setLoading] = useState(true);

  const [transactions, setTransactions] = useState<Tx[]>([]);

  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [aiAnomalyText, setAiAnomalyText] = useState<string>("");
  const [aiAnomalyLoading, setAiAnomalyLoading] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, "Transactions"),
      where("CreatedUser.CreatedUserId", "==", auth.currentUser.uid)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const monthlyTotals = new Array(12).fill(0);
      const txs: Tx[] = [];

      snapshot.forEach((docSnap) => {
        const d: any = docSnap.data();
        if (!d.transactionDate || !d.amount || !d.type) return;

        const tx: Tx = {
          amount: Number(d.amount) || 0,
          type: d.type,
          category: d.category || "Uncategorized",
          note: d.note || "",
          transactionDate: Number(d.transactionDate),
        };

        txs.push(tx);

        const date = new Date(tx.transactionDate);
        const monthIndex = date.getMonth();
        if (tx.type === "expense") monthlyTotals[monthIndex] += tx.amount;
      });

      setTransactions(txs);
      setChartData(monthlyTotals);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  // ---------- PDF ----------
  const buildHtml = () => {
    const rows = MONTH_LABELS.map((month, i) => {
      const value = chartData[i] ?? 0;
      return `<tr>
        <td style="padding:8px;border:1px solid #ccc;">${month}</td>
        <td style="padding:8px;border:1px solid #ccc; text-align:right;">RM ${value.toFixed(
          2
        )}</td>
      </tr>`;
    }).join("");

    return `
    <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:16px;">
        <h1 style="text-align:center;">FinTrack Pro – Monthly Expenses</h1>
        <p style="text-align:center;">Summary of total expenses for each month.</p>
        <table style="width:100%; border-collapse:collapse; margin-top:16px;">
          <thead>
            <tr>
              <th style="padding:8px;border:1px solid #ccc;text-align:left;">Month</th>
              <th style="padding:8px;border:1px solid #ccc;text-align:right;">Total Expense (RM)</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>`;
  };

  const printToPdf = async () => {
    try {
      const html = buildHtml();
      const { uri } = await Print.printToFileAsync({ html });
      await shareAsync(uri, { UTI: ".pdf", mimeType: "application/pdf" });
    } catch (e) {
      console.warn("Failed to print PDF:", e);
    }
  };

  // ---------- Month helpers ----------
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const prevMonth = prevMonthDate.getMonth();
  const prevYear = prevMonthDate.getFullYear();

  const isSameMonth = (ms: number, y: number, m: number) => {
    const d = new Date(ms);
    return d.getFullYear() === y && d.getMonth() === m;
  };

  const expensesThisMonth = useMemo(
    () =>
      transactions.filter(
        (t) =>
          t.type === "expense" &&
          isSameMonth(t.transactionDate, currentYear, currentMonth)
      ),
    [transactions]
  );

  const expensesPrevMonth = useMemo(
    () =>
      transactions.filter(
        (t) =>
          t.type === "expense" &&
          isSameMonth(t.transactionDate, prevYear, prevMonth)
      ),
    [transactions]
  );

  const sum = (arr: Tx[]) =>
    arr.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

  const thisTotal = useMemo(() => sum(expensesThisMonth), [expensesThisMonth]);
  const prevTotal = useMemo(() => sum(expensesPrevMonth), [expensesPrevMonth]);
  const delta = thisTotal - prevTotal;
  const deltaPct =
    prevTotal <= 0 ? null : Math.round((delta / prevTotal) * 100);

  // ---------- Grouping ----------
  const groupByCategory = (arr: Tx[]) => {
    const map: Record<string, number> = {};
    arr.forEach((t) => {
      const cat = t.category || "Uncategorized";
      map[cat] = (map[cat] || 0) + (Number(t.amount) || 0);
    });
    return map;
  };

  const topN = (obj: Record<string, number>, n = 3) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => ({ category: k, total: v }));

  // ---------- AI summary ----------
  const generateAiSummary = async () => {
    try {
      setAiSummaryLoading(true);
      setAiSummary("");

      const byCatThis = groupByCategory(expensesThisMonth);
      const byCatPrev = groupByCategory(expensesPrevMonth);

      const topThis = topN(byCatThis, 3);

      const changes = topThis.map((x) => {
        const prev = byCatPrev[x.category] || 0;
        const diff = x.total - prev;
        const pct = prev <= 0 ? null : Math.round((diff / prev) * 100);
        return {
          category: x.category,
          thisMonth: Number(x.total.toFixed(2)),
          prevMonth: Number(prev.toFixed(2)),
          diff: Number(diff.toFixed(2)),
          pctChange: pct,
        };
      });

      const summaryJson = {
        period: `${MONTH_LABELS[currentMonth]} ${currentYear}`,
        prevPeriod: `${MONTH_LABELS[prevMonth]} ${prevYear}`,
        totalExpenseThisMonth: Number(thisTotal.toFixed(2)),
        totalExpensePrevMonth: Number(prevTotal.toFixed(2)),
        delta: Number(delta.toFixed(2)),
        deltaPct: deltaPct,
        topCategoriesThisMonth: topThis.map((x) => ({
          category: x.category,
          total: Number(x.total.toFixed(2)),
        })),
        categoryChangesForTop: changes,
        transactionCountThisMonth: expensesThisMonth.length,
      };

      const prompt = `
You are a personal finance assistant.
Write a short "AI Insight Summary" in 3-6 bullet points.
Rules:
- Use simple student-friendly English.
- Mention overall trend (up/down), top categories, and one practical suggestion.
- Do NOT invent numbers. Only use numbers from the JSON.
- Bullet points only.

DATA (JSON):
${JSON.stringify(summaryJson, null, 2)}
      `.trim();

      const res = await fetch(API_HOST + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      });

      if (!res.ok) throw new Error(`Ollama error ${res.status}`);
      const data = await res.json();
      setAiSummary(data.response || "");
    } catch (e: any) {
      setAiSummary("Error generating AI summary: " + (e?.message || String(e)));
    } finally {
      setAiSummaryLoading(false);
    }
  };

  // ---------- Anomaly ----------
  const detectAnomalies = () => {
    const allExpense = transactions.filter(
      (t) => t.type === "expense" && t.amount > 0
    );

    const totals: Record<string, { sum: number; count: number }> = {};
    allExpense.forEach((t) => {
      const cat = t.category || "Uncategorized";
      totals[cat] = totals[cat] || { sum: 0, count: 0 };
      totals[cat].sum += t.amount;
      totals[cat].count += 1;
    });

    const avgByCat: Record<string, number> = {};
    Object.keys(totals).forEach((cat) => {
      avgByCat[cat] =
        totals[cat].count > 0 ? totals[cat].sum / totals[cat].count : 0;
    });

    const found: Anomaly[] = [];

    expensesThisMonth.forEach((t, idx) => {
      const cat = t.category || "Uncategorized";
      const baselineAvg = avgByCat[cat] || 0;

      if (baselineAvg > 0 && t.amount >= 30 && t.amount >= baselineAvg * 2.5) {
        found.push({
          id: `${t.transactionDate}-${cat}-${idx}`,
          dateMs: t.transactionDate,
          category: cat,
          amount: Number(t.amount.toFixed(2)),
          baselineAvg: Number(baselineAvg.toFixed(2)),
          ratio: Number((t.amount / baselineAvg).toFixed(2)),
          note: t.note || "",
        });
      }
    });

    found.sort((a, b) => b.ratio - a.ratio);

    setAnomalies(found);
    return found;
  };

  const explainAnomaliesWithAi = async () => {
    try {
      setAiAnomalyLoading(true);
      setAiAnomalyText("");

      const found = detectAnomalies();

      if (found.length === 0) {
        setAiAnomalyText(
          "No unusual spending spikes detected for this month ✅"
        );
        return;
      }

      const payload = {
        period: `${MONTH_LABELS[currentMonth]} ${currentYear}`,
        anomalies: found.slice(0, 5).map((a) => ({
          date: new Date(a.dateMs).toLocaleDateString(),
          category: a.category,
          amountRM: a.amount,
          baselineAvgRM: a.baselineAvg,
          ratio: a.ratio,
          note: a.note,
        })),
      };

      const prompt = `
You are a finance assistant.
Explain the anomalies below.
For each anomaly:
- say why it's unusual (compare to baseline average)
- suggest 1-2 possible reasons
- give 1 suggestion to control it
Keep it short. Use bullet points.

ANOMALIES (JSON):
${JSON.stringify(payload, null, 2)}
      `.trim();

      const res = await fetch(API_HOST + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      });

      if (!res.ok) throw new Error(`Ollama error ${res.status}`);
      const data = await res.json();
      setAiAnomalyText(data.response || "");
    } catch (e: any) {
      setAiAnomalyText(
        "Error explaining anomalies: " + (e?.message || String(e))
      );
    } finally {
      setAiAnomalyLoading(false);
    }
  };

  // ---------- UI ----------
  if (loading) {
    return (
      <Layout>
        <TopNav
          middleContent="Expenses Chart"
          leftContent={
            <Ionicons
              name="chevron-back"
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
            />
          }
          leftAction={() => navigation.goBack()}
        />
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator size="large" />
        </View>
      </Layout>
    );
  }

  const screenW = Dimensions.get("window").width;
  const accentBlue = "#3B82F6";
  const cardBg = isDarkmode ? "#111827" : "#FFFFFF";
  const softBg = isDarkmode ? "#0B1220" : "#EEF2FF";
  const border = isDarkmode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const textColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const subText = isDarkmode ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.6)";

  const StatCard = ({
    title,
    value,
    sub,
    icon,
    color,
  }: {
    title: string;
    value: string;
    sub?: string;
    icon: string;
    color: string;
  }) => (
    <View
      style={{
        flex: 1,
        backgroundColor: cardBg,
        borderWidth: 1,
        borderColor: border,
        borderRadius: 16,
        padding: 12,
        marginHorizontal: 6,
        shadowColor: "#000",
        shadowOpacity: isDarkmode ? 0.15 : 0.08,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      <Text style={{ color: subText, fontSize: 12 }}>
        {icon} {title}
      </Text>
      <Text
        fontWeight="bold"
        style={{ color: color, fontSize: 18, marginTop: 6 }}
      >
        {value}
      </Text>
      {sub ? (
        <Text style={{ color: subText, fontSize: 12, marginTop: 4 }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );

  const Card = ({ title, children }: { title: string; children: any }) => (
    <View
      style={{
        width: screenW - 32,
        backgroundColor: cardBg,
        borderWidth: 1,
        borderColor: border,
        borderRadius: 18,
        padding: 14,
        marginTop: 12,
        shadowColor: "#000",
        shadowOpacity: isDarkmode ? 0.18 : 0.09,
        shadowRadius: 10,
        elevation: 3,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <Text fontWeight="bold" style={{ color: textColor }}>
          {title}
        </Text>
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            backgroundColor: accentBlue,
            opacity: 0.9,
          }}
        />
      </View>
      {children}
    </View>
  );

  // ✅ scrollable chart width (prevents label overlap)
  const chartWidth = Math.max(screenW - 16, 520);

  return (
    <Layout>
      <TopNav
        middleContent="Expenses Chart"
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
          paddingTop: 10,
          paddingBottom: 28,
          alignItems: "center",
          backgroundColor: softBg,
        }}
      >
        <Text fontWeight="bold" style={{ marginBottom: 10, color: textColor }}>
          {MONTH_LABELS[currentMonth]} {currentYear} Overview
        </Text>

        {/* ✅ Stats row */}
        <View
          style={{ flexDirection: "row", width: screenW - 32, marginBottom: 6 }}
        >
          <StatCard
            title="This Month"
            icon="📅"
            value={`RM ${thisTotal.toFixed(2)}`}
            sub={`${expensesThisMonth.length} tx`}
            color={accentBlue}
          />
          <StatCard
            title="Last Month"
            icon="🕘"
            value={`RM ${prevTotal.toFixed(2)}`}
            sub={`${expensesPrevMonth.length} tx`}
            color={isDarkmode ? "#A78BFA" : "#7C3AED"}
          />
        </View>

        <View
          style={{
            flexDirection: "row",
            width: screenW - 32,
            marginBottom: 10,
          }}
        >
          <StatCard
            title="Change"
            icon={delta >= 0 ? "📈" : "📉"}
            value={`${delta >= 0 ? "+" : ""}RM ${delta.toFixed(2)}`}
            sub={
              deltaPct === null
                ? "No last-month baseline"
                : `${deltaPct >= 0 ? "+" : ""}${deltaPct}%`
            }
            color={delta >= 0 ? "#EF4444" : "#22C55E"}
          />
          <StatCard
            title="Peak Month"
            icon="🏆"
            value={`RM ${Math.max(...chartData).toFixed(2)}`}
            sub={`${MONTH_SHORT[chartData.indexOf(Math.max(...chartData))]}`}
            color={isDarkmode ? "#FBBF24" : "#B45309"}
          />
        </View>

        {/* ✅ Chart Card */}
        <View
          style={{
            width: screenW - 32,
            backgroundColor: cardBg,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: border,
            paddingVertical: 12,
            shadowColor: "#000",
            shadowOpacity: isDarkmode ? 0.18 : 0.09,
            shadowRadius: 10,
            elevation: 3,
          }}
        >
          <View style={{ paddingHorizontal: 14, marginBottom: 8 }}>
            <Text
              fontWeight="bold"
              style={{ color: textColor, marginBottom: 4 }}
            >
              Monthly Total Expense
            </Text>
            <Text style={{ color: subText, fontSize: 12 }}>
              Scroll horizontally if needed ➜
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <LineChart
              data={{
                labels: MONTH_SHORT,
                datasets: [{ data: chartData }],
              }}
              width={chartWidth}
              height={260}
              yAxisLabel="RM "
              fromZero
              bezier
              withVerticalLines={false}
              withOuterLines={false}
              withInnerLines
              verticalLabelRotation={35}
              xLabelsOffset={-8}
              chartConfig={{
                backgroundColor: cardBg,
                backgroundGradientFrom: isDarkmode ? "#0B1220" : "#EEF2FF",
                backgroundGradientTo: isDarkmode ? "#0B1220" : "#E2E8F0",
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, // blue line
                labelColor: (opacity = 1) =>
                  isDarkmode
                    ? `rgba(255,255,255,${opacity})`
                    : `rgba(0,0,0,${opacity})`,
                propsForDots: {
                  r: "4",
                  strokeWidth: "2",
                  stroke: isDarkmode ? "#0B1220" : "#EEF2FF",
                },
                propsForLabels: { fontSize: 10 },
              }}
              style={{
                borderRadius: 16,
                marginHorizontal: 10,
              }}
            />
          </ScrollView>
        </View>

        {/* ✅ AI Insight Summary */}
        <Card title="AI Insight Summary">
          <Button
            text={aiSummaryLoading ? "Generating..." : "Generate Summary"}
            onPress={generateAiSummary}
            disabled={aiSummaryLoading}
            style={{ width: "100%" }}
          />
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: textColor, opacity: 0.9 }}>
              {aiSummary
                ? aiSummary
                : "Tap “Generate Summary” to get insights for this month."}
            </Text>
          </View>
        </Card>

        {/* ✅ Anomaly Detection */}
        <Card title="Anomaly Detection (Spending Spikes)">
          <Button
            text={
              aiAnomalyLoading ? "Analyzing..." : "Detect & Explain Anomalies"
            }
            onPress={explainAnomaliesWithAi}
            disabled={aiAnomalyLoading}
            style={{ width: "100%" }}
          />

          <View style={{ marginTop: 10 }}>
            {anomalies.length > 0 ? (
              anomalies.slice(0, 3).map((a) => (
                <Text key={a.id} style={{ color: textColor, marginBottom: 4 }}>
                  ⚠️ {new Date(a.dateMs).toLocaleDateString()} — {a.category}:
                  RM {a.amount.toFixed(2)} (avg RM {a.baselineAvg.toFixed(2)})
                </Text>
              ))
            ) : (
              <Text style={{ color: textColor, opacity: 0.9 }}>
                No anomalies loaded yet. Tap the button above.
              </Text>
            )}
          </View>

          {aiAnomalyText ? (
            <View style={{ marginTop: 10 }}>
              <Text style={{ color: textColor, opacity: 0.9 }}>
                {aiAnomalyText}
              </Text>
            </View>
          ) : null}
        </Card>

        <Button
          text="Print chart as PDF"
          onPress={printToPdf}
          style={{ marginTop: 16, width: screenW - 32 }}
        />
      </ScrollView>
    </Layout>
  );
}
