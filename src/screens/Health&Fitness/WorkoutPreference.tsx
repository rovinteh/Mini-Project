import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  TextInput,
  Button,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

type Props = NativeStackScreenProps<MainStackParamList, "WorkoutPreference">;

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function WorkoutPreferenceScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const [goal, setGoal] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "moderate" | "hard">(
    "easy"
  );
  const [selectedDays, setSelectedDays] = useState<string[]>([
    "Mon",
    "Wed",
    "Fri",
  ]);
  const [sessionLength, setSessionLength] = useState("20"); // minutes
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load existing preference
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const ref = doc(db, "WorkoutPreference", user.uid);

    (async () => {
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as any;
          setGoal(data.goal || "");
          setDifficulty(data.difficulty || "easy");
          setSelectedDays(data.workoutDays || ["Mon", "Wed", "Fri"]);
          setSessionLength(
            data.sessionLengthMinutes ? String(data.sessionLengthMinutes) : "20"
          );
        }
      } catch (err) {
        console.log("Error loading preference:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const onSave = async () => {
    const user = auth.currentUser;
    if (!user) {
      alert("Please log in first.");
      return;
    }

    if (!goal.trim()) {
      alert("Please enter your fitness goal.");
      return;
    }

    if (selectedDays.length === 0) {
      alert("Please choose at least one workout day.");
      return;
    }

    const lengthNumber = parseInt(sessionLength, 10);
    if (isNaN(lengthNumber) || lengthNumber < 5) {
      alert("Please enter a valid session length (minimum 5 minutes).");
      return;
    }

    setSaving(true);
    try {
      const ref = doc(db, "WorkoutPreference", user.uid);
      await setDoc(
        ref,
        {
          goal: goal.trim(),
          difficulty,
          workoutDays: selectedDays,
          sessionLengthMinutes: lengthNumber,
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      );
      alert("Workout preference profile saved.");
    } catch (err: any) {
      alert("Error saving preference: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Simple “preview” based on difficulty + days + length
  const sessionsPerWeek = selectedDays.length;
  const intensityLabel =
    difficulty === "easy"
      ? "Light & beginner-friendly"
      : difficulty === "moderate"
      ? "Balanced challenge"
      : "High intensity";

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: "height" })}
      style={{ flex: 1 }}
    >
      <Layout>
        <TopNav
          middleContent="Workout Preference Profile"
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
            <Text>Loading your preference...</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {/* Preview card */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: isDarkmode ? "#17171E" : "#eef2ff",
                  borderColor: isDarkmode ? "#333" : "#c7d2fe",
                },
              ]}
            >
              <Text size="h4" fontWeight="bold">
                Your Current Plan
              </Text>
              <Text style={styles.previewLine}>
                Goal: <Text fontWeight="bold">{goal || "Not set yet"}</Text>
              </Text>
              <Text style={styles.previewLine}>
                Sessions per week:{" "}
                <Text fontWeight="bold">{sessionsPerWeek}</Text>
              </Text>
              <Text style={styles.previewLine}>
                Session length:{" "}
                <Text fontWeight="bold">{sessionLength || "20"} mins</Text>
              </Text>
              <Text style={styles.previewLine}>
                Intensity: <Text fontWeight="bold">{intensityLabel}</Text>
              </Text>
            </View>

            {/* Form */}
            <View style={styles.section}>
              <Text fontWeight="bold">Fitness Goal</Text>
              <TextInput
                containerStyle={{ marginTop: 10 }}
                placeholder="e.g. Lose 5kg, improve stamina"
                value={goal}
                onChangeText={setGoal}
              />
            </View>

            <View style={styles.section}>
              <Text fontWeight="bold">Difficulty</Text>
              <View style={styles.chipRow}>
                {[
                  { label: "Easy", value: "easy" },
                  { label: "Moderate", value: "moderate" },
                  { label: "Hard", value: "hard" },
                ].map((opt) => {
                  const active = difficulty === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.chip,
                        active && {
                          backgroundColor: themeColor.primary,
                        },
                      ]}
                      onPress={() =>
                        setDifficulty(opt.value as "easy" | "moderate" | "hard")
                      }
                    >
                      <Text
                        style={{
                          color: active
                            ? themeColor.white100
                            : isDarkmode
                            ? themeColor.white100
                            : themeColor.dark,
                        }}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text fontWeight="bold">Workout Days</Text>
              <Text style={{ marginTop: 4, opacity: 0.7 }}>
                Tap to select which days you plan to exercise.
              </Text>
              <View style={styles.chipRowWrap}>
                {WEEK_DAYS.map((day) => {
                  const active = selectedDays.includes(day);
                  return (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.chip,
                        styles.dayChip,
                        active && { backgroundColor: themeColor.primary },
                      ]}
                      onPress={() => toggleDay(day)}
                    >
                      <Text
                        style={{
                          color: active
                            ? themeColor.white100
                            : isDarkmode
                            ? themeColor.white100
                            : themeColor.dark,
                        }}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text fontWeight="bold">Session Length (minutes)</Text>
              <TextInput
                containerStyle={{ marginTop: 10, width: 120 }}
                keyboardType="numeric"
                value={sessionLength}
                onChangeText={setSessionLength}
              />
              <Text style={{ marginTop: 4, opacity: 0.7 }}>
                This will be used when generating your workout steps.
              </Text>
            </View>

            <Button
              text={saving ? "Saving..." : "Save Preference"}
              onPress={onSave}
              style={{ marginTop: 16 }}
              disabled={saving}
            />
          </ScrollView>
        )}
      </Layout>
    </KeyboardAvoidingView>
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
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  previewLine: {
    marginTop: 6,
  },
  section: {
    marginBottom: 16,
  },
  chipRow: {
    flexDirection: "row",
    marginTop: 10,
  },
  chipRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    marginRight: 8,
    marginBottom: 8,
  },
  dayChip: {
    minWidth: 52,
    alignItems: "center",
  },
});
