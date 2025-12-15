import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
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

// --- Theme ---
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
  active: "#3B82F6",
  workout: "#8B5CF6",
  meal: "#F97316",
  water: "#06B6D4",
  warn: "#F59E0B",
  good: "#22C55E",
};

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

const toDate = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00`);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const fmtRange = (start: string, end: string) => {
  const s = toDate(start);
  const e = toDate(end);
  const sTxt = s.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const eTxt = e.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${sTxt} – ${eTxt}`;
};

export default function WeeklySummaryScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const bg = isDarkmode ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDarkmode ? COLORS.cardDark : COLORS.cardLight;
  const borderColor = isDarkmode ? COLORS.borderDark : COLORS.borderLight;
  const dimText = isDarkmode ? COLORS.dimDark : COLORS.dimLight;
  const dimText2 = isDarkmode ? COLORS.dimDark2 : COLORS.dimLight2;

  const [stats, setStats] = useState<DayStat[]>(last7Days());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const unsubRef = useRef<null | (() => void)>(null);

  const loadData = useCallback(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      setRefreshing(false);
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
        waterMl: mealAgg[d.fullDate]?.waterMl || 0, // ✅ water comes from MealEntry like your menu
      }));

      setStats(merged);
      setLoading(false);
      setRefreshing(false);
    };

    // --- Workouts (same as menu) ---
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
        if (data.status !== "completed") return;

        const ts = data.createdAtClient?.toDate?.();
        if (!ts) return;

        const dateStr = ts.toISOString().slice(0, 10);
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

    // --- Meals + Water (✅ from MealEntry, matches your Quick Water button) ---
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

        const ts =
          data.mealTimeClient?.toDate?.() ||
          data.createdAtClient?.toDate?.() ||
          data.createdAt?.toDate?.();

        if (!ts) return;

        const dateStr = ts.toISOString().slice(0, 10);
        if (!mealAgg[dateStr]) mealAgg[dateStr] = { meals: 0, waterMl: 0 };

        const isWater =
          data.isWater === true ||
          data.mealType === "water" ||
          data.type === "water";

        if (isWater) {
          // ✅ FitnessMenu writes "volumeMl"
          const ml = Number(data.volumeMl ?? data.waterMl ?? data.ml ?? 0) || 0;
          mealAgg[dateStr].waterMl += ml;
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
  }, [auth.currentUser, db]);

  useEffect(() => {
    setLoading(true);
    unsubRef.current?.();
    unsubRef.current = loadData();

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    setLoading(true);
    unsubRef.current?.();
    unsubRef.current = loadData();
  };

  // --- Derived ---
  const labels = stats.map((d) => d.label);
  const minutesArr = stats.map((d) => d.workoutMinutes);
  const mealsArr = stats.map((d) => d.meals);
  const waterCupsArr = stats.map((d) => Math.round(d.waterMl / 250));

  const totalMinutes = minutesArr.reduce((a, b) => a + b, 0);
  const totalWorkouts = stats.reduce((a, b) => a + b.workouts, 0);
  const totalMeals = mealsArr.reduce((a, b) => a + b, 0);
  const totalWaterMl = stats.reduce((a, b) => a + b.waterMl, 0);

  const avgMinutes = Math.round(totalMinutes / 7);
  const avgCups = Math.round(totalWaterMl / 250 / 7);

  const workoutDays = stats.filter((d) => d.workouts > 0).length;
  const mealDays = stats.filter((d) => d.meals > 0).length;

  const WATER_GOAL_CUPS = 8;
  const waterGoalDays = waterCupsArr.filter((c) => c >= WATER_GOAL_CUPS).length;

  const bestIdx = (arr: number[]) => {
    let best = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
    return best;
  };

  const bestMinuteDayIdx = useMemo(() => bestIdx(minutesArr), [minutesArr]);
  const bestMealDayIdx = useMemo(() => bestIdx(mealsArr), [mealsArr]);
  const bestWaterDayIdx = useMemo(() => bestIdx(waterCupsArr), [waterCupsArr]);

  const rangeText = useMemo(() => {
    if (!stats.length) return "Last 7 days";
    return fmtRange(stats[0].fullDate, stats[stats.length - 1].fullDate);
  }, [stats]);

  const insights = useMemo(() => {
    const lines: { icon: any; color: string; text: string }[] = [];

    if (totalWorkouts === 0) {
      lines.push({
        icon: "fitness",
        color: ACCENT.workout,
        text: "No workouts this week. Start with a short session (5–10 min) to build momentum.",
      });
    } else if (workoutDays < 3) {
      lines.push({
        icon: "trending-up",
        color: ACCENT.workout,
        text: `You trained ${workoutDays}/7 days. Aim for 3–4 days/week for a strong baseline.`,
      });
    } else {
      lines.push({
        icon: "trophy",
        color: ACCENT.good,
        text: `Great consistency: ${workoutDays}/7 days trained. Keep recovery balanced.`,
      });
    }

    if (totalWaterMl === 0) {
      lines.push({
        icon: "water",
        color: ACCENT.water,
        text: "No water logged this week. Tap Quick Water to start tracking hydration.",
      });
    } else if (avgCups < WATER_GOAL_CUPS) {
      lines.push({
        icon: "water-outline",
        color: ACCENT.water,
        text: `Hydration average ~${avgCups} cups/day. Add 1–2 cups around lunch.`,
      });
    } else {
      lines.push({
        icon: "shield-checkmark",
        color: ACCENT.good,
        text: `Hydration is strong: ~${avgCups} cups/day. Nice consistency.`,
      });
    }

    if (totalMeals === 0) {
      lines.push({
        icon: "restaurant",
        color: ACCENT.meal,
        text: "No meals logged. Log meals with a photo + dish name to build awareness.",
      });
    } else if (mealDays < 4) {
      lines.push({
        icon: "camera",
        color: ACCENT.meal,
        text: `Meals logged on ${mealDays}/7 days. Try 1 meal/day for better tracking.`,
      });
    } else {
      lines.push({
        icon: "sparkles",
        color: ACCENT.good,
        text: `Meal logging is consistent (${mealDays}/7 days). Keep it simple.`,
      });
    }

    return lines.slice(0, 3);
  }, [totalWorkouts, workoutDays, totalWaterMl, avgCups, totalMeals, mealDays]);

  const getMaxSegments = (arr: number[]) => {
    const maxVal = Math.max(...arr, 1);
    return maxVal < 5 ? maxVal : 4;
  };

  const chartConfig = (colorHex: string) => ({
    backgroundGradientFrom: cardBg,
    backgroundGradientTo: cardBg,
    decimalPlaces: 0,
    color: () => colorHex,
    labelColor: () =>
      isDarkmode ? `rgba(255,255,255,0.75)` : `rgba(17,24,39,0.55)`,
    propsForDots: { r: "4", strokeWidth: "2", stroke: colorHex },
    propsForBackgroundLines: {
      stroke: isDarkmode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    },
    barPercentage: 0.62,
    style: { borderRadius: 18 },
  });

  const StatCard = ({
    icon,
    title,
    value,
    subtitle,
    color,
  }: {
    icon: any;
    title: string;
    value: string;
    subtitle: string;
    color: string;
  }) => (
    <View style={[styles.statCard, { backgroundColor: cardBg, borderColor }]}>
      <View
        style={[
          styles.statIcon,
          {
            backgroundColor: isDarkmode
              ? "rgba(255,255,255,0.05)"
              : "rgba(0,0,0,0.04)",
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={{ color: dimText, fontSize: 12, marginTop: 10 }}>
        {title}
      </Text>
      <Text style={{ fontSize: 20, fontWeight: "900", marginTop: 4 }}>
        {value}
      </Text>
      <Text style={{ color: dimText2, fontSize: 12, marginTop: 2 }}>
        {subtitle}
      </Text>
    </View>
  );

  const ProgressRow = ({
    label,
    valueText,
    ratio,
    color,
  }: {
    label: string;
    valueText: string;
    ratio: number;
    color: string;
  }) => (
    <View style={{ marginTop: 12 }}>
      <View style={styles.progressTopRow}>
        <Text style={{ fontWeight: "900" }}>{label}</Text>
        <Text style={{ color: dimText, fontSize: 12 }}>{valueText}</Text>
      </View>
      <View
        style={[
          styles.progressTrack,
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
            {
              width: `${Math.round(clamp01(ratio) * 100)}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>
    </View>
  );

  const ChartCard = ({
    icon,
    title,
    subtitle,
    children,
  }: {
    icon: any;
    title: string;
    subtitle: string;
    children: React.ReactNode;
  }) => (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
      <View style={styles.cardHeader}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 10 } as any}
        >
          <View
            style={[
              styles.headerIcon,
              {
                backgroundColor: isDarkmode
                  ? "rgba(255,255,255,0.05)"
                  : "rgba(0,0,0,0.04)",
              },
            ]}
          >
            <Ionicons name={icon} size={18} color={ACCENT.active} />
          </View>
          <View>
            <Text style={{ fontWeight: "900" }}>{title}</Text>
            <Text style={{ fontSize: 12, color: dimText, marginTop: 2 }}>
              {subtitle}
            </Text>
          </View>
        </View>
      </View>
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );

  const EmptyState = ({ text }: { text: string }) => (
    <View
      style={[
        styles.emptyBox,
        {
          borderColor: isDarkmode
            ? "rgba(255,255,255,0.08)"
            : "rgba(0,0,0,0.08)",
          backgroundColor: isDarkmode
            ? "rgba(255,255,255,0.03)"
            : "rgba(0,0,0,0.03)",
        },
      ]}
    >
      <Text style={{ color: dimText, textAlign: "center" }}>{text}</Text>
    </View>
  );

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
        <View style={[styles.center, { backgroundColor: bg }]}>
          <ActivityIndicator size="large" color={ACCENT.active} />
          <Text style={{ marginTop: 10, opacity: 0.7 }}>
            Calculating insights...
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1, backgroundColor: bg }}
          contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <View style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 24, fontWeight: "900" }}>Your Week</Text>
            <Text style={{ color: dimText, marginTop: 6, fontSize: 13 }}>
              {rangeText}
            </Text>
          </View>

          <View style={styles.grid}>
            <StatCard
              icon="time"
              title="Active Minutes"
              value={`${totalMinutes}m`}
              subtitle={`Avg ${avgMinutes}m/day`}
              color={ACCENT.active}
            />
            <StatCard
              icon="fitness"
              title="Workouts"
              value={`${totalWorkouts}`}
              subtitle={`${workoutDays}/7 days`}
              color={ACCENT.workout}
            />
            <StatCard
              icon="restaurant"
              title="Meals Logged"
              value={`${totalMeals}`}
              subtitle={`${mealDays}/7 days`}
              color={ACCENT.meal}
            />
            <StatCard
              icon="water"
              title="Hydration"
              value={`${Math.round(totalWaterMl / 250)} cups`}
              subtitle={`${waterGoalDays}/7 goal days`}
              color={ACCENT.water}
            />
          </View>

          <Section style={{ marginTop: 12 }}>
            <View
              style={[styles.card, { backgroundColor: cardBg, borderColor }]}
            >
              <View style={styles.cardHeader}>
                <View
                  style={
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    } as any
                  }
                >
                  <View
                    style={[
                      styles.headerIcon,
                      {
                        backgroundColor: isDarkmode
                          ? "rgba(255,255,255,0.05)"
                          : "rgba(0,0,0,0.04)",
                      },
                    ]}
                  >
                    <Ionicons name="pulse" size={18} color={ACCENT.good} />
                  </View>
                  <View>
                    <Text style={{ fontWeight: "900" }}>Weekly Goals</Text>
                    <Text
                      style={{ fontSize: 12, color: dimText, marginTop: 2 }}
                    >
                      These show consistency (not just totals)
                    </Text>
                  </View>
                </View>
              </View>

              <ProgressRow
                label="Workout consistency"
                valueText={`${workoutDays}/7 days`}
                ratio={workoutDays / 7}
                color={ACCENT.workout}
              />
              <ProgressRow
                label="Meal logging"
                valueText={`${mealDays}/7 days`}
                ratio={mealDays / 7}
                color={ACCENT.meal}
              />
              <ProgressRow
                label="Hydration goal"
                valueText={`${waterGoalDays}/7 days (≥ 8 cups)`}
                ratio={waterGoalDays / 7}
                color={ACCENT.water}
              />
            </View>
          </Section>

          <Section style={{ marginTop: 12 }}>
            <View
              style={[styles.card, { backgroundColor: cardBg, borderColor }]}
            >
              <View style={styles.cardHeader}>
                <View
                  style={
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    } as any
                  }
                >
                  <View
                    style={[
                      styles.headerIcon,
                      {
                        backgroundColor: isDarkmode
                          ? "rgba(255,255,255,0.05)"
                          : "rgba(0,0,0,0.04)",
                      },
                    ]}
                  >
                    <Ionicons name="bulb" size={18} color={ACCENT.warn} />
                  </View>
                  <View>
                    <Text style={{ fontWeight: "900" }}>Insights</Text>
                    <Text
                      style={{ fontSize: 12, color: dimText, marginTop: 2 }}
                    >
                      What your data suggests this week
                    </Text>
                  </View>
                </View>
              </View>

              {insights.map((it, idx) => (
                <View key={idx} style={styles.insightRow}>
                  <Ionicons name={it.icon} size={18} color={it.color} />
                  <Text
                    style={{
                      marginLeft: 10,
                      color: dimText,
                      lineHeight: 20,
                      flex: 1,
                    }}
                  >
                    {it.text}
                  </Text>
                </View>
              ))}
            </View>
          </Section>

          <Section style={{ marginTop: 12 }}>
            <ChartCard
              icon="bar-chart"
              title="Active Minutes"
              subtitle={
                totalMinutes === 0
                  ? "Shows workout consistency over the week"
                  : `Best day: ${labels[bestMinuteDayIdx]} • Avg: ${avgMinutes}m/day`
              }
            >
              {totalMinutes === 0 ? (
                <EmptyState text="No workouts logged yet. Complete one session to see your trend." />
              ) : (
                <LineChart
                  data={{ labels, datasets: [{ data: minutesArr }] }}
                  width={screenWidth - 28}
                  height={220}
                  yAxisLabel=""
                  yAxisSuffix=""
                  fromZero
                  chartConfig={chartConfig(ACCENT.active)}
                  bezier
                  style={{ borderRadius: 18 }}
                  segments={getMaxSegments(minutesArr)}
                  withInnerLines
                  withOuterLines={false}
                />
              )}
            </ChartCard>

            <View style={{ height: 12 }} />

            <ChartCard
              icon="restaurant"
              title="Meal Logging"
              subtitle={
                totalMeals === 0
                  ? "See how consistent your meal logging is"
                  : `Most logged: ${labels[bestMealDayIdx]} • ${mealDays}/7 days logged`
              }
            >
              {totalMeals === 0 ? (
                <EmptyState text="No meals logged. Log meals with a photo + dish name to build a habit." />
              ) : (
                <BarChart
                  data={{ labels, datasets: [{ data: mealsArr }] }}
                  width={screenWidth - 28}
                  height={220}
                  yAxisLabel=""
                  yAxisSuffix=""
                  fromZero
                  chartConfig={chartConfig(ACCENT.meal)}
                  style={{ borderRadius: 18 }}
                  segments={getMaxSegments(mealsArr)}
                  showBarTops={false}
                  withInnerLines
                />
              )}
            </ChartCard>

            <View style={{ height: 12 }} />

            <ChartCard
              icon="water"
              title="Hydration"
              subtitle={
                totalWaterMl === 0
                  ? "Track cups per day (goal: 8 cups)"
                  : `Best day: ${labels[bestWaterDayIdx]} • Goal met: ${waterGoalDays}/7 days`
              }
            >
              {totalWaterMl === 0 ? (
                <EmptyState text="No water logged. Use Quick Water to add 250ml entries." />
              ) : (
                <BarChart
                  data={{ labels, datasets: [{ data: waterCupsArr }] }}
                  width={screenWidth - 28}
                  height={220}
                  yAxisLabel=""
                  yAxisSuffix=""
                  fromZero
                  chartConfig={chartConfig(ACCENT.water)}
                  style={{ borderRadius: 18 }}
                  segments={getMaxSegments(waterCupsArr)}
                  showBarTops={false}
                  withInnerLines
                />
              )}

              <View style={styles.goalHint}>
                <Ionicons name="flag" size={14} color={dimText2} />
                <Text style={{ marginLeft: 8, fontSize: 12, color: dimText }}>
                  Goal: 8 cups/day (≈ 2000ml)
                </Text>
              </View>
            </ChartCard>
          </Section>
        </ScrollView>
      )}
    </Layout>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  } as any,

  statCard: {
    width: (screenWidth - 14 * 2 - 12) / 2,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  progressTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },

  insightRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 12,
  },

  emptyBox: {
    height: 170,
    borderWidth: 1,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },

  goalHint: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
  },

  backPill: {
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
});
