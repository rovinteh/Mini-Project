import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
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
  Section,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

type Props = NativeStackScreenProps<MainStackParamList, "FitnessMenu">;

type PrefData = {
  goal: string;
  difficulty: "easy" | "moderate" | "hard";
  workoutDays: string[];
  sessionLengthMinutes: number;
  height?: number;
  weight?: number;
};

const FITNESS_COLOR = "#22C55E";
const WATER_COLOR = "#3B82F6";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function FitnessMenu({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const [pref, setPref] = useState<PrefData | null>(null);
  const [workoutsThisWeek, setWorkoutsThisWeek] = useState(0);
  const [mealsToday, setMealsToday] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [addingWater, setAddingWater] = useState(false);

  const userName =
    auth.currentUser?.displayName ||
    auth.currentUser?.email?.split("@")[0] ||
    "User";

  const todayStr = new Date().toLocaleDateString("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  // --- Helpers for Display ---
  const difficultyText =
    pref?.difficulty === "easy"
      ? "Beginner Friendly"
      : pref?.difficulty === "moderate"
      ? "Balanced"
      : pref?.difficulty === "hard"
      ? "High Intensity"
      : "Not set";

  const daysLabel = pref?.workoutDays?.length
    ? pref.workoutDays.join(", ")
    : "No days selected";

  const weeklyGoal = pref?.workoutDays?.length ?? 0;

  const weeklyProgressLabel = useMemo(() => {
    if (!weeklyGoal) return "Set a plan to track progress";
    const pct = Math.min(
      100,
      Math.round((workoutsThisWeek / weeklyGoal) * 100)
    );
    return `${workoutsThisWeek} / ${weeklyGoal} sessions (${pct}%)`;
  }, [workoutsThisWeek, weeklyGoal]);

  // --- BMI Calculation ---
  const bmiData = useMemo(() => {
    if (!pref?.height || !pref?.weight) return null;
    const hM = pref.height / 100;
    const val = pref.weight / (hM * hM);
    const score = val.toFixed(1);

    let label = "Normal";
    let color = FITNESS_COLOR;

    if (val < 18.5) {
      label = "Underweight";
      color = "#F59E0B";
    } // Amber
    else if (val >= 25 && val < 30) {
      label = "Overweight";
      color = "#F59E0B";
    } else if (val >= 30) {
      label = "Obese";
      color = "#EF4444";
    } // Red

    return { score, label, color };
  }, [pref?.height, pref?.weight]);

  // --- Load Data ---
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      try {
        // 1. Preference (Profile)
        const prefRef = doc(db, "WorkoutPreference", user.uid);
        const prefSnap = await getDoc(prefRef);
        if (prefSnap.exists()) {
          setPref(prefSnap.data() as PrefData);
        } else {
          setPref(null);
        }

        // 2. Workouts (Completed this week)
        const now = new Date();
        const sevenDaysAgo = startOfDay(
          new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
        );
        const startWeekTs = Timestamp.fromDate(sevenDaysAgo);

        const workoutQ = query(
          collection(db, "WorkoutSession"),
          where("userId", "==", user.uid),
          where("createdAtClient", ">=", startWeekTs)
        );
        const workoutSnap = await getDocs(workoutQ);
        let completed = 0;
        workoutSnap.forEach((d) => {
          if (d.data().status === "completed") completed++;
        });
        setWorkoutsThisWeek(completed);

        // 3. Meals Today
        const todayStart = startOfDay(now);
        const todayTs = Timestamp.fromDate(todayStart);

        const mealQ = query(
          collection(db, "MealEntry"),
          where("userId", "==", user.uid),
          where("mealTimeClient", ">=", todayTs)
        );
        const mealSnap = await getDocs(mealQ);
        setMealsToday(mealSnap.size);

        // 4. Streak Logic
        // (Simplified: checks last 30 days for any completed workout)
        const thirtyDaysAgo = startOfDay(
          new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
        );
        const streakTs = Timestamp.fromDate(thirtyDaysAgo);
        const streakQ = query(
          collection(db, "WorkoutSession"),
          where("userId", "==", user.uid),
          where("createdAtClient", ">=", streakTs)
        );
        const streakSnap = await getDocs(streakQ);
        const completedDates = new Set<string>();
        streakSnap.forEach((d) => {
          if (
            d.data().status === "completed" &&
            d.data().createdAtClient?.toDate
          ) {
            completedDates.add(dateKey(d.data().createdAtClient.toDate()));
          }
        });

        let s = 0;
        // Check backwards from today
        for (let i = 0; i < 30; i++) {
          const checkDate = new Date(now);
          checkDate.setDate(now.getDate() - i);
          if (completedDates.has(dateKey(checkDate))) {
            s++;
          } else {
            // Allow missing today if it's still early, otherwise break
            if (i !== 0) break;
          }
        }
        setStreakDays(s);
      } catch (err) {
        console.log("FitnessMenu load error:", err);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, []);

  // --- Quick Actions ---
  const addWater = async () => {
    if (addingWater) return;
    setAddingWater(true);
    try {
      const user = auth.currentUser;
      if (!user) return;

      const now = new Date();
      // Write to DB
      await addDoc(collection(db, "MealEntry"), {
        userId: user.uid,
        mealType: "snack",
        category: "beverage",
        notes: "Quick Water (250ml) 💧",
        photoURL: null,
        mealTimeClient: Timestamp.fromDate(now),
        createdAtClient: Timestamp.fromDate(now),
        mealTime: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      // Optimistic UI Update
      setMealsToday((prev) => prev + 1);
      Alert.alert("Hydration Saved", "Good job staying hydrated! 💧");
    } catch (e) {
      Alert.alert("Error", "Could not save water entry.");
    } finally {
      setAddingWater(false);
    }
  };

  return (
    <Layout>
      <TopNav
        middleContent="Health Dashboard"
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
          <Text style={{ marginTop: 10 }}>Loading Dashboard...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 1. Hero / Welcome Card */}
          <Section style={[styles.card, styles.heroCard]}>
            <View style={styles.heroHeader}>
              <View>
                <Text size="h3" fontWeight="bold" style={{ color: "#fff" }}>
                  Hello, {userName}
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.8)", marginTop: 2 }}>
                  {todayStr}
                </Text>
              </View>
              <View style={styles.streakBadge}>
                <Ionicons name="flame" size={20} color="#fff" />
                <Text
                  fontWeight="bold"
                  style={{ color: "#fff", marginLeft: 4 }}
                >
                  {streakDays}
                </Text>
              </View>
            </View>

            <View style={styles.heroFooter}>
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 13 }}>
                {weeklyProgressLabel}
              </Text>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min(
                        100,
                        (workoutsThisWeek / (weeklyGoal || 1)) * 100
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          </Section>

          {/* 2. Stats Grid */}
          <View style={styles.row}>
            <Section
              style={[
                styles.card,
                styles.statCard,
                { borderColor: isDarkmode ? "#262626" : "#f1f5f9" },
              ]}
            >
              <Ionicons name="barbell" size={24} color={FITNESS_COLOR} />
              <Text size="h2" fontWeight="bold" style={{ marginTop: 8 }}>
                {workoutsThisWeek}
              </Text>
              <Text style={styles.statLabel}>Workouts</Text>
            </Section>

            <Section
              style={[
                styles.card,
                styles.statCard,
                { borderColor: isDarkmode ? "#262626" : "#f1f5f9" },
              ]}
            >
              <Ionicons name="restaurant" size={24} color="#F97316" />
              <Text size="h2" fontWeight="bold" style={{ marginTop: 8 }}>
                {mealsToday}
              </Text>
              <Text style={styles.statLabel}>Meals Logged</Text>
            </Section>
          </View>

          {/* 3. NEW: Quick Hydration Widget */}
          <Section
            style={[
              styles.card,
              { borderColor: isDarkmode ? "#262626" : "#e2e8f0" },
            ]}
          >
            <View style={styles.waterRow}>
              <View>
                <Text size="h4" fontWeight="bold">
                  Stay Hydrated
                </Text>
                <Text style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>
                  Quickly log 250ml of water
                </Text>
              </View>
              <Button
                text={addingWater ? "..." : "+ Add"}
                color={WATER_COLOR}
                size="sm"
                onPress={addWater}
                disabled={addingWater}
                leftContent={<Ionicons name="water" size={16} color="#fff" />}
              />
            </View>
          </Section>

          {/* 4. NEW: BMI / Body Status (Only if data exists) */}
          {bmiData && (
            <Section
              style={[
                styles.card,
                { borderColor: isDarkmode ? "#262626" : "#e2e8f0" },
              ]}
            >
              <View style={styles.bmiHeader}>
                <Text size="h4" fontWeight="bold">
                  Body Metrics
                </Text>
                <Text
                  fontWeight="bold"
                  style={{ color: bmiData.color, fontSize: 14 }}
                >
                  {bmiData.label}
                </Text>
              </View>
              <View style={styles.bmiRow}>
                <View style={styles.bmiItem}>
                  <Text style={styles.bmiLabel}>BMI Score</Text>
                  <Text size="h2" fontWeight="bold">
                    {bmiData.score}
                  </Text>
                </View>
                <View style={styles.bmiItem}>
                  <Text style={styles.bmiLabel}>Height</Text>
                  <Text size="h3">{pref?.height} cm</Text>
                </View>
                <View style={styles.bmiItem}>
                  <Text style={styles.bmiLabel}>Weight</Text>
                  <Text size="h3">{pref?.weight} kg</Text>
                </View>
              </View>
            </Section>
          )}

          {/* 5. Workout Plan Card */}
          <Section
            style={[
              styles.card,
              { borderColor: isDarkmode ? "#262626" : "#e2e8f0" },
            ]}
          >
            <Text size="h4" fontWeight="bold" style={{ marginBottom: 12 }}>
              Current Plan
            </Text>

            {pref ? (
              <View>
                <View style={styles.planRow}>
                  <Ionicons
                    name="flag"
                    size={16}
                    color={FITNESS_COLOR}
                    style={{ marginRight: 8 }}
                  />
                  <Text>{pref.goal}</Text>
                </View>
                <View style={styles.planRow}>
                  <Ionicons
                    name="speedometer"
                    size={16}
                    color={FITNESS_COLOR}
                    style={{ marginRight: 8 }}
                  />
                  <Text>{difficultyText}</Text>
                </View>
                <View style={styles.planRow}>
                  <Ionicons
                    name="calendar"
                    size={16}
                    color={FITNESS_COLOR}
                    style={{ marginRight: 8 }}
                  />
                  <Text>{daysLabel}</Text>
                </View>

                <Button
                  text="Start Session"
                  style={{ marginTop: 16 }}
                  color={FITNESS_COLOR}
                  onPress={() => navigation.navigate("WorkoutSession")}
                />
                <Button
                  text="Edit Preference"
                  outline
                  style={{ marginTop: 8 }}
                  color={FITNESS_COLOR}
                  onPress={() => navigation.navigate("WorkoutPreference")}
                />
              </View>
            ) : (
              <View style={{ alignItems: "center", padding: 10 }}>
                <Text
                  style={{
                    opacity: 0.6,
                    textAlign: "center",
                    marginBottom: 12,
                  }}
                >
                  You haven't set up a fitness plan yet.
                </Text>
                <Button
                  text="Create Plan"
                  color={FITNESS_COLOR}
                  onPress={() => navigation.navigate("WorkoutPreference")}
                />
              </View>
            )}
          </Section>

          {/* 6. Other Actions */}
          <View style={styles.actionGrid}>
            <Button
              text="Log Meal"
              style={{ flex: 1, marginRight: 8 }}
              status="primary"
              outline
              onPress={() => navigation.navigate("LogMeal")}
            />
            <Button
              text="Summary"
              style={{ flex: 1 }}
              status="primary"
              outline
              onPress={() => navigation.navigate("WeeklySummary")}
            />
          </View>
        </ScrollView>
      )}
    </Layout>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  card: {
    borderRadius: 16,
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
  },
  heroCard: {
    backgroundColor: "#22C55E", // Green background
    borderWidth: 0,
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  heroFooter: {
    marginTop: 20,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: "rgba(0,0,0,0.1)",
    borderRadius: 4,
    marginTop: 6,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#fff",
    borderRadius: 4,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  } as any,
  statCard: {
    flex: 1,
    marginBottom: 0,
    alignItems: "flex-start",
  },
  statLabel: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 4,
  },
  waterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bmiHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  bmiRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  bmiItem: {
    alignItems: "flex-start",
  },
  bmiLabel: {
    fontSize: 11,
    opacity: 0.6,
    marginBottom: 2,
    textTransform: "uppercase",
  },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  actionGrid: {
    flexDirection: "row",
    marginBottom: 32,
  } as any,
});
