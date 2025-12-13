import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
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
const FITNESS_COLOR = "#22C55E";

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

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setStats(last7Days());

    const now = new Date();
    const startWindow = new Date(now);
    startWindow.setDate(now.getDate() - 6);
    startWindow.setHours(0, 0, 0, 0);
    const startTs = Timestamp.fromDate(startWindow);

    let workoutAgg: Record<string, { workouts: number; minutes: number }> = {};
    let mealAgg: Record<string, { meals: number; waterMl: number }> = {};

    const recompute = () => {
      const base = last7Days();
      base.forEach((d) => {
        const w = workoutAgg[d.fullDate];
        const m = mealAgg[d.fullDate];
        if (w) {
          d.workouts = w.workouts;
          d.workoutMinutes = w.minutes;
        }
        if (m) {
          d.meals = m.meals;
          d.waterMl = m.waterMl;
        }
      });
      setStats(base);
      setLoading(false);
    };

    // Workouts
    const workoutQ = query(
      collection(db, "WorkoutSession"),
      where("userId", "==", user.uid),
      where("createdAtClient", ">=", startTs),
      orderBy("createdAtClient", "asc")
    );

    const unsubWorkouts = onSnapshot(
      workoutQ,
      (wSnap) => {
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
      },
      (error) => {
        console.log("Workout Query Error (Index?):", error);
        setLoading(false);
      }
    );

    // Meals (+ hydration)
    const mealQ = query(
      collection(db, "MealEntry"),
      where("userId", "==", user.uid),
      where("mealTimeClient", ">=", startTs),
      orderBy("mealTimeClient", "asc")
    );

    const unsubMeals = onSnapshot(
      mealQ,
      (mSnap) => {
        mealAgg = {};
        mSnap.forEach((doc) => {
          const data: any = doc.data();
          if (!data.mealTimeClient?.toDate) return;

          const dateStr = data.mealTimeClient
            .toDate()
            .toISOString()
            .slice(0, 10);
          if (!mealAgg[dateStr]) mealAgg[dateStr] = { meals: 0, waterMl: 0 };

          if (data.isWater) {
            mealAgg[dateStr].waterMl +=
              typeof data.volumeMl === "number" ? data.volumeMl : 0;
          } else {
            mealAgg[dateStr].meals += 1;
          }
        });
        recompute();
      },
      (error) => {
        console.log("Meal Query Error (Index?):", error);
        setLoading(false);
      }
    );

    return () => {
      unsubWorkouts();
      unsubMeals();
    };
  }, []);

  // Data prep
  const labels = stats.map((d) => d.label);
  const dataMinutes = stats.map((d) => d.workoutMinutes);
  const dataMeals = stats.map((d) => d.meals);
  const dataWater = stats.map((d) => Math.round(d.waterMl / 250)); // show cups

  const totalMinutes = dataMinutes.reduce((a, b) => a + b, 0);
  const totalWorkouts = stats.reduce((a, b) => a + b.workouts, 0);
  const totalMeals = dataMeals.reduce((a, b) => a + b, 0);
  const totalWaterMl = stats.reduce((a, b) => a + b.waterMl, 0);

  const bestDay = useMemo(() => {
    if (totalMinutes === 0) return "None";
    const max = Math.max(...dataMinutes);
    const idx = dataMinutes.indexOf(max);
    return stats[idx]?.label || "-";
  }, [dataMinutes, totalMinutes, stats]);

  const chartConfig = {
    backgroundGradientFrom: isDarkmode ? "#1F2937" : "#ffffff",
    backgroundGradientTo: isDarkmode ? "#1F2937" : "#ffffff",
    color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
    labelColor: (opacity = 1) =>
      isDarkmode ? `rgba(255,255,255,${opacity})` : `rgba(0,0,0,${opacity})`,
    strokeWidth: 2,
    barPercentage: 0.55,
    decimalPlaces: 0,
  };

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
          <ActivityIndicator size="large" color={FITNESS_COLOR} />
          <Text style={{ marginTop: 10 }}>Syncing activity...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          <Text size="h3" fontWeight="bold" style={{ marginBottom: 16 }}>
            Last 7 Days
          </Text>

          <View style={styles.highlightRow}>
            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#dcfce7" },
              ]}
            >
              <Ionicons name="time" size={20} color={FITNESS_COLOR} />
              <Text fontWeight="bold" size="h4" style={{ marginVertical: 4 }}>
                {totalMinutes}m
              </Text>
              <Text style={{ fontSize: 10, opacity: 0.6 }}>Active Time</Text>
            </View>

            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#dbeafe" },
              ]}
            >
              <Ionicons name="barbell" size={20} color="#3b82f6" />
              <Text fontWeight="bold" size="h4" style={{ marginVertical: 4 }}>
                {totalWorkouts}
              </Text>
              <Text style={{ fontSize: 10, opacity: 0.6 }}>Sessions</Text>
            </View>

            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#ffedd5" },
              ]}
            >
              <Ionicons name="restaurant" size={20} color="#f97316" />
              <Text fontWeight="bold" size="h4" style={{ marginVertical: 4 }}>
                {totalMeals}
              </Text>
              <Text style={{ fontSize: 10, opacity: 0.6 }}>Meals</Text>
            </View>
          </View>

          <View style={styles.highlightRow}>
            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#e0f2fe" },
              ]}
            >
              <Ionicons name="water" size={20} color="#3B82F6" />
              <Text fontWeight="bold" size="h4" style={{ marginVertical: 4 }}>
                {totalWaterMl}ml
              </Text>
              <Text style={{ fontSize: 10, opacity: 0.6 }}>Water</Text>
            </View>

            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#f3f4f6" },
              ]}
            >
              <Ionicons name="sparkles" size={20} color="#A855F7" />
              <Text fontWeight="bold" size="h4" style={{ marginVertical: 4 }}>
                {bestDay}
              </Text>
              <Text style={{ fontSize: 10, opacity: 0.6 }}>Best Day</Text>
            </View>

            <View
              style={[
                styles.highlightCard,
                { backgroundColor: isDarkmode ? "#1f2937" : "#f0fdf4" },
              ]}
            >
              <Ionicons name="trending-up" size={20} color={FITNESS_COLOR} />
              <Text fontWeight="bold" size="h4" style={{ marginVertical: 4 }}>
                {Math.round(totalMinutes / 7)}m
              </Text>
              <Text style={{ fontSize: 10, opacity: 0.6 }}>Avg/Day</Text>
            </View>
          </View>

          {/* Coach Tip */}
          <Section
            style={[
              styles.tipCard,
              { backgroundColor: isDarkmode ? "#111827" : "#fff7ed" },
            ]}
          >
            <View style={styles.tipHeader}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text size="h4" fontWeight="bold">
                  Coach Tip
                </Text>
                <Text style={{ marginLeft: 6, fontSize: 16 }}>✨</Text>
              </View>
              <Ionicons
                name="sparkles"
                size={18}
                color={isDarkmode ? "#fbbf24" : "#f59e0b"}
              />
            </View>

            <Text style={{ opacity: 0.8, marginTop: 6, lineHeight: 18 }}>
              {totalWorkouts === 0
                ? "Start small: do one short session today. Momentum is the goal."
                : totalWorkouts < 3
                ? "Nice start. Add 1 more session to make this week feel complete."
                : "Great consistency! Keep sessions short and sustainable to protect your streak."}
            </Text>

            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: isDarkmode ? "#1f2937" : "#ecfccb" },
                ]}
              >
                <Text style={styles.badgeText}>🔥 Streak focus</Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: isDarkmode ? "#1f2937" : "#e0f2fe" },
                ]}
              >
                <Text style={styles.badgeText}>💧 Hydrate</Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: isDarkmode ? "#1f2937" : "#fce7f3" },
                ]}
              >
                <Text style={styles.badgeText}>🥗 Log meals</Text>
              </View>
            </View>
          </Section>

          {/* Activity Chart */}
          <Section style={styles.chartCard}>
            <View style={styles.cardHeader}>
              <Text fontWeight="bold">Activity Trend (Minutes)</Text>
              {bestDay !== "None" && (
                <Text style={{ fontSize: 10, color: FITNESS_COLOR }}>
                  Best: {bestDay}
                </Text>
              )}
            </View>

            {totalMinutes === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="analytics" size={40} color="#e5e7eb" />
                <Text style={{ marginTop: 8, opacity: 0.5 }}>
                  No workout activity yet.
                </Text>
                <Button
                  text="Start a Session"
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
                yAxisSuffix="m"
                chartConfig={chartConfig}
                bezier
                style={{ borderRadius: 12, marginVertical: 8 }}
              />
            )}
          </Section>

          {/* Meals Chart */}
          <Section style={styles.chartCard}>
            <View style={styles.cardHeader}>
              <Text fontWeight="bold">Meals Logged</Text>
            </View>

            {totalMeals === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="cafe" size={40} color="#e5e7eb" />
                <Text style={{ marginTop: 8, opacity: 0.5 }}>
                  No meals logged.
                </Text>
                <Button
                  text="Log a Meal"
                  size="sm"
                  style={{ marginTop: 10 }}
                  onPress={() => navigation.navigate("LogMeal")}
                />
              </View>
            ) : (
              <BarChart
                data={{ labels, datasets: [{ data: dataMeals }] }}
                width={screenWidth - 48}
                height={200}
                chartConfig={{
                  ...chartConfig,
                  color: (opacity = 1) => `rgba(249, 115, 22, ${opacity})`,
                }}
                style={{ borderRadius: 12, marginVertical: 8 }}
                fromZero
                showBarTops={false}
              />
            )}
          </Section>

          {/* Hydration Chart */}
          <Section style={styles.chartCard}>
            <View style={styles.cardHeader}>
              <Text fontWeight="bold">Hydration (cups)</Text>
              <Text style={{ fontSize: 10, opacity: 0.6 }}>1 cup ≈ 250ml</Text>
            </View>

            {totalWaterMl === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="water" size={40} color="#e5e7eb" />
                <Text style={{ marginTop: 8, opacity: 0.5 }}>
                  No water logs yet.
                </Text>
                <Button
                  text="Add Water"
                  size="sm"
                  style={{ marginTop: 10 }}
                  onPress={() => navigation.goBack()}
                />
              </View>
            ) : (
              <BarChart
                data={{ labels, datasets: [{ data: dataWater }] }}
                width={screenWidth - 48}
                height={200}
                chartConfig={{
                  ...chartConfig,
                  color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
                }}
                style={{ borderRadius: 12, marginVertical: 8 }}
                fromZero
                showBarTops={false}
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
    gap: 8,
    marginBottom: 12,
  } as any,
  highlightCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  chartCard: { borderRadius: 16, padding: 16, marginBottom: 16 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  emptyState: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.02)",
    borderRadius: 12,
  },
});
