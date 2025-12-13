import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  Section,
  Button,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  Timestamp,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { BarChart, LineChart } from "react-native-chart-kit";

type Props = NativeStackScreenProps<MainStackParamList, "WeeklySummary">;

type DayStat = {
  label: string;
  fullDate: string; // YYYY-MM-DD
  workouts: number;
  workoutMinutes: number;
  meals: number;
  waterMl: number;
};

const screenWidth = Dimensions.get("window").width;

// --- Vibrant Palette ---
const COLOR_ACTIVE = "#3B82F6"; // Blue
const COLOR_WORKOUT = "#8B5CF6"; // Purple
const COLOR_MEAL = "#F97316"; // Orange
const COLOR_WATER = "#0EA5E9"; // Sky Blue
const COLOR_TIP = "#F59E0B"; // Amber

function last7Days(): DayStat[] {
  const days: DayStat[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push({
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      fullDate: d.toISOString().slice(0, 10),
      workouts: 0,
      workoutMinutes: 0,
      meals: 0,
      waterMl: 0,
    });
  }
  return days;
}

export default function WeeklySummaryScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const [stats, setStats] = useState<DayStat[]>(last7Days());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // --- Data Loading Logic ---
  const loadData = useCallback(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return () => {};
    }

    const base = last7Days();
    const startWindow = new Date();
    startWindow.setDate(startWindow.getDate() - 6);
    startWindow.setHours(0, 0, 0, 0);
    const startTs = Timestamp.fromDate(startWindow);

    let workoutAgg: Record<string, { workouts: number; minutes: number }> = {};
    let mealAgg: Record<string, { meals: number; waterMl: number }> = {};

    const recompute = () => {
      const merged = base.map((d) => ({
        ...d,
        workouts: workoutAgg[d.fullDate]?.workouts || 0,
        workoutMinutes: workoutAgg[d.fullDate]?.minutes || 0,
        meals: mealAgg[d.fullDate]?.meals || 0,
        waterMl: mealAgg[d.fullDate]?.waterMl || 0,
      }));
      setStats(merged);
      setLoading(false);
      setRefreshing(false);
    };

    // 1. Workouts Query
    const workoutQ = query(
      collection(db, "WorkoutSession"),
      where("userId", "==", user.uid),
      where("createdAtClient", ">=", startTs),
      orderBy("createdAtClient", "asc")
    );

    const unsubWorkouts = onSnapshot(workoutQ, (wSnap) => {
      workoutAgg = {};
      wSnap.forEach((doc) => {
        const data: any = doc.data();
        if (data.status !== "completed" || !data.createdAtClient?.toDate)
          return;

        const dateStr = data.createdAtClient
          .toDate()
          .toISOString()
          .slice(0, 10);
        const mins =
          typeof data.actualDurationSec === "number"
            ? Math.round(data.actualDurationSec / 60)
            : 0;

        if (!workoutAgg[dateStr])
          workoutAgg[dateStr] = { workouts: 0, minutes: 0 };
        workoutAgg[dateStr].workouts += 1;
        workoutAgg[dateStr].minutes += mins;
      });
      recompute();
    });

    // 2. Meals Query
    const mealQ = query(
      collection(db, "MealEntry"),
      where("userId", "==", user.uid),
      where("mealTimeClient", ">=", startTs),
      orderBy("mealTimeClient", "asc")
    );

    const unsubMeals = onSnapshot(mealQ, (mSnap) => {
      mealAgg = {};
      mSnap.forEach((doc) => {
        const data: any = doc.data();
        if (!data.mealTimeClient?.toDate) return;

        const dateStr = data.mealTimeClient.toDate().toISOString().slice(0, 10);
        if (!mealAgg[dateStr]) mealAgg[dateStr] = { meals: 0, waterMl: 0 };

        if (data.isWater) {
          mealAgg[dateStr].waterMl +=
            typeof data.volumeMl === "number" ? data.volumeMl : 0;
        } else {
          mealAgg[dateStr].meals += 1;
        }
      });
      recompute();
    });

    return () => {
      unsubWorkouts();
      unsubMeals();
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    const unsub = loadData();
    return unsub;
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  };

  // --- Derived Data ---
  const labels = stats.map((d) => d.label);
  const dataMinutes = stats.map((d) => d.workoutMinutes);
  const dataMeals = stats.map((d) => d.meals);
  const dataWaterCups = stats.map((d) => Math.round(d.waterMl / 250));

  const totalMinutes = dataMinutes.reduce((a, b) => a + b, 0);
  const totalWorkouts = stats.reduce((a, b) => a + b.workouts, 0);
  const totalMeals = dataMeals.reduce((a, b) => a + b, 0);
  const totalWaterMl = stats.reduce((a, b) => a + b.waterMl, 0);
  const dailyAvgMinutes = Math.round(totalMinutes / 7);

  const bestDay = useMemo(() => {
    if (totalMinutes === 0) return "None";
    const max = Math.max(...dataMinutes);
    const idx = dataMinutes.indexOf(max);
    return stats[idx]?.label || "-";
  }, [dataMinutes, totalMinutes, stats]);

  // --- Chart Config Helper ---
  const getChartConfig = (colorHex: string) => ({
    backgroundGradientFrom: isDarkmode ? "#1F2937" : "#ffffff",
    backgroundGradientTo: isDarkmode ? "#1F2937" : "#ffffff",
    fillShadowGradientFrom: colorHex,
    fillShadowGradientTo: colorHex,
    decimalPlaces: 0,
    color: (opacity = 1) => colorHex,
    labelColor: (opacity = 1) =>
      isDarkmode ? `rgba(255,255,255,${opacity})` : `rgba(0,0,0,0.5)`,
    style: { borderRadius: 16 },
    propsForDots: { r: "4", strokeWidth: "2", stroke: colorHex },
    barPercentage: 0.6,
  });

  return (
    <Layout>
      <TopNav
        middleContent="Weekly Trends"
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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLOR_ACTIVE} />
          <Text style={{ marginTop: 10 }}>Analyzing Data...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* Header */}
          <View style={{ marginBottom: 16 }}>
            <Text size="h3" fontWeight="bold">
              Last 7 Days
            </Text>
            <Text style={{ opacity: 0.5 }}>Your fitness at a glance</Text>
          </View>

          {/* Highlights Row 1 */}
          <View style={styles.highlightRow}>
            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#EFF6FF" },
              ]}
            >
              <Ionicons name="time" size={24} color={COLOR_ACTIVE} />
              <Text fontWeight="bold" size="h4" style={{ marginTop: 8 }}>
                {totalMinutes}m
              </Text>
              <Text style={styles.highlightLabel}>Active Time</Text>
            </View>

            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#F5F3FF" },
              ]}
            >
              <Ionicons name="barbell" size={24} color={COLOR_WORKOUT} />
              <Text fontWeight="bold" size="h4" style={{ marginTop: 8 }}>
                {totalWorkouts}
              </Text>
              <Text style={styles.highlightLabel}>Workouts</Text>
            </View>

            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#FFF7ED" },
              ]}
            >
              <Ionicons name="restaurant" size={24} color={COLOR_MEAL} />
              <Text fontWeight="bold" size="h4" style={{ marginTop: 8 }}>
                {totalMeals}
              </Text>
              <Text style={styles.highlightLabel}>Meals</Text>
            </View>
          </View>

          {/* Highlights Row 2 */}
          <View style={styles.highlightRow}>
            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#E0F2FE" },
              ]}
            >
              <Ionicons name="water" size={24} color={COLOR_WATER} />
              <Text fontWeight="bold" size="h4" style={{ marginTop: 8 }}>
                {totalWaterMl}ml
              </Text>
              <Text style={styles.highlightLabel}>Hydration</Text>
            </View>

            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#F3F4F6" },
              ]}
            >
              <Ionicons name="trophy" size={24} color="#F59E0B" />
              <Text fontWeight="bold" size="h4" style={{ marginTop: 8 }}>
                {bestDay}
              </Text>
              <Text style={styles.highlightLabel}>Best Day</Text>
            </View>

            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#F3F4F6" },
              ]}
            >
              <Ionicons name="pulse" size={24} color="#10B981" />
              <Text fontWeight="bold" size="h4" style={{ marginTop: 8 }}>
                {dailyAvgMinutes}m
              </Text>
              <Text style={styles.highlightLabel}>Daily Avg</Text>
            </View>
          </View>

          {/* Coach Tip Insight */}
          <Section style={[styles.tipCard, { borderColor: COLOR_TIP }]}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <View
                style={[
                  styles.tipIconBox,
                  {
                    backgroundColor: isDarkmode
                      ? "rgba(245, 158, 11, 0.2)"
                      : "#FEF3C7",
                  },
                ]}
              >
                <Ionicons name="bulb" size={24} color={COLOR_TIP} />
              </View>
              <View style={{ flex: 1 }}>
                <Text fontWeight="bold" style={{ marginBottom: 4 }}>
                  Weekly Insight
                </Text>
                <Text style={{ opacity: 0.8, lineHeight: 20 }}>
                  {totalWorkouts === 0
                    ? "Your week is a blank canvas. Even a 5-minute warm-up today counts as a win!"
                    : totalWorkouts < 3
                    ? "You've made a start! Try to squeeze in one more quick session to build consistency."
                    : "You are crushing it! Remember to balance high intensity with good rest and hydration."}
                </Text>
              </View>
            </View>
          </Section>

          {/* Chart 1: Activity */}
          <Section style={styles.chartSection}>
            <View style={styles.chartHeader}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Ionicons name="analytics" size={20} color={COLOR_ACTIVE} />
                <Text fontWeight="bold">Activity Trend</Text>
              </View>
              <Text style={{ fontSize: 10, opacity: 0.5 }}>MINUTES</Text>
            </View>

            {totalMinutes === 0 ? (
              <View style={styles.emptyChart}>
                <Text style={{ opacity: 0.5 }}>No activity recorded yet.</Text>
                <Button
                  text="Start First Workout"
                  size="sm"
                  style={{ marginTop: 10 }}
                  onPress={() => navigation.navigate("WorkoutSession")}
                />
              </View>
            ) : (
              <LineChart
                data={{ labels, datasets: [{ data: dataMinutes }] }}
                width={screenWidth - 48}
                height={200}
                yAxisLabel="" // Mandatory for some versions
                yAxisSuffix="" // Mandatory for some versions
                chartConfig={getChartConfig(COLOR_ACTIVE)}
                bezier
                style={{ borderRadius: 12, marginVertical: 8 }}
                withInnerLines={true}
                withOuterLines={false}
              />
            )}
          </Section>

          {/* Chart 2: Meals */}
          <Section style={styles.chartSection}>
            <View style={styles.chartHeader}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Ionicons name="restaurant" size={20} color={COLOR_MEAL} />
                <Text fontWeight="bold">Meal Frequency</Text>
              </View>
              <Text style={{ fontSize: 10, opacity: 0.5 }}>COUNT</Text>
            </View>

            {totalMeals === 0 ? (
              <View style={styles.emptyChart}>
                <Text style={{ opacity: 0.5 }}>No meals logged.</Text>
                <Button
                  text="Log a Meal"
                  size="sm"
                  status="warning"
                  style={{ marginTop: 10 }}
                  onPress={() => navigation.navigate("LogMeal")}
                />
              </View>
            ) : (
              <BarChart
                data={{ labels, datasets: [{ data: dataMeals }] }}
                width={screenWidth - 48}
                height={200}
                yAxisLabel="" // Mandatory Fix
                yAxisSuffix="" // Mandatory Fix
                chartConfig={getChartConfig(COLOR_MEAL)}
                style={{ borderRadius: 12, marginVertical: 8 }}
                fromZero
                showBarTops={false}
                withInnerLines={true}
              />
            )}
          </Section>

          {/* Chart 3: Hydration */}
          <Section style={styles.chartSection}>
            <View style={styles.chartHeader}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Ionicons name="water" size={20} color={COLOR_WATER} />
                <Text fontWeight="bold">Water Intake</Text>
              </View>
              <Text style={{ fontSize: 10, opacity: 0.5 }}>CUPS (~250ml)</Text>
            </View>

            {totalWaterMl === 0 ? (
              <View style={styles.emptyChart}>
                <Text style={{ opacity: 0.5 }}>No water logged.</Text>
              </View>
            ) : (
              <BarChart
                data={{ labels, datasets: [{ data: dataWaterCups }] }}
                width={screenWidth - 48}
                height={200}
                yAxisLabel="" // Mandatory Fix
                yAxisSuffix="" // Mandatory Fix
                chartConfig={getChartConfig(COLOR_WATER)}
                style={{ borderRadius: 12, marginVertical: 8 }}
                fromZero
                showBarTops={false}
                withInnerLines={true}
              />
            )}
          </Section>
        </ScrollView>
      )}
    </Layout>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },

  highlightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  highlightCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    // Subtle shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  highlightLabel: {
    fontSize: 10,
    opacity: 0.6,
    textTransform: "uppercase",
    marginTop: 2,
    fontWeight: "600",
  },

  tipCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
  },
  tipIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  chartSection: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  emptyChart: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
    borderStyle: "dashed",
  },
});
