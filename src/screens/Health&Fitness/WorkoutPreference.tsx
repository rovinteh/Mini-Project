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

// Accent Colors
const COLOR_ABOUT = "#3B82F6"; // Blue
const COLOR_GOAL = "#8B5CF6"; // Purple
const COLOR_INTENSITY = "#F97316"; // Orange
const COLOR_SCHEDULE = "#10B981"; // Emerald
const FITNESS_COLOR = "#22C55E"; // Save button / main accent

// --- Base Theme (match FitnessMenu / WeeklySummary) ---
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

  // --- Theme (match FitnessMenu / WeeklySummary) ---
  const bg = isDarkmode ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDarkmode ? COLORS.cardDark : COLORS.cardLight;
  const borderColor = isDarkmode ? COLORS.borderDark : COLORS.borderLight;
  const dimText = isDarkmode ? COLORS.dimDark : COLORS.dimLight;
  const dimText2 = isDarkmode ? COLORS.dimDark2 : COLORS.dimLight2;

  // --- Form State (DO NOT CHANGE) ---
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

  // --- Loading / Refresh (DO NOT CHANGE) ---
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // --- Save (DO NOT CHANGE) ---
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const ref = doc(db, "WorkoutPreference", user.uid);
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
    setSessionLength(String(recommendMinutes(level)));
  };

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
          <View
            style={{
              flex: 1,
              backgroundColor: bg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator size="large" color={FITNESS_COLOR} />
            <Text style={{ marginTop: 10, opacity: 0.7 }}>Loading...</Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1, backgroundColor: bg }}
            contentContainerStyle={{
              paddingHorizontal: 14,
              paddingTop: 12,
              paddingBottom: 32,
            }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            showsVerticalScrollIndicator={false}
          >
            {/* 1) About You (Blue) */}
            <Section
              style={[styles.card, { backgroundColor: cardBg, borderColor }]}
            >
              <View style={styles.sectionTitleRow}>
                <Ionicons
                  name="body"
                  size={20}
                  color={COLOR_ABOUT}
                  style={{ marginRight: 8 }}
                />
                <Text size="h3" fontWeight="bold">
                  About You
                </Text>
              </View>

              {/* ✅ FIX: no style array on rapi-ui Text */}
              <Text style={{ ...styles.subtext, color: dimText }}>
                Optional, but improves BMI & future personalisation.
              </Text>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...styles.label, color: dimText }}>
                    Height (cm)
                  </Text>
                  <TextInput
                    placeholder="175"
                    keyboardType="numeric"
                    value={height}
                    onChangeText={(v) => setHeight(v.replace(/[^\d.]/g, ""))}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ ...styles.label, color: dimText }}>
                    Weight (kg)
                  </Text>
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
                    {
                      backgroundColor: isDarkmode
                        ? "rgba(255,255,255,0.03)"
                        : "rgba(0,0,0,0.03)",
                      borderColor: isDarkmode
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(0,0,0,0.08)",
                    },
                  ]}
                >
                  <Text style={{ fontSize: 13, color: dimText }}>
                    Estimated BMI
                  </Text>
                  <Text
                    fontWeight="bold"
                    style={{
                      color: bmiStats.color,
                      marginVertical: 2,
                      fontSize: 26,
                    }}
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
            <Section
              style={[styles.card, { backgroundColor: cardBg, borderColor }]}
            >
              <View style={styles.sectionTitleRow}>
                <Ionicons
                  name="trophy"
                  size={20}
                  color={COLOR_GOAL}
                  style={{ marginRight: 8 }}
                />
                <Text size="h3" fontWeight="bold">
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
                ].map((g) => {
                  const active = goal === g;
                  return (
                    <TouchableOpacity
                      key={g}
                      style={[
                        styles.goalChip,
                        {
                          borderColor: active
                            ? COLOR_GOAL
                            : isDarkmode
                            ? "rgba(255,255,255,0.10)"
                            : "rgba(0,0,0,0.10)",
                          backgroundColor: active
                            ? isDarkmode
                              ? "rgba(139, 92, 246, 0.16)"
                              : "rgba(139, 92, 246, 0.10)"
                            : isDarkmode
                            ? "rgba(255,255,255,0.03)"
                            : "rgba(0,0,0,0.03)",
                        },
                      ]}
                      onPress={() => setGoal(g)}
                      activeOpacity={0.9}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "900",
                          color: active ? COLOR_GOAL : dimText,
                        }}
                      >
                        {g}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Section>

            {/* 3) Intensity (Orange) */}
            <Section
              style={[styles.card, { backgroundColor: cardBg, borderColor }]}
            >
              <View style={styles.sectionTitleRow}>
                <Ionicons
                  name="speedometer"
                  size={20}
                  color={COLOR_INTENSITY}
                  style={{ marginRight: 8 }}
                />
                <Text size="h3" fontWeight="bold">
                  Intensity
                </Text>
              </View>

              <Text style={{ ...styles.subtext, color: dimText }}>
                Auto-suggests session duration.
              </Text>

              <View style={{ flexDirection: "row", gap: 10 } as any}>
                {[
                  { label: "Beginner", val: "easy", desc: "Light (~20m)" },
                  { label: "Balanced", val: "moderate", desc: "Sweat (~30m)" },
                  { label: "Intense", val: "hard", desc: "Push (~45m)" },
                ].map((opt) => {
                  const active = difficulty === opt.val;
                  return (
                    <TouchableOpacity
                      key={opt.val}
                      style={[
                        styles.radioBtn,
                        {
                          borderColor: active ? COLOR_INTENSITY : borderColor,
                          backgroundColor: active
                            ? isDarkmode
                              ? "rgba(249, 115, 22, 0.15)"
                              : "#FFF7ED"
                            : isDarkmode
                            ? "rgba(255,255,255,0.02)"
                            : "rgba(0,0,0,0.02)",
                        },
                      ]}
                      onPress={() => handleDifficultyChange(opt.val as any)}
                      activeOpacity={0.9}
                    >
                      <Text
                        style={{
                          color: active ? COLOR_INTENSITY : dimText,
                          fontWeight: "900",
                        }}
                      >
                        {opt.label}
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          marginTop: 4,
                          color: active ? COLOR_INTENSITY : dimText2,
                        }}
                      >
                        {opt.desc}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ marginTop: 12 }}>
                <Text style={{ ...styles.label, color: dimText }}>
                  Duration (minutes)
                </Text>
                <TextInput
                  value={sessionLength}
                  onChangeText={(v) =>
                    setSessionLength(v.replace(/[^\d]/g, ""))
                  }
                  keyboardType="numeric"
                  placeholder="20"
                />
              </View>
            </Section>

            {/* 4) Schedule (Emerald) */}
            <Section
              style={[styles.card, { backgroundColor: cardBg, borderColor }]}
            >
              <View style={styles.sectionTitleRow}>
                <Ionicons
                  name="calendar"
                  size={20}
                  color={COLOR_SCHEDULE}
                  style={{ marginRight: 8 }}
                />
                <Text size="h3" fontWeight="bold">
                  Schedule
                </Text>
              </View>

              <Text style={{ ...styles.label, color: dimText }}>
                Weekly Frequency
              </Text>

              <View
                style={
                  { flexDirection: "row", gap: 8, marginBottom: 16 } as any
                }
              >
                {[
                  { k: "light", t: "Light (2x)" },
                  { k: "standard", t: "Standard (3x)" },
                  { k: "active", t: "Active (5x)" },
                ].map((p) => (
                  <TouchableOpacity
                    key={p.k}
                    onPress={() => applyPresetSchedule(p.k as any)}
                    style={[
                      styles.quickBtn,
                      {
                        backgroundColor: isDarkmode
                          ? "rgba(255,255,255,0.03)"
                          : "rgba(0,0,0,0.03)",
                        borderColor: isDarkmode
                          ? "rgba(255,255,255,0.10)"
                          : "rgba(0,0,0,0.10)",
                      },
                    ]}
                    activeOpacity={0.9}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: dimText,
                        fontWeight: "900",
                      }}
                    >
                      {p.t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={{ ...styles.label, color: dimText }}>
                Customize Days
              </Text>

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
                          borderColor: active
                            ? COLOR_SCHEDULE
                            : isDarkmode
                            ? "rgba(255,255,255,0.10)"
                            : "rgba(0,0,0,0.10)",
                        },
                      ]}
                      activeOpacity={0.9}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          color: active ? "#fff" : dimText,
                          fontWeight: "900",
                        }}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Section>

            <Button
              text={saving ? "Saving Profile..." : "Save Profile"}
              onPress={onSave}
              style={{ marginTop: 8 }}
              color={FITNESS_COLOR}
              disabled={saving}
              rightContent={
                saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="checkmark" size={18} color="#fff" />
                )
              }
            />
          </ScrollView>
        )}
      </Layout>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    marginBottom: 12,
    padding: 14,
    borderWidth: 1,
  },

  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },

  subtext: {
    fontSize: 12,
    opacity: 0.9,
    marginBottom: 12,
  },

  row: { flexDirection: "row", gap: 12 } as any,

  label: {
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 6,
    opacity: 0.9,
  },

  bmiContainer: {
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
    alignItems: "center",
    borderWidth: 1,
  },

  chipContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  } as any,

  goalChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },

  radioBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  dayChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  quickBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  } as any,
});
