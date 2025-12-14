import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import { useFocusEffect } from "@react-navigation/native";
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
  Timestamp,
  addDoc,
  serverTimestamp,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Props = NativeStackScreenProps<MainStackParamList, "FitnessMenu">;
// ... (Type definitions remain the same as previous) ...
type PrefData = {
  goal: string;
  difficulty: "easy" | "moderate" | "hard";
  workoutDays: string[];
  sessionLengthMinutes: number;
  height?: number | null;
  weight?: number | null;
};

// Colors
const FITNESS_COLOR = "#22C55E";
const WORKOUT_COLOR = "#3B82F6";
const MEAL_COLOR = "#F97316";
const WATER_COLOR = "#0EA5E9";
const GOAL_COLOR = "#8B5CF6";
const DIFF_COLOR = "#F59E0B";
const SCHED_COLOR = "#10B981";

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
  const [workoutMinutesThisWeek, setWorkoutMinutesThisWeek] = useState(0);
  const [mealsToday, setMealsToday] = useState(0);
  const [waterMlToday, setWaterMlToday] = useState(0);
  const [pendingWaterMl, setPendingWaterMl] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingWater, setAddingWater] = useState(false);

  // NEW: State to track if there is a session to resume
  const [hasSavedSession, setHasSavedSession] = useState(false);

  const userName =
    auth.currentUser?.displayName ||
    auth.currentUser?.email?.split("@")[0] ||
    "User";
  const todayStr = new Date().toLocaleDateString("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  // Check for saved session every time screen comes into focus
  useFocusEffect(
    useCallback(() => {
      const checkSession = async () => {
        const user = auth.currentUser;
        if (!user) return;
        try {
          const saved = await AsyncStorage.getItem(`session_${user.uid}`);
          setHasSavedSession(!!saved);
        } catch (e) {
          console.log(e);
        }
      };
      checkSession();
    }, [auth.currentUser])
  );

  const loadOnce = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    const prefRef = doc(db, "WorkoutPreference", user.uid);
    const prefSnap = await getDoc(prefRef);
    setPref(prefSnap.exists() ? (prefSnap.data() as PrefData) : null);

    // Also check session during load
    const saved = await AsyncStorage.getItem(`session_${user.uid}`);
    setHasSavedSession(!!saved);
  }, [auth.currentUser, db]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadOnce();
    } finally {
      setRefreshing(false);
    }
  }, [loadOnce]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadOnce().catch(() => {});

    // Live Workouts
    const now = new Date();
    const sevenDaysAgo = startOfDay(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
    );
    const startWeekTs = Timestamp.fromDate(sevenDaysAgo);
    const workoutQ = query(
      collection(db, "WorkoutSession"),
      where("userId", "==", user.uid),
      where("createdAtClient", ">=", startWeekTs),
      orderBy("createdAtClient", "asc")
    );

    const unsubWorkouts = onSnapshot(workoutQ, (snap) => {
      let completed = 0;
      let minutes = 0;
      const completedDates = new Set<string>();
      snap.forEach((d) => {
        const data: any = d.data();
        const created = data.createdAtClient?.toDate?.();
        if (!created) return;
        if (data.status === "completed") {
          completed += 1;
          minutes +=
            typeof data.actualDurationSec === "number"
              ? Math.round(data.actualDurationSec / 60)
              : 0;
          completedDates.add(dateKey(created));
        }
      });
      setWorkoutsThisWeek(completed);
      setWorkoutMinutesThisWeek(minutes);
      let s = 0;
      for (let i = 0; i < 30; i++) {
        const checkDate = new Date(now);
        checkDate.setDate(now.getDate() - i);
        if (completedDates.has(dateKey(checkDate))) s++;
        else if (i !== 0) break;
      }
      setStreakDays(s);
      setLoading(false);
    });

    // Live Meals
    const todayStart = startOfDay(now);
    const todayTs = Timestamp.fromDate(todayStart);
    const mealQ = query(
      collection(db, "MealEntry"),
      where("userId", "==", user.uid),
      where("mealTimeClient", ">=", todayTs),
      orderBy("mealTimeClient", "desc")
    );
    const unsubMeals = onSnapshot(mealQ, (snap) => {
      let mealCount = 0;
      let waterMl = 0;
      snap.forEach((d) => {
        const data: any = d.data();
        if (data?.isWater)
          waterMl += typeof data.volumeMl === "number" ? data.volumeMl : 0;
        else mealCount += 1;
      });
      setMealsToday(mealCount);
      setWaterMlToday(waterMl);
      setPendingWaterMl(0);
    });

    return () => {
      unsubWorkouts();
      unsubMeals();
    };
  }, [auth.currentUser, db, loadOnce]);

  // (Helper functions like addWater, bmiData, weeklyProgressLabel etc. remain same as before)
  const addWater = async () => {
    /* ... existing code ... */
    if (addingWater) return;
    setAddingWater(true);
    setPendingWaterMl((p) => p + 250);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const now = new Date();
      await addDoc(collection(db, "MealEntry"), {
        userId: user.uid,
        mealType: "water",
        category: "beverage",
        notes: "Quick Water 💧",
        photoURL: null,
        isWater: true,
        volumeMl: 250,
        mealTimeClient: Timestamp.fromDate(now),
        createdAtClient: Timestamp.fromDate(now),
        mealTime: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      setPendingWaterMl((p) => Math.max(0, p - 250));
      Alert.alert("Error", "Could not save water entry.");
    } finally {
      setAddingWater(false);
    }
  };
  const waterGoalMl = 2000;
  const waterMlTodayLive = waterMlToday + pendingWaterMl;
  const waterPct = Math.min(
    100,
    Math.round((waterMlTodayLive / waterGoalMl) * 100)
  );

  // ... (reusing previous render logic for BMI and stats) ...
  const bmiData = useMemo(() => {
    const h = pref?.height ?? null;
    const w = pref?.weight ?? null;
    if (!h || !w) return null;
    const hM = h / 100;
    const val = w / (hM * hM);
    const score = val.toFixed(1);
    let label = "Normal";
    let color = FITNESS_COLOR;
    if (val < 18.5) {
      label = "Underweight";
      color = "#F59E0B";
    } else if (val >= 25 && val < 30) {
      label = "Overweight";
      color = "#F59E0B";
    } else if (val >= 30) {
      label = "Obese";
      color = "#EF4444";
    }
    return { score, label, color };
  }, [pref?.height, pref?.weight]);

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
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* Hero Section */}
          <Section
            style={[
              styles.card,
              { borderColor: isDarkmode ? "#262626" : "#e2e8f0" },
            ]}
          >
            <View style={styles.heroHeader}>
              <View>
                <Text size="h3" fontWeight="bold">
                  Hello, {userName}
                </Text>
                <Text style={{ opacity: 0.5, marginTop: 2 }}>{todayStr}</Text>
              </View>
              <View
                style={[
                  styles.streakBadge,
                  { backgroundColor: isDarkmode ? "#374151" : "#f3f4f6" },
                ]}
              >
                <Ionicons name="flame" size={20} color="#F97316" />
                <Text fontWeight="bold" style={{ marginLeft: 4 }}>
                  {streakDays}
                </Text>
              </View>
            </View>
            <View style={styles.heroFooter}>
              <Text style={{ opacity: 0.8, fontSize: 13, marginBottom: 6 }}>
                {weeklyProgressLabel}
              </Text>
              <View
                style={[
                  styles.progressBarBg,
                  { backgroundColor: isDarkmode ? "#374151" : "#e5e7eb" },
                ]}
              >
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min(
                        100,
                        (workoutsThisWeek / (weeklyGoal || 1)) * 100
                      )}%`,
                      backgroundColor: FITNESS_COLOR,
                    },
                  ]}
                />
              </View>
              <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: isDarkmode ? "#374151" : "#f3f4f6" },
                  ]}
                >
                  <Ionicons name="time" size={14} color={WORKOUT_COLOR} />
                  <Text style={{ fontSize: 12, opacity: 0.8 }}>
                    {workoutMinutesThisWeek} min
                  </Text>
                </View>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: isDarkmode ? "#374151" : "#f3f4f6" },
                  ]}
                >
                  <Ionicons name="restaurant" size={14} color={MEAL_COLOR} />
                  <Text style={{ fontSize: 12, opacity: 0.8 }}>
                    {mealsToday} meals
                  </Text>
                </View>
              </View>
            </View>
          </Section>

          {/* Stats Grid */}
          <View style={styles.row}>
            <Section
              style={[
                styles.card,
                styles.statCard,
                { borderColor: isDarkmode ? "#262626" : "#f1f5f9" },
              ]}
            >
              <Ionicons name="barbell" size={24} color={WORKOUT_COLOR} />
              <Text size="h2" fontWeight="bold" style={{ marginTop: 8 }}>
                {workoutsThisWeek}
              </Text>
              <Text style={styles.statLabel}>Workouts (7d)</Text>
            </Section>
            <Section
              style={[
                styles.card,
                styles.statCard,
                { borderColor: isDarkmode ? "#262626" : "#f1f5f9" },
              ]}
            >
              <Ionicons name="restaurant" size={24} color={MEAL_COLOR} />
              <Text size="h2" fontWeight="bold" style={{ marginTop: 8 }}>
                {mealsToday}
              </Text>
              <Text style={styles.statLabel}>Meals Today</Text>
            </Section>
          </View>

          {/* Hydration */}
          <Section
            style={[
              styles.card,
              { borderColor: isDarkmode ? "#262626" : "#e2e8f0" },
            ]}
          >
            <View style={styles.waterRow}>
              <View style={{ flex: 1 }}>
                <Text size="h3" fontWeight="bold">
                  Quick Water
                </Text>
                <Text style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>
                  {waterMlTodayLive}ml / {waterGoalMl}ml ({waterPct}%)
                </Text>
                <View style={[styles.progressBarBg, { marginTop: 10 }]}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${waterPct}%`, backgroundColor: WATER_COLOR },
                    ]}
                  />
                </View>
              </View>
              <Button
                text={addingWater ? "..." : "250ml"}
                color={WATER_COLOR}
                size="sm"
                onPress={addWater}
                disabled={addingWater}
                leftContent={<Ionicons name="add" size={16} color="#fff" />}
              />
            </View>
          </Section>

          {/* BMI */}
          {bmiData && (
            <Section
              style={[
                styles.card,
                { borderColor: isDarkmode ? "#262626" : "#e2e8f0" },
              ]}
            >
              <View style={styles.bmiHeader}>
                <Text size="h3" fontWeight="bold">
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
                  <Text style={styles.bmiLabel}>BMI</Text>
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

          {/* Plan Section */}
          <Section
            style={[
              styles.card,
              { borderColor: isDarkmode ? "#262626" : "#e2e8f0" },
            ]}
          >
            <Text size="h3" fontWeight="bold" style={{ marginBottom: 12 }}>
              Current Plan
            </Text>
            {pref ? (
              <View>
                <View style={styles.planRow}>
                  <Ionicons
                    name="flag"
                    size={16}
                    color={GOAL_COLOR}
                    style={{ marginRight: 8 }}
                  />
                  <Text>{pref.goal}</Text>
                </View>
                <View style={styles.planRow}>
                  <Ionicons
                    name="speedometer"
                    size={16}
                    color={DIFF_COLOR}
                    style={{ marginRight: 8 }}
                  />
                  <Text>{difficultyText}</Text>
                </View>
                <View style={styles.planRow}>
                  <Ionicons
                    name="calendar"
                    size={16}
                    color={SCHED_COLOR}
                    style={{ marginRight: 8 }}
                  />
                  <Text>{daysLabel}</Text>
                </View>

                {/* DYNAMIC BUTTON: START or CONTINUE */}
                <Button
                  text={hasSavedSession ? "Continue Session" : "Start Session"}
                  style={{ marginTop: 16 }}
                  color={hasSavedSession ? DIFF_COLOR : WORKOUT_COLOR}
                  onPress={() => navigation.navigate("WorkoutSession")}
                  rightContent={
                    hasSavedSession ? (
                      <Ionicons name="play-skip-forward" color="#fff" />
                    ) : undefined
                  }
                />

                <Button
                  text="Edit Preference"
                  outline
                  style={{ marginTop: 8 }}
                  color={WORKOUT_COLOR}
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
                  color={WORKOUT_COLOR}
                  onPress={() => navigation.navigate("WorkoutPreference")}
                />
              </View>
            )}
          </Section>

          {/* Actions */}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  card: { borderRadius: 16, marginBottom: 16, padding: 16, borderWidth: 1 },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  heroFooter: { marginTop: 20 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 4,
    marginTop: 6,
    overflow: "hidden",
  },
  progressBarFill: { height: "100%", borderRadius: 4 },
  row: { flexDirection: "row", gap: 12, marginBottom: 16 },
  statCard: { flex: 1, marginBottom: 0, alignItems: "flex-start" },
  statLabel: { fontSize: 12, opacity: 0.6, marginTop: 4 },
  waterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  bmiHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  bmiRow: { flexDirection: "row", justifyContent: "space-between" },
  bmiItem: { alignItems: "flex-start" },
  bmiLabel: {
    fontSize: 11,
    opacity: 0.6,
    marginBottom: 2,
    textTransform: "uppercase",
  },
  planRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  actionGrid: { flexDirection: "row", marginBottom: 32 },
});
