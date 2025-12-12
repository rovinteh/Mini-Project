import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Dimensions } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  Section,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import { BarChart } from "react-native-chart-kit";

type Props = NativeStackScreenProps<MainStackParamList, "WeeklySummary">;

type DayStat = {
  label: string; // e.g. "Mon"
  dateKey: string; // 'YYYY-MM-DD'
  workouts: number;
  workoutMinutes: number;
  meals: number;
};

const screenWidth = Dimensions.get("window").width;

export default function WeeklySummaryScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const [stats, setStats] = useState<DayStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        // Build last 7 days structure (today and previous 6 days)
        const now = new Date();
        const days: DayStat[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - i,
            0,
            0,
            0,
            0
          );
          const dateKey = d.toISOString().slice(0, 10); // YYYY-MM-DD
          const label = d.toLocaleDateString("en-MY", {
            weekday: "short",
          });
          days.push({
            label,
            dateKey,
            workouts: 0,
            workoutMinutes: 0,
            meals: 0,
          });
        }

        const weekStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - 6,
          0,
          0,
          0,
          0
        );
        const weekStartTs = Timestamp.fromDate(weekStart);

        // --- Workout sessions (count only completed) ---
        const workoutQ = query(
          collection(db, "WorkoutSession"),
          where("userId", "==", user.uid),
          where("createdAt", ">=", weekStartTs)
        );
        const workoutSnap = await getDocs(workoutQ);

        workoutSnap.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (data.status !== "completed" || !data.createdAt?.toDate) return;
          const d: Date = data.createdAt.toDate();
          const key = d.toISOString().slice(0, 10);
          const idx = days.findIndex((day) => day.dateKey === key);
          if (idx >= 0) {
            days[idx].workouts += 1;
            const mins =
              typeof data.actualDurationSec === "number"
                ? Math.round(data.actualDurationSec / 60)
                : 0;
            days[idx].workoutMinutes += mins;
          }
        });

        // --- Meal entries ---
        const mealQ = query(
          collection(db, "MealEntry"),
          where("userId", "==", user.uid),
          where("mealTime", ">=", weekStartTs)
        );
        const mealSnap = await getDocs(mealQ);

        mealSnap.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (!data.mealTime?.toDate) return;
          const d: Date = data.mealTime.toDate();
          const key = d.toISOString().slice(0, 10);
          const idx = days.findIndex((day) => day.dateKey === key);
          if (idx >= 0) {
            days[idx].meals += 1;
          }
        });

        setStats(days);
      } catch (err) {
        console.log("Weekly summary error:", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const labels = stats.map((d) => d.label);
  const workoutsData = stats.map((d) => d.workouts);
  const workoutMinutesData = stats.map((d) => d.workoutMinutes);
  const mealsData = stats.map((d) => d.meals);

  const totalWorkouts = workoutsData.reduce((a, b) => a + b, 0);
  const totalWorkoutMinutes = workoutMinutesData.reduce((a, b) => a + b, 0);
  const totalMeals = mealsData.reduce((a, b) => a + b, 0);

  const mostActiveIdx = workoutMinutesData.reduce(
    (maxIdx, val, idx, arr) => (val > arr[maxIdx] ? idx : maxIdx),
    0
  );
  const mostActiveDay =
    stats[mostActiveIdx]?.label && stats[mostActiveIdx].workoutMinutes > 0
      ? stats[mostActiveIdx].label
      : "-";

  const chartConfigBase = {
    backgroundGradientFrom: isDarkmode ? "#020617" : "#ffffff",
    backgroundGradientTo: isDarkmode ? "#020617" : "#ffffff",
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(129, 140, 248, ${opacity})`, // indigo
    labelColor: (opacity = 1) =>
      `rgba(${isDarkmode ? "248, 250, 252" : "15, 23, 42"}, ${opacity})`,
    propsForBackgroundLines: {
      strokeWidth: 0.5,
      stroke: isDarkmode ? "#1f2937" : "#e5e7eb",
    },
    barPercentage: 0.6,
  };

  return (
    <Layout>
      <TopNav
        middleContent="Weekly Summary"
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
          <Text>Loading weekly summary...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {/* Overview cards */}
          <View style={styles.row}>
            <Section style={[styles.card, styles.cardHalf]}>
              <Text size="lg" fontWeight="bold">
                Workouts
              </Text>
              <Text size="h1" fontWeight="bold" style={{ marginTop: 4 }}>
                {totalWorkouts}
              </Text>
              <Text style={styles.cardDesc}>
                Completed sessions in the last 7 days.
              </Text>
            </Section>

            <Section style={[styles.card, styles.cardHalf]}>
              <Text size="lg" fontWeight="bold">
                Workout minutes
              </Text>
              <Text size="h1" fontWeight="bold" style={{ marginTop: 4 }}>
                {totalWorkoutMinutes}
              </Text>
              <Text style={styles.cardDesc}>Total active time this week.</Text>
            </Section>
          </View>

          <View style={styles.row}>
            <Section style={[styles.card, styles.cardHalf]}>
              <Text size="lg" fontWeight="bold">
                Meals logged
              </Text>
              <Text size="h1" fontWeight="bold" style={{ marginTop: 4 }}>
                {totalMeals}
              </Text>
              <Text style={styles.cardDesc}>Entries recorded this week.</Text>
            </Section>

            <Section style={[styles.card, styles.cardHalf]}>
              <Text size="lg" fontWeight="bold">
                Most active day
              </Text>
              <Text size="h1" fontWeight="bold" style={{ marginTop: 4 }}>
                {mostActiveDay}
              </Text>
              <Text style={styles.cardDesc}>Based on workout minutes.</Text>
            </Section>
          </View>

          {/* Workouts per day chart */}
          <Section style={styles.card}>
            <Text size="lg" fontWeight="bold" style={{ marginBottom: 8 }}>
              Workouts per day
            </Text>
            <BarChart
              style={{ borderRadius: 12 }}
              data={{
                labels,
                datasets: [{ data: workoutsData }],
              }}
              width={screenWidth - 32}
              height={220}
              fromZero
              chartConfig={chartConfigBase}
              showBarTops={true}
              withInnerLines={true}
            />
          </Section>

          {/* Workout minutes chart */}
          <Section style={styles.card}>
            <Text size="lg" fontWeight="bold" style={{ marginBottom: 8 }}>
              Workout minutes per day
            </Text>
            <BarChart
              style={{ borderRadius: 12 }}
              data={{
                labels,
                datasets: [{ data: workoutMinutesData }],
              }}
              width={screenWidth - 32}
              height={220}
              fromZero
              chartConfig={{
                ...chartConfigBase,
                color: (opacity = 1) => `rgba(52, 211, 153, ${opacity})`, // green-ish
              }}
              showBarTops={true}
              withInnerLines={true}
            />
          </Section>

          {/* Meals per day chart */}
          <Section style={styles.card}>
            <Text size="lg" fontWeight="bold" style={{ marginBottom: 8 }}>
              Meals logged per day
            </Text>
            <BarChart
              style={{ borderRadius: 12 }}
              data={{
                labels,
                datasets: [{ data: mealsData }],
              }}
              width={screenWidth - 32}
              height={220}
              fromZero
              chartConfig={{
                ...chartConfigBase,
                color: (opacity = 1) => `rgba(251, 146, 60, ${opacity})`, // orange-ish
              }}
              showBarTops={true}
              withInnerLines={true}
            />
          </Section>

          {/* Simple interpretation */}
          <Section style={styles.card}>
            <Text size="lg" fontWeight="bold" style={{ marginBottom: 6 }}>
              Weekly insights
            </Text>
            {totalWorkouts === 0 && (
              <Text style={styles.cardDesc}>
                No completed workouts recorded this week. Try starting a short
                session to build the habit.
              </Text>
            )}
            {totalWorkouts > 0 && (
              <>
                <Text style={styles.cardDesc}>
                  You completed {totalWorkouts} workout
                  {totalWorkouts > 1 ? "s" : ""} with a total of{" "}
                  {totalWorkoutMinutes} minutes. Your most active day was{" "}
                  {mostActiveDay}.
                </Text>
                <Text style={[styles.cardDesc, { marginTop: 4 }]}>
                  You also logged {totalMeals} meal
                  {totalMeals > 1 ? "s" : ""}. Keeping meals updated helps the
                  app give a more meaningful picture of your health habits.
                </Text>
              </>
            )}
          </Section>
        </ScrollView>
      )}
    </Layout>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  } as any,
  card: {
    borderRadius: 16,
    marginBottom: 12,
  },
  cardHalf: {
    flex: 1,
  },
  cardDesc: {
    marginTop: 4,
    fontSize: 12,
    opacity: 0.7,
  },
});
