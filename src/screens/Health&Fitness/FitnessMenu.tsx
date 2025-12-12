import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
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
} from "firebase/firestore";

type Props = NativeStackScreenProps<MainStackParamList, "FitnessMenu">;

type PrefData = {
  goal: string;
  difficulty: "easy" | "moderate" | "hard";
  workoutDays: string[];
  sessionLengthMinutes: number;
};

export default function FitnessMenu({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const [pref, setPref] = useState<PrefData | null>(null);
  const [workoutsThisWeek, setWorkoutsThisWeek] = useState(0);
  const [mealsToday, setMealsToday] = useState(0);
  const [loading, setLoading] = useState(true);

  // Load dashboard data: preference + quick stats
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      try {
        // 1) Load workout preference
        const prefRef = doc(db, "WorkoutPreference", user.uid);
        const prefSnap = await getDoc(prefRef);
        if (prefSnap.exists()) {
          const data = prefSnap.data() as any;
          setPref({
            goal: data.goal || "",
            difficulty: (data.difficulty || "easy") as
              | "easy"
              | "moderate"
              | "hard",
            workoutDays: data.workoutDays || [],
            sessionLengthMinutes: data.sessionLengthMinutes || 20,
          });
        } else {
          setPref(null);
        }

        // 2) Workouts this week
        const now = new Date();
        const sevenDaysAgo = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - 6
        );
        const startWeekTs = Timestamp.fromDate(sevenDaysAgo);

        const workoutQ = query(
          collection(db, "WorkoutSession"),
          where("userId", "==", user.uid),
          where("createdAt", ">=", startWeekTs)
        );
        const workoutSnap = await getDocs(workoutQ);
        setWorkoutsThisWeek(workoutSnap.size);

        // 3) Meals today
        const todayStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
          0
        );
        const todayTs = Timestamp.fromDate(todayStart);

        const mealQ = query(
          collection(db, "MealEntry"),
          where("userId", "==", user.uid),
          where("mealTime", ">=", todayTs)
        );
        const mealSnap = await getDocs(mealQ);
        setMealsToday(mealSnap.size);
      } catch (err) {
        console.log("FitnessMenu load error:", err);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, []);

  const userName =
    auth.currentUser?.displayName || auth.currentUser?.email || "User";

  const todayStr = new Date().toLocaleDateString("en-MY", {
    weekday: "long",
    month: "short",
    day: "2-digit",
  });

  const difficultyText =
    pref?.difficulty === "easy"
      ? "Light & beginner-friendly"
      : pref?.difficulty === "moderate"
      ? "Balanced challenge"
      : pref?.difficulty === "hard"
      ? "High intensity"
      : "Not set yet";

  const daysLabel = pref?.workoutDays?.length
    ? pref.workoutDays.join(", ")
    : "Not selected yet";

  return (
    <Layout>
      <TopNav
        middleContent="Health & Fitness"
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
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 10 }}>Loading your dashboard...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          {/* Greeting */}
          <View style={styles.header}>
            <Text size="h3" fontWeight="bold">
              Hi, {userName}
            </Text>
            <Text style={{ marginTop: 4, opacity: 0.7 }}>{todayStr}</Text>
            <Text style={{ marginTop: 8 }}>
              Here’s your health & fitness overview.
            </Text>
          </View>

          {/* Quick stats */}
          <View style={styles.row}>
            <Section style={[styles.card, styles.cardHalf]}>
              <Text size="lg" fontWeight="bold">
                Workouts this week
              </Text>
              <Text size="h1" fontWeight="bold" style={{ marginTop: 4 }}>
                {workoutsThisWeek}
              </Text>
              <Text style={{ marginTop: 4, opacity: 0.7 }}>
                Completed sessions in the last 7 days.
              </Text>
            </Section>

            <Section style={[styles.card, styles.cardHalf]}>
              <Text size="lg" fontWeight="bold">
                Meals today
              </Text>
              <Text size="h1" fontWeight="bold" style={{ marginTop: 4 }}>
                {mealsToday}
              </Text>
              <Text style={{ marginTop: 4, opacity: 0.7 }}>
                Logged meal entries since midnight.
              </Text>
            </Section>
          </View>

          {/* Workout plan card */}
          <Section style={styles.card}>
            <Text size="h4" fontWeight="bold">
              Your Workout Plan
            </Text>

            {pref ? (
              <>
                <Text style={styles.line}>
                  Goal: <Text fontWeight="bold">{pref.goal}</Text>
                </Text>
                <Text style={styles.line}>
                  Difficulty: <Text fontWeight="bold">{difficultyText}</Text>
                </Text>
                <Text style={styles.line}>
                  Days: <Text fontWeight="bold">{daysLabel}</Text>
                </Text>
                <Text style={styles.line}>
                  Session length:{" "}
                  <Text fontWeight="bold">
                    {pref.sessionLengthMinutes} minutes
                  </Text>
                </Text>
              </>
            ) : (
              <Text style={{ marginTop: 8 }}>
                You have not set your workout preference profile yet.
              </Text>
            )}

            <View style={{ marginTop: 12 }}>
              <Button
                text={pref ? "Start Workout Session" : "Set Up Your Plan"}
                onPress={() =>
                  pref
                    ? navigation.navigate("WorkoutSession")
                    : navigation.navigate("WorkoutPreference")
                }
              />
            </View>
          </Section>

          {/* Actions */}
          <Section style={styles.card}>
            <Text size="h4" fontWeight="bold">
              Quick Actions
            </Text>

            <Button
              text="Manage Workout Preference Profile"
              onPress={() => navigation.navigate("WorkoutPreference")}
              style={{ marginTop: 12 }}
            />
            <Button
              text="Log Meal Entry"
              onPress={() => navigation.navigate("LogMeal")}
              style={{ marginTop: 10 }}
            />
            <Button
              text="View Weekly Summary"
              onPress={() => navigation.navigate("WeeklySummary")}
              style={{ marginTop: 10 }}
            />
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
  header: {
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  } as any,
  card: {
    borderRadius: 16,
    marginBottom: 12,
  },
  cardHalf: {
    flex: 1,
  },
  line: {
    marginTop: 6,
  },
});
