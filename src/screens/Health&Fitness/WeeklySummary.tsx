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
// IMPORTANT: Ensure these are installed
import { BarChart, LineChart } from "react-native-chart-kit";

type Props = NativeStackScreenProps<MainStackParamList, "WeeklySummary">;

type DayStat = {
  label: string;
  fullDate: string;
  workouts: number;
  workoutMinutes: number;
  meals: number;
};

const screenWidth = Dimensions.get("window").width;
const FITNESS_COLOR = "#22C55E";

export default function WeeklySummaryScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const [stats, setStats] = useState<DayStat[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Helper to Generate Last 7 Days (Empty) ---
  const getLast7Days = () => {
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
      });
    }
    return days;
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    // Initialize stats immediately so we don't show blank screen
    setStats(getLast7Days());

    const now = new Date();
    const startWindow = new Date(now);
    startWindow.setDate(now.getDate() - 6);
    startWindow.setHours(0, 0, 0, 0);
    const startTs = Timestamp.fromDate(startWindow);

    // --- WORKOUT LISTENER ---
    // Note: If this query fails (missing index), check your console!
    const workoutQ = query(
      collection(db, "WorkoutSession"),
      where("userId", "==", user.uid),
      where("createdAtClient", ">=", startTs),
      orderBy("createdAtClient", "asc")
    );

    const mealQ = query(
      collection(db, "MealEntry"),
      where("userId", "==", user.uid),
      where("mealTimeClient", ">=", startTs),
      orderBy("mealTimeClient", "asc")
    );

    const unsubWorkouts = onSnapshot(
      workoutQ,
      (wSnap) => {
        const currentStats = getLast7Days(); // Reset stats on update

        wSnap.forEach((doc) => {
          const data = doc.data();
          if (data.status !== "completed" || !data.createdAtClient) return;

          const dateStr = data.createdAtClient
            .toDate()
            .toISOString()
            .slice(0, 10);
          const dayIndex = currentStats.findIndex(
            (d) => d.fullDate === dateStr
          );

          if (dayIndex !== -1) {
            currentStats[dayIndex].workouts += 1;
            const mins =
              typeof data.actualDurationSec === "number"
                ? Math.round(data.actualDurationSec / 60)
                : 0;
            currentStats[dayIndex].workoutMinutes += mins;
          }
        });

        // --- NESTED MEAL LISTENER ---
        const unsubMeals = onSnapshot(
          mealQ,
          (mSnap) => {
            // Clear previous meal counts in our working copy
            currentStats.forEach((d) => (d.meals = 0));

            mSnap.forEach((doc) => {
              const data = doc.data();
              if (!data.mealTimeClient) return;
              const dateStr = data.mealTimeClient
                .toDate()
                .toISOString()
                .slice(0, 10);
              const dayIndex = currentStats.findIndex(
                (d) => d.fullDate === dateStr
              );
              if (dayIndex !== -1) {
                currentStats[dayIndex].meals += 1;
              }
            });

            setStats([...currentStats]);
            setLoading(false);
          },
          (error) => {
            console.log("Meal Query Error:", error);
            setLoading(false);
          }
        );
      },
      (error) => {
        console.log("Workout Query Error (Check Indexes!):", error);
        setLoading(false);
      }
    );

    return () => unsubWorkouts();
  }, []);

  // --- Safe Data Prep ---
  const labels = stats.map((d) => d.label);
  const dataMinutes = stats.map((d) => d.workoutMinutes);
  const dataMeals = stats.map((d) => d.meals);

  const totalMinutes = dataMinutes.reduce((a, b) => a + b, 0);
  const totalWorkouts = stats.reduce((a, b) => a + b.workouts, 0);
  const totalMeals = dataMeals.reduce((a, b) => a + b, 0);

  const bestDay = useMemo(() => {
    if (totalMinutes === 0) return "None";
    const max = Math.max(...dataMinutes);
    const idx = dataMinutes.indexOf(max);
    return stats[idx]?.label || "-";
  }, [dataMinutes, totalMinutes]);

  const chartConfig = {
    backgroundGradientFrom: isDarkmode ? "#1F2937" : "#ffffff",
    backgroundGradientTo: isDarkmode ? "#1F2937" : "#ffffff",
    color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`,
    labelColor: (opacity = 1) =>
      isDarkmode ? `rgba(255,255,255,${opacity})` : `rgba(0,0,0,${opacity})`,
    strokeWidth: 2,
    barPercentage: 0.5,
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
              </View>
            ) : (
              <LineChart
                data={{ labels, datasets: [{ data: dataMinutes }] }}
                width={screenWidth - 48}
                height={200}
                yAxisLabel=""
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
              <Text fontWeight="bold">Nutrition Logging</Text>
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
                yAxisLabel=""
                yAxisSuffix=""
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
    marginBottom: 20,
  },
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
