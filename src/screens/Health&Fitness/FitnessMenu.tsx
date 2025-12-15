import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
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
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Props = NativeStackScreenProps<MainStackParamList, "FitnessMenu">;

type PrefData = {
  goal: string;
  difficulty: "easy" | "moderate" | "hard";
  workoutDays: string[];
  sessionLengthMinutes: number;
  height?: number | null;
  weight?: number | null;
};

const COLORS = {
  bgDark: "#050B14",
  cardDark: "#0B1220",
  borderDark: "#111827",
  dimDark: "rgba(255,255,255,0.55)",
  dimDark2: "rgba(255,255,255,0.38)",

  bgLight: "#F7F8FA",
  cardLight: "#FFFFFF",
  borderLight: "#E5E7EB",
  dimLight: "rgba(0,0,0,0.55)",
  dimLight2: "rgba(0,0,0,0.38)",
};

const ACCENT = {
  workout: "#3B82F6",
  meal: "#F97316",
  summary: "#60A5FA",
  profile: "#8B5CF6",
  water: "#0EA5E9",
  streak: "#F59E0B",
  ok: "#22C55E",
};

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

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [pref, setPref] = useState<PrefData | null>(null);
  const [hasSavedSession, setHasSavedSession] = useState(false);

  const [workoutsThisWeek, setWorkoutsThisWeek] = useState(0);
  const [workoutMinutesThisWeek, setWorkoutMinutesThisWeek] = useState(0);
  const [streakDays, setStreakDays] = useState(0);

  const [mealsToday, setMealsToday] = useState(0);
  const [waterMlToday, setWaterMlToday] = useState(0);
  const [pendingWaterMl, setPendingWaterMl] = useState(0);
  const [addingWater, setAddingWater] = useState(false);

  const cardBg = isDarkmode ? COLORS.cardDark : COLORS.cardLight;
  const borderColor = isDarkmode ? COLORS.borderDark : COLORS.borderLight;
  const dimText = isDarkmode ? COLORS.dimDark : COLORS.dimLight;
  const dimText2 = isDarkmode ? COLORS.dimDark2 : COLORS.dimLight2;

  const userName =
    auth.currentUser?.displayName ||
    auth.currentUser?.email?.split("@")[0] ||
    "User";

  const todayStr = new Date().toLocaleDateString("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  const difficultyLabel = useMemo(() => {
    if (!pref?.difficulty) return null;
    if (pref.difficulty === "easy") return "Beginner";
    if (pref.difficulty === "moderate") return "Intermediate";
    return "Advanced";
  }, [pref?.difficulty]);

  const waterGoalMl = 2000;
  const waterMlTodayLive = waterMlToday + pendingWaterMl;
  const waterPct = Math.min(
    100,
    Math.round((waterMlTodayLive / waterGoalMl) * 100)
  );

  const weeklyGoal = pref?.workoutDays?.length ?? 0;
  const weeklyPct = weeklyGoal
    ? Math.min(100, Math.round((workoutsThisWeek / weeklyGoal) * 100))
    : 0;

  // ✅ IMPORTANT: check saved session whenever menu is focused (so Start → Continue updates instantly)
  const checkSavedSession = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const saved = await AsyncStorage.getItem(`session_${user.uid}`);
      setHasSavedSession(!!saved);
    } catch {
      setHasSavedSession(false);
    }
  }, [auth.currentUser]);

  const loadOnce = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;

    const prefSnap = await getDoc(doc(db, "WorkoutPreference", user.uid));
    setPref(prefSnap.exists() ? (prefSnap.data() as PrefData) : null);

    await checkSavedSession();
  }, [auth.currentUser, db, checkSavedSession]);

  useFocusEffect(
    useCallback(() => {
      // when user returns from WorkoutSession and lands on menu, update button immediately
      checkSavedSession();
    }, [checkSavedSession])
  );

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

    // Workouts (7d)
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

    const unsubWorkouts = onSnapshot(
      workoutQ,
      (snap) => {
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

        // streak
        let s = 0;
        for (let i = 0; i < 30; i++) {
          const checkDate = new Date(now);
          checkDate.setDate(now.getDate() - i);
          if (completedDates.has(dateKey(checkDate))) s++;
          else if (i !== 0) break;
        }
        setStreakDays(s);

        setLoading(false);
      },
      () => setLoading(false)
    );

    // Meals + Water today
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
      let water = 0;

      snap.forEach((d) => {
        const data: any = d.data();
        if (data?.isWater)
          water += typeof data.volumeMl === "number" ? data.volumeMl : 0;
        else mealCount += 1;
      });

      setMealsToday(mealCount);
      setWaterMlToday(water);
      setPendingWaterMl(0);
    });

    return () => {
      unsubWorkouts();
      unsubMeals();
    };
  }, [auth.currentUser, db, loadOnce]);

  const addWater250 = async () => {
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
        category: "Beverage",
        notes: "Water 💧",
        photoURL: null,
        isWater: true,
        volumeMl: 250,
        mealTimeClient: Timestamp.fromDate(now),
        createdAtClient: Timestamp.fromDate(now),
        mealTime: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    } catch {
      setPendingWaterMl((p) => Math.max(0, p - 250));
      Alert.alert("Error", "Could not save water entry.");
    } finally {
      setAddingWater(false);
    }
  };

  // --- UI components ---
  const RowCard = ({
    title,
    subtitle,
    icon,
    accent,
    onPress,
  }: {
    title: string;
    subtitle: string;
    icon: any;
    accent: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[styles.rowCard, { backgroundColor: cardBg, borderColor }]}
    >
      <View
        style={[
          styles.iconBubble,
          {
            backgroundColor: isDarkmode
              ? "rgba(255,255,255,0.05)"
              : "rgba(0,0,0,0.04)",
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={accent} />
      </View>

      <View style={{ flex: 1 }}>
        <Text fontWeight="bold" style={{ fontSize: 14 }}>
          {title}
        </Text>
        <Text style={{ fontSize: 12, color: dimText, marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={18} color={dimText2} />
    </TouchableOpacity>
  );

  const StatPill = ({
    icon,
    label,
    value,
    accent,
  }: {
    icon: any;
    label: string;
    value: string;
    accent: string;
  }) => (
    <View
      style={[
        styles.statPill,
        {
          backgroundColor: isDarkmode
            ? "rgba(255,255,255,0.04)"
            : "rgba(0,0,0,0.03)",
          borderColor: isDarkmode
            ? "rgba(255,255,255,0.06)"
            : "rgba(0,0,0,0.05)",
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={accent} />
      <View style={{ marginLeft: 8 }}>
        <Text
          style={{
            fontSize: 10,
            color: dimText2,
            fontWeight: "800",
            letterSpacing: 0.6,
          }}
        >
          {label.toUpperCase()}
        </Text>
        <Text fontWeight="bold" style={{ marginTop: 1 }}>
          {value}
        </Text>
      </View>
    </View>
  );

  const StartWorkoutCard = () => {
    // ✅ auto label based on saved session
    const title = hasSavedSession ? "Continue Workout" : "Start Workout";

    const subtitle = pref
      ? `${pref.goal} • ${difficultyLabel ?? "Intensity"} • ${
          pref.sessionLengthMinutes ?? 20
        } min`
      : "Set your goal & intensity to personalize your workouts";

    return (
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={() => navigation.navigate("WorkoutSession")}
        style={[styles.startCard, { backgroundColor: cardBg, borderColor }]}
      >
        <View
          pointerEvents="none"
          style={[
            styles.startHighlight,
            {
              backgroundColor: isDarkmode
                ? "rgba(59,130,246,0.10)"
                : "rgba(59,130,246,0.08)",
            },
          ]}
        />

        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View
            style={[
              styles.playBubble,
              {
                backgroundColor: isDarkmode
                  ? "rgba(59,130,246,0.16)"
                  : "rgba(59,130,246,0.10)",
                borderColor: isDarkmode
                  ? "rgba(59,130,246,0.28)"
                  : "rgba(59,130,246,0.22)",
              },
            ]}
          >
            <Ionicons
              name={hasSavedSession ? "play-skip-forward" : "play"}
              size={20}
              color={ACCENT.workout}
            />
          </View>

          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text fontWeight="bold" style={{ fontSize: 15 }}>
              {title}
            </Text>
            <Text style={{ fontSize: 12, color: dimText, marginTop: 3 }}>
              {subtitle}
            </Text>
          </View>

          <Ionicons name="arrow-forward" size={16} color={dimText} />
        </View>

        {/* weekly progress */}
        <View style={{ marginTop: 12 }}>
          <View style={styles.progressTopRow}>
            <Text style={{ fontSize: 12, color: dimText }}>This week</Text>
            <Text style={{ fontSize: 12, color: dimText }}>
              {weeklyGoal
                ? `${workoutsThisWeek}/${weeklyGoal} sessions`
                : "Set workout days"}
            </Text>
          </View>

          <View
            style={[
              styles.progressBg,
              {
                backgroundColor: isDarkmode
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.06)",
              },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${weeklyPct}%`, backgroundColor: ACCENT.workout },
              ]}
            />
          </View>

          <View style={styles.statRow}>
            <StatPill
              icon="flame"
              label="Streak"
              value={`${streakDays} day(s)`}
              accent={ACCENT.streak}
            />
            <StatPill
              icon="time"
              label="Minutes"
              value={`${workoutMinutesThisWeek} min`}
              accent={ACCENT.ok}
            />
          </View>

          <View style={styles.statRow}>
            <StatPill
              icon="restaurant"
              label="Meals"
              value={`${mealsToday} today`}
              accent={ACCENT.meal}
            />
            <StatPill
              icon="water"
              label="Hydration"
              value={`${waterPct}%`}
              accent={ACCENT.water}
            />
          </View>

          {/* ✅ Water progress bar (requested) */}
          <View style={{ marginTop: 12 }}>
            <View style={styles.progressTopRow}>
              <Text style={{ fontSize: 12, color: dimText }}>Water</Text>
              <Text style={{ fontSize: 12, color: dimText }}>
                {waterMlTodayLive}ml / {waterGoalMl}ml
              </Text>
            </View>

            <View
              style={[
                styles.progressBg,
                {
                  backgroundColor: isDarkmode
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.06)",
                },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  { width: `${waterPct}%`, backgroundColor: ACCENT.water },
                ]}
              />
            </View>

            <View style={styles.waterActionRow}>
              <Text style={{ fontSize: 12, color: dimText }}>
                {waterPct}% hydrated today
              </Text>

              <Button
                text={addingWater ? "..." : "+250ml"}
                size="sm"
                color={ACCENT.water}
                onPress={addWater250}
                disabled={addingWater}
                style={{ paddingHorizontal: 10 }}
              />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Layout>
      <TopNav
        middleContent="Fitness"
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
          <ActivityIndicator size="large" color={ACCENT.workout} />
          <Text style={{ marginTop: 10, opacity: 0.7 }}>Loading...</Text>
        </View>
      ) : (
        <ScrollView
          style={{
            flex: 1,
            backgroundColor: isDarkmode ? COLORS.bgDark : COLORS.bgLight,
          }}
          contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* ✅ Make this header section larger (requested) */}
          <View style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 13, color: dimText2 }}>{todayStr}</Text>

            <Text fontWeight="bold" style={{ fontSize: 22, marginTop: 4 }}>
              Welcome back, {userName}
            </Text>

            <Text
              style={{
                fontSize: 13,
                color: dimText,
                marginTop: 6,
                lineHeight: 18,
              }}
            >
              Your dashboard & shortcuts
            </Text>
          </View>

          {/* Dashboard card */}
          <StartWorkoutCard />

          {/* Rows like your screenshot */}
          <RowCard
            title="Log Meal"
            subtitle="Food type + photo"
            icon="restaurant"
            accent={ACCENT.meal}
            onPress={() => navigation.navigate("LogMeal")}
          />

          <RowCard
            title="Workout Profile"
            subtitle={
              pref
                ? `${pref.goal} • ${difficultyLabel ?? ""}`
                : "Goal, intensity, schedule"
            }
            icon="options"
            accent={ACCENT.profile}
            onPress={() => navigation.navigate("WorkoutPreference")}
          />

          <RowCard
            title="Weekly Summary"
            subtitle="Meaningful insights & trends"
            icon="analytics"
            accent={ACCENT.summary}
            onPress={() => navigation.navigate("WeeklySummary")}
          />
        </ScrollView>
      )}
    </Layout>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  rowCard: {
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
  },
  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  startCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 10,
    overflow: "hidden",
  },
  startHighlight: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 42,
  },
  playBubble: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  progressTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  progressBg: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },

  statRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  } as any,
  statPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },

  waterActionRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
