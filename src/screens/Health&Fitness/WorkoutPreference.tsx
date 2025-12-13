import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
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
  TextInput,
  Button,
  Section,
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

// --- Vibrant Palette ---
const COLOR_ABOUT = "#3B82F6"; // Blue
const COLOR_GOAL = "#8B5CF6"; // Purple
const COLOR_INTENSITY = "#F97316"; // Orange
const COLOR_SCHEDULE = "#10B981"; // Emerald
const FITNESS_COLOR = "#22C55E"; // Keep for save button / main accents

// Helper to get suggested minutes
const recommendMinutes = (difficulty: "easy" | "moderate" | "hard") => {
  if (difficulty === "easy") return 20;
  if (difficulty === "moderate") return 30;
  return 45;
};

export default function WorkoutPreferenceScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  // --- Form State ---
  const [goal, setGoal] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "moderate" | "hard">(
    "easy"
  );
  const [selectedDays, setSelectedDays] = useState<string[]>([
    "Mon",
    "Wed",
    "Fri",
  ]);
  const [sessionLength, setSessionLength] = useState("20");

  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  // --- Load Data Function ---
  const loadData = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const ref = doc(db, "WorkoutPreference", user.uid);
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
        setHeight(data.height ? String(data.height) : "");
        setWeight(data.weight ? String(data.weight) : "");
      }
    } catch (err) {
      console.log("Error loading preference:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [auth.currentUser, db]);

  // Initial Load
  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const applyPresetSchedule = (type: "light" | "standard" | "active") => {
    if (type === "light") setSelectedDays(["Tue", "Thu"]);
    if (type === "standard") setSelectedDays(["Mon", "Wed", "Fri"]);
    if (type === "active") setSelectedDays(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  };

  const handleDifficultyChange = (level: "easy" | "moderate" | "hard") => {
    setDifficulty(level);
    // Auto-update duration suggestion
    setSessionLength(String(recommendMinutes(level)));
  };

  // Real-time BMI
  const bmiStats = useMemo(() => {
    const h = parseFloat(height);
    const w = parseFloat(weight);

    if (!h || !w || h <= 0 || w <= 0) return null;

    const hM = h / 100;
    const bmiVal = w / (hM * hM);
    const score = bmiVal.toFixed(1);

    let label = "Normal Weight";
    let color = FITNESS_COLOR;

    if (bmiVal < 18.5) {
      label = "Underweight";
      color = "#F59E0B";
    } else if (bmiVal >= 25 && bmiVal < 30) {
      label = "Overweight";
      color = "#F59E0B";
    } else if (bmiVal >= 30) {
      label = "Obese";
      color = "#EF4444";
    }

    return { score, label, color };
  }, [height, weight]);

  const onSave = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Error", "Please log in first.");
      return;
    }

    if (!goal.trim()) {
      Alert.alert("Missing Info", "Please enter your fitness goal.");
      return;
    }

    if (selectedDays.length === 0) {
      Alert.alert("Missing Info", "Please choose at least one workout day.");
      return;
    }

    const lengthNumber = parseInt(sessionLength, 10);
    if (isNaN(lengthNumber) || lengthNumber < 5 || lengthNumber > 120) {
      Alert.alert(
        "Invalid Input",
        "Session length must be between 5–120 minutes."
      );
      return;
    }

    const h = height.trim() ? parseFloat(height) : null;
    const w = weight.trim() ? parseFloat(weight) : null;

    if (h !== null && (isNaN(h) || h < 80 || h > 250)) {
      Alert.alert("Invalid Height", "Height should be between 80–250 cm.");
      return;
    }
    if (w !== null && (isNaN(w) || w < 20 || w > 300)) {
      Alert.alert("Invalid Weight", "Weight should be between 20–300 kg.");
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
          height: h,
          weight: w,
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      );
      Alert.alert("Saved", "Your fitness profile has been updated.");
      navigation.goBack();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: "height" })}
      style={{ flex: 1 }}
    >
      <Layout>
        <TopNav
          middleContent="Workout Profile"
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
            <Text>Loading profile...</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingBottom: 32 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
          >
            {/* 1) About You (Blue) */}
            <Section style={styles.card}>
              <View style={styles.sectionTitleRow}>
                <Ionicons
                  name="body"
                  size={20}
                  color={COLOR_ABOUT}
                  style={{ marginRight: 8 }}
                />
                <Text size="h4" fontWeight="bold">
                  About You
                </Text>
              </View>

              <Text style={styles.subtext}>
                Optional, but improves BMI & future personalisation.
              </Text>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Height (cm)</Text>
                  <TextInput
                    placeholder="175"
                    keyboardType="numeric"
                    value={height}
                    onChangeText={(v) => setHeight(v.replace(/[^\d.]/g, ""))}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Weight (kg)</Text>
                  <TextInput
                    placeholder="70"
                    keyboardType="numeric"
                    value={weight}
                    onChangeText={(v) => setWeight(v.replace(/[^\d.]/g, ""))}
                  />
                </View>
              </View>

              {bmiStats && (
                <View
                  style={[
                    styles.bmiContainer,
                    { backgroundColor: isDarkmode ? "#1f2937" : "#f0f9ff" },
                  ]}
                >
                  <Text style={{ fontSize: 13, opacity: 0.8 }}>
                    Estimated BMI
                  </Text>
                  <Text
                    size="h2"
                    fontWeight="bold"
                    style={{ color: bmiStats.color, marginVertical: 2 }}
                  >
                    {bmiStats.score}
                  </Text>
                  <Text fontWeight="bold" style={{ color: bmiStats.color }}>
                    {bmiStats.label}
                  </Text>
                </View>
              )}
            </Section>

            {/* 2) Goal (Purple) */}
            <Section style={styles.card}>
              <View style={styles.sectionTitleRow}>
                <Ionicons
                  name="trophy"
                  size={20}
                  color={COLOR_GOAL}
                  style={{ marginRight: 8 }}
                />
                <Text size="h4" fontWeight="bold">
                  Your Goal
                </Text>
              </View>

              <TextInput
                placeholder="e.g. Lose 5kg, Run a 5k..."
                value={goal}
                onChangeText={setGoal}
              />

              <View style={styles.chipContainer}>
                {[
                  "Fat Loss",
                  "Muscle Gain",
                  "Better Stamina",
                  "Stay Active",
                ].map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[
                      styles.chip,
                      {
                        borderColor: goal === g ? COLOR_GOAL : "transparent",
                        borderWidth: 1,
                        backgroundColor:
                          goal === g
                            ? isDarkmode
                              ? "rgba(139, 92, 246, 0.2)"
                              : "#F3E8FF"
                            : "rgba(150,150,150,0.1)",
                      },
                    ]}
                    onPress={() => setGoal(g)}
                  >
                    <Text
                      size="sm"
                      fontWeight={goal === g ? "bold" : "normal"}
                      style={{ color: goal === g ? COLOR_GOAL : undefined }}
                    >
                      {g}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Section>

            {/* 3) Intensity (Orange) */}
            <Section style={styles.card}>
              <View style={styles.sectionTitleRow}>
                <Ionicons
                  name="speedometer"
                  size={20}
                  color={COLOR_INTENSITY}
                  style={{ marginRight: 8 }}
                />
                <Text size="h4" fontWeight="bold">
                  Intensity
                </Text>
              </View>

              <View style={styles.radioContainer}>
                {[
                  {
                    label: "Beginner",
                    val: "easy",
                    desc: "Light (~20m)",
                    time: 20,
                  },
                  {
                    label: "Balanced",
                    val: "moderate",
                    desc: "Sweat (~30m)",
                    time: 30,
                  },
                  {
                    label: "Intense",
                    val: "hard",
                    desc: "Push (~45m)",
                    time: 45,
                  },
                ].map((opt) => {
                  const active = difficulty === opt.val;
                  return (
                    <TouchableOpacity
                      key={opt.val}
                      style={[
                        styles.radioBtn,
                        {
                          borderColor: active
                            ? COLOR_INTENSITY
                            : isDarkmode
                            ? "#374151"
                            : "#e2e8f0",
                        },
                        active && {
                          backgroundColor: isDarkmode
                            ? "rgba(249, 115, 22, 0.15)"
                            : "#FFF7ED",
                        },
                      ]}
                      onPress={() =>
                        handleDifficultyChange(
                          opt.val as "easy" | "moderate" | "hard"
                        )
                      }
                    >
                      <Text
                        fontWeight={active ? "bold" : "normal"}
                        style={{
                          color: active ? COLOR_INTENSITY : undefined,
                        }}
                      >
                        {opt.label}
                      </Text>
                      <Text
                        size="sm"
                        style={{
                          opacity: active ? 1 : 0.6,
                          fontSize: 10,
                          marginTop: 2,
                          color: active ? COLOR_INTENSITY : undefined,
                        }}
                      >
                        {opt.desc}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Section>

            {/* 4) Schedule (Emerald) */}
            <Section style={styles.card}>
              <View style={styles.sectionTitleRow}>
                <Ionicons
                  name="calendar"
                  size={20}
                  color={COLOR_SCHEDULE}
                  style={{ marginRight: 8 }}
                />
                <Text size="h4" fontWeight="bold">
                  Schedule
                </Text>
              </View>

              <Text style={styles.label}>Weekly Frequency</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                <TouchableOpacity
                  onPress={() => applyPresetSchedule("light")}
                  style={[
                    styles.quickBtn,
                    { backgroundColor: isDarkmode ? "#1f2937" : "#f3f4f6" },
                  ]}
                >
                  <Text style={{ fontSize: 12 }}>Light (2x)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => applyPresetSchedule("standard")}
                  style={[
                    styles.quickBtn,
                    { backgroundColor: isDarkmode ? "#1f2937" : "#f3f4f6" },
                  ]}
                >
                  <Text style={{ fontSize: 12 }}>Standard (3x)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => applyPresetSchedule("active")}
                  style={[
                    styles.quickBtn,
                    { backgroundColor: isDarkmode ? "#1f2937" : "#f3f4f6" },
                  ]}
                >
                  <Text style={{ fontSize: 12 }}>Active (5x)</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Customize Days</Text>
              <View style={styles.chipContainer}>
                {WEEK_DAYS.map((day) => {
                  const active = selectedDays.includes(day);
                  return (
                    <TouchableOpacity
                      key={day}
                      onPress={() => toggleDay(day)}
                      style={[
                        styles.dayChip,
                        {
                          backgroundColor: active
                            ? COLOR_SCHEDULE
                            : "transparent",
                          borderColor: active ? COLOR_SCHEDULE : "#cbd5e1",
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: active ? "#fff" : isDarkmode ? "#fff" : "#000",
                        }}
                        fontWeight={active ? "bold" : "normal"}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.label, { marginTop: 16 }]}>
                Duration (minutes)
              </Text>
              <TextInput
                value={sessionLength}
                onChangeText={(v) => setSessionLength(v.replace(/[^\d]/g, ""))}
                keyboardType="numeric"
                placeholder="20"
                width={120}
              />

              <Text style={{ fontSize: 11, opacity: 0.6, marginTop: 10 }}>
                Tip: The duration above updated automatically based on your
                chosen intensity, but you can override it here.
              </Text>
            </Section>

            <Button
              text={saving ? "Saving Profile..." : "Save Profile"}
              onPress={onSave}
              style={{ marginHorizontal: 16, marginTop: 8 }}
              color={FITNESS_COLOR}
              disabled={saving}
            />
          </ScrollView>
        )}
      </Layout>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 16, marginBottom: 16, padding: 16 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  subtext: { fontSize: 12, opacity: 0.6, marginBottom: 12 },
  row: { flexDirection: "row", gap: 12 } as any,
  label: { fontSize: 12, fontWeight: "600", marginBottom: 4, opacity: 0.8 },
  bmiContainer: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  } as any,
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(150,150,150,0.1)",
  },
  dayChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  radioContainer: { flexDirection: "row", gap: 8 } as any,
  radioBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  quickBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  } as any,
});
