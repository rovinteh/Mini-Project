import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
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
const FITNESS_COLOR = "#22C55E";

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

  // New State for BMI
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // --- Load Data ---
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
          setHeight(data.height ? String(data.height) : "");
          setWeight(data.weight ? String(data.weight) : "");
        }
      } catch (err) {
        console.log("Error loading preference:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --- Helpers ---
  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  // Real-time BMI Calculation
  const bmiStats = useMemo(() => {
    const h = parseFloat(height);
    const w = parseFloat(weight);

    if (!h || !w || h <= 0 || w <= 0) return null;

    const hM = h / 100; // cm to m
    const bmiVal = w / (hM * hM);
    const score = bmiVal.toFixed(1);

    let label = "Normal Weight";
    let color = FITNESS_COLOR;

    if (bmiVal < 18.5) {
      label = "Underweight";
      color = "#F59E0B"; // Amber
    } else if (bmiVal >= 25 && bmiVal < 30) {
      label = "Overweight";
      color = "#F59E0B";
    } else if (bmiVal >= 30) {
      label = "Obese";
      color = "#EF4444"; // Red
    }

    return { score, label, color };
  }, [height, weight]);

  // --- Save Action ---
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
          height: height ? parseFloat(height) : null,
          weight: weight ? parseFloat(weight) : null,
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      );
      Alert.alert("Success", "Your fitness profile has been updated.");
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
          >
            {/* 1. Body Metrics Section (NEW) */}
            <Section style={styles.card}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <Ionicons
                  name="body"
                  size={20}
                  color={FITNESS_COLOR}
                  style={{ marginRight: 8 }}
                />
                <Text size="h4" fontWeight="bold">
                  About You
                </Text>
              </View>
              <Text style={styles.subtext}>
                Used to calculate BMI and calibrate workouts.
              </Text>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Height (cm)</Text>
                  <TextInput
                    placeholder="175"
                    keyboardType="numeric"
                    value={height}
                    onChangeText={setHeight}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Weight (kg)</Text>
                  <TextInput
                    placeholder="70"
                    keyboardType="numeric"
                    value={weight}
                    onChangeText={setWeight}
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
                    Your estimated BMI is
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

            {/* 2. Goals Section */}
            <Section style={styles.card}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <Ionicons
                  name="trophy"
                  size={20}
                  color={FITNESS_COLOR}
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
                    style={styles.chip}
                    onPress={() => setGoal(g)}
                  >
                    <Text size="sm">{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Section>

            {/* 3. Intensity Section */}
            <Section style={styles.card}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <Ionicons
                  name="speedometer"
                  size={20}
                  color={FITNESS_COLOR}
                  style={{ marginRight: 8 }}
                />
                <Text size="h4" fontWeight="bold">
                  Intensity
                </Text>
              </View>

              <View style={styles.radioContainer}>
                {[
                  { label: "Beginner", val: "easy", desc: "Light movements" },
                  {
                    label: "Balanced",
                    val: "moderate",
                    desc: "Get a good sweat",
                  },
                  { label: "Intense", val: "hard", desc: "Push your limits" },
                ].map((opt) => {
                  const active = difficulty === opt.val;
                  return (
                    <TouchableOpacity
                      key={opt.val}
                      style={[
                        styles.radioBtn,
                        {
                          borderColor: active
                            ? FITNESS_COLOR
                            : isDarkmode
                            ? "#374151"
                            : "#e2e8f0",
                        },
                        active && {
                          backgroundColor: isDarkmode
                            ? "rgba(34,197,94,0.1)"
                            : "#f0fdf4",
                        },
                      ]}
                      onPress={() => setDifficulty(opt.val as any)}
                    >
                      <Text fontWeight={active ? "bold" : "normal"}>
                        {opt.label}
                      </Text>
                      <Text size="sm" style={{ opacity: 0.6, fontSize: 10 }}>
                        {opt.desc}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Section>

            {/* 4. Schedule Section */}
            <Section style={styles.card}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <Ionicons
                  name="calendar"
                  size={20}
                  color={FITNESS_COLOR}
                  style={{ marginRight: 8 }}
                />
                <Text size="h4" fontWeight="bold">
                  Schedule
                </Text>
              </View>

              <Text style={styles.label}>Workout Days</Text>
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
                            ? FITNESS_COLOR
                            : "transparent",
                          borderColor: active ? FITNESS_COLOR : "#cbd5e1",
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
                onChangeText={setSessionLength}
                keyboardType="numeric"
                placeholder="20"
                width={100}
              />
            </Section>

            {/* Save Button */}
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
  subtext: { fontSize: 12, opacity: 0.6, marginBottom: 12 },
  row: { flexDirection: "row", gap: 12 },
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
  },
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
  radioContainer: { flexDirection: "row", gap: 8 },
  radioBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
});
