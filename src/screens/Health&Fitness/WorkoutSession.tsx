import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Animated,
  ActivityIndicator,
  Platform,
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
  Button,
  Section,
  TextInput,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";
import Svg, { Circle } from "react-native-svg";
import * as Speech from "expo-speech"; // <--- NEW IMPORT

type Props = NativeStackScreenProps<MainStackParamList, "WorkoutSession">;

type StepType = "warmup" | "work" | "rest" | "cooldown";

type GeneratedStep = {
  id: string;
  title: string;
  durationSec: number;
  type: StepType;
};

type SessionPhase = "idle" | "running" | "paused";

const FITNESS_COLOR = "#22C55E";

export default function WorkoutSessionScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  // --- State ---
  const [steps, setSteps] = useState<GeneratedStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [sessionDone, setSessionDone] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Time tracking
  const totalDurationSec = steps.reduce((sum, s) => sum + s.durationSec, 0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [startedAtClient, setStartedAtClient] = useState<Date | null>(null);

  // Feedback
  const [rating, setRating] = useState<number>(0);
  const [feedback, setFeedback] = useState("");

  // Refs
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const lastBeepSecondRef = useRef<number | null>(null);
  const countdownBeepRef = useRef<Audio.Sound | null>(null);

  // --- Voice Coach Helper ---
  const speak = (text: string) => {
    // Stop any previous speech to avoid overlap pile-up
    Speech.stop();
    Speech.speak(text, {
      language: "en",
      pitch: 1.0,
      rate: 0.9,
    });
  };

  // --- Init Sound & Cleanup ---
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // We still load the beep sound for haptics/audio combo
        const { sound } = await Audio.Sound.createAsync({
          uri: "https://actions.google.com/sounds/v1/alarms/beep_short.ogg",
        });
        if (mounted) countdownBeepRef.current = sound;
      } catch (e) {
        console.log("Failed to load beep sound:", e);
      }
    })();

    return () => {
      mounted = false;
      if (countdownBeepRef.current) countdownBeepRef.current.unloadAsync();
      if (intervalRef.current) clearInterval(intervalRef.current);
      Speech.stop(); // Stop talking if user leaves screen
    };
  }, []);

  // --- Haptics Trigger ---
  const triggerHaptic = async () => {
    if (Platform.OS !== "web") {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } catch (e) {
        /* ignore */
      }
    }
  };

  // --- Generate Plan from Preferences ---
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const prefSnap = await getDoc(doc(db, "WorkoutPreference", user.uid));
        const pref = prefSnap.data() as any | undefined;

        if (!pref) {
          setSteps([]); // No pref found
        } else {
          // --- Generation Logic ---
          const difficulty = pref.difficulty || "easy";
          const lengthMin = pref.sessionLengthMinutes || 20;

          // Standard Times
          const baseWarmup = 3; // mins
          const baseCooldown = 3; // mins
          const restSec = 30; // seconds

          const mainMin = Math.max(lengthMin - baseWarmup - baseCooldown, 5);
          const blockCount =
            difficulty === "easy" ? 2 : difficulty === "moderate" ? 3 : 4;

          // Calculate seconds per exercise block
          const totalWorkSeconds = mainMin * 60 - restSec * (blockCount - 1);
          const perBlockSec = Math.floor(totalWorkSeconds / blockCount);

          const stepsGenerated: GeneratedStep[] = [];

          // 1. Warmup
          stepsGenerated.push({
            id: "warmup",
            title: "Warm Up: Light Cardio",
            durationSec: baseWarmup * 60,
            type: "warmup",
          });

          // 2. Exercises (Dynamic titles based on difficulty)
          const exercises =
            difficulty === "easy"
              ? ["March in Place", "Bodyweight Squats", "Arm Circles"]
              : difficulty === "moderate"
              ? ["Lunges", "Push-Ups (Knees)", "Plank Hold", "High Knees"]
              : ["Jump Squats", "Burpees", "Mountain Climbers", "Push-Ups"];

          for (let i = 0; i < blockCount; i++) {
            // Cycle through exercise names if we need more blocks than names
            const title = exercises[i % exercises.length];

            stepsGenerated.push({
              id: `work-${i}`,
              title: title,
              durationSec: perBlockSec,
              type: "work",
            });

            if (i < blockCount - 1) {
              stepsGenerated.push({
                id: `rest-${i}`,
                title: "Rest & Breathe",
                durationSec: restSec,
                type: "rest",
              });
            }
          }

          // 3. Cooldown
          stepsGenerated.push({
            id: "cooldown",
            title: "Cool Down: Stretching",
            durationSec: baseCooldown * 60,
            type: "cooldown",
          });

          setSteps(stepsGenerated);
          setCurrentIndex(0);
          setSecondsLeft(stepsGenerated[0].durationSec);
        }
      } catch (err) {
        console.log("Error generating plan:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --- Timer Loop ---
  useEffect(() => {
    if (phase !== "running") {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          handleStepFinished(); // Time is up for this step
          return 0;
        }
        return prev - 1;
      });
      setElapsedSec((prev) => prev + 1);
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [phase]);

  // --- Countdown & Voice Logic ---
  useEffect(() => {
    if (phase !== "running") return;

    // Reset latch if we have plenty of time
    if (secondsLeft > 3) {
      lastBeepSecondRef.current = null;
    }

    // 3-2-1 Countdown
    if (secondsLeft <= 3 && secondsLeft > 0) {
      if (lastBeepSecondRef.current !== secondsLeft) {
        lastBeepSecondRef.current = secondsLeft;
        triggerHaptic();
        speak(String(secondsLeft)); // "Three", "Two", "One"
      }
    }
  }, [secondsLeft, phase]);

  // --- Progress Bar Animation ---
  useEffect(() => {
    if (totalDurationSec <= 0) return;
    const ratio = Math.min(elapsedSec / totalDurationSec, 1);
    Animated.timing(progressAnim, {
      toValue: ratio,
      duration: 1000, // smooth update over 1 sec
      useNativeDriver: false,
    }).start();
  }, [elapsedSec, totalDurationSec]);

  // --- Step Transition ---
  const handleStepFinished = () => {
    setCurrentIndex((idx) => {
      const next = idx + 1;
      const nextStepObj = steps[next];

      if (!nextStepObj) {
        // End of workout
        if (intervalRef.current) clearInterval(intervalRef.current);
        setPhase("paused");
        setSessionDone(true);
        setSecondsLeft(0);
        speak("Workout complete! Good job.");
        triggerHaptic();
        return idx;
      }

      // Start next step
      setSecondsLeft(nextStepObj.durationSec);
      speak(nextStepObj.title); // Announce new exercise
      return next;
    });
  };

  // --- Actions ---
  const startSession = () => {
    if (!startedAtClient) {
      setStartedAtClient(new Date());
      // Announce first step
      if (steps[0]) speak("Starting workout. " + steps[0].title);
    } else {
      speak("Resuming workout.");
    }
    setPhase("running");
  };

  const pauseSession = () => {
    setPhase("paused");
    speak("Workout paused.");
  };

  const skipStep = () => {
    handleStepFinished();
  };

  const saveSession = async (status: "completed" | "cancelled") => {
    const user = auth.currentUser;
    if (!user) return;
    if (saving) return;

    setSaving(true);
    try {
      const now = new Date();
      const started =
        startedAtClient ?? new Date(now.getTime() - elapsedSec * 1000);

      await addDoc(collection(db, "WorkoutSession"), {
        userId: user.uid,
        createdAtClient: Timestamp.fromDate(now),
        startedAtClient: Timestamp.fromDate(started),
        endedAtClient: Timestamp.fromDate(now),
        createdAt: serverTimestamp(),
        status,
        totalPlannedDurationSec: totalDurationSec,
        actualDurationSec: elapsedSec,
        rating: status === "completed" ? rating : null,
        feedback: status === "completed" ? feedback.trim() : null,
        steps: steps.map((s) => ({
          title: s.title,
          durationSec: s.durationSec,
          type: s.type,
        })),
      });

      if (status === "completed") {
        Alert.alert("Saved", "Workout saved to your history!");
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSaving(false);
    }
  };

  // --- Render Helpers ---
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const typeColor = (type?: StepType) => {
    if (type === "warmup") return "#F97316"; // Orange
    if (type === "work") return FITNESS_COLOR; // Green
    if (type === "rest") return "#3B82F6"; // Blue
    if (type === "cooldown") return "#A855F7"; // Purple
    return "#ccc";
  };

  // Circular Progress Calcs
  const radius = 80;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * radius;
  const currentDuration = steps[currentIndex]?.durationSec || 1;
  const progressPercent = 1 - secondsLeft / currentDuration;
  const strokeDashoffset = circumference * progressPercent; // Fill up as time passes? Or empty?
  // Let's make it empty as time passes (countdown style)
  const countdownOffset = circumference * (1 - secondsLeft / currentDuration);

  return (
    <Layout>
      <TopNav
        middleContent={sessionDone ? "Session Summary" : "Workout In Progress"}
        leftContent={
          <Ionicons
            name="chevron-back"
            size={20}
            color={isDarkmode ? "#fff" : "#000"}
          />
        }
        leftAction={() => {
          if (phase === "running") pauseSession();
          navigation.goBack();
        }}
        rightContent={
          <Ionicons
            name={isDarkmode ? "sunny" : "moon"}
            size={20}
            color={isDarkmode ? "#fff" : "#000"}
          />
        }
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={FITNESS_COLOR} />
          <Text style={{ marginTop: 10 }}>Generating Plan...</Text>
        </View>
      ) : !steps.length ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color="gray" />
          <Text style={{ marginTop: 10, marginBottom: 20 }}>
            No workout plan found.
          </Text>
          <Button
            text="Create Plan"
            onPress={() => navigation.navigate("WorkoutPreference")}
          />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* 1. Global Progress Bar */}
          <View
            style={{
              height: 6,
              backgroundColor: isDarkmode ? "#333" : "#e5e7eb",
              borderRadius: 3,
              marginBottom: 20,
              overflow: "hidden",
            }}
          >
            <Animated.View
              style={{
                height: "100%",
                backgroundColor: FITNESS_COLOR,
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"],
                }),
              }}
            />
          </View>

          {/* 2. Main Timer Circle */}
          {!sessionDone && steps[currentIndex] && (
            <View style={{ alignItems: "center", marginBottom: 24 }}>
              <View
                style={{
                  position: "relative",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* Background Circle */}
                <Svg width={200} height={200}>
                  <Circle
                    cx="100"
                    cy="100"
                    r={radius}
                    stroke={isDarkmode ? "#1f2937" : "#e5e7eb"}
                    strokeWidth={strokeWidth}
                    fill="transparent"
                  />
                  {/* Progress Circle */}
                  <Circle
                    cx="100"
                    cy="100"
                    r={radius}
                    stroke={typeColor(steps[currentIndex].type)}
                    strokeWidth={strokeWidth}
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={-countdownOffset} // Negative for clockwise countdown
                    strokeLinecap="round"
                    rotation="-90"
                    origin="100, 100"
                  />
                </Svg>

                <View style={{ position: "absolute", alignItems: "center" }}>
                  <Text
                    size="h1"
                    fontWeight="bold"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {formatTime(secondsLeft)}
                  </Text>
                  <Text
                    style={{
                      opacity: 0.6,
                      fontSize: 12,
                      textTransform: "uppercase",
                      marginTop: 4,
                    }}
                  >
                    {steps[currentIndex].type}
                  </Text>
                </View>
              </View>

              <Text
                size="h3"
                fontWeight="bold"
                style={{ marginTop: 16, textAlign: "center" }}
              >
                {steps[currentIndex].title}
              </Text>

              {/* Next Step Preview */}
              {steps[currentIndex + 1] ? (
                <View
                  style={[
                    styles.nextBadge,
                    { backgroundColor: isDarkmode ? "#1f2937" : "#f3f4f6" },
                  ]}
                >
                  <Text style={{ fontSize: 12, opacity: 0.7 }}>
                    Up Next:{" "}
                    <Text fontWeight="bold">
                      {steps[currentIndex + 1].title}
                    </Text>
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.nextBadge,
                    { backgroundColor: isDarkmode ? "#1f2937" : "#f3f4f6" },
                  ]}
                >
                  <Text style={{ fontSize: 12, opacity: 0.7 }}>
                    Last Exercise!
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* 3. Controls */}
          {!sessionDone && (
            <View style={styles.controls}>
              {phase === "idle" ? (
                <Button
                  text="Start Workout"
                  size="lg"
                  status="success"
                  onPress={startSession}
                  width="100%"
                  leftContent={<Ionicons name="play" color="#fff" size={20} />}
                />
              ) : (
                <View style={{ width: "100%", gap: 10 }}>
                  {phase === "running" ? (
                    <Button
                      text="Pause"
                      status="warning"
                      onPress={pauseSession}
                      leftContent={
                        <Ionicons name="pause" color="#fff" size={20} />
                      }
                    />
                  ) : (
                    <Button
                      text="Resume"
                      status="success"
                      onPress={startSession}
                      leftContent={
                        <Ionicons name="play" color="#fff" size={20} />
                      }
                    />
                  )}

                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Button
                      text="Skip Step"
                      outline
                      style={{ flex: 1 }}
                      onPress={skipStep}
                    />
                    <Button
                      text="End"
                      outline
                      status="danger"
                      style={{ flex: 1 }}
                      onPress={() =>
                        Alert.alert(
                          "End Session?",
                          "Are you sure you want to cancel?",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "End Session",
                              style: "destructive",
                              onPress: () => saveSession("cancelled"),
                            },
                          ]
                        )
                      }
                    />
                  </View>
                </View>
              )}
            </View>
          )}

          {/* 4. Completion View */}
          {sessionDone && (
            <Section style={styles.card}>
              <View style={{ alignItems: "center", marginVertical: 20 }}>
                <Ionicons name="trophy" size={64} color="#F59E0B" />
                <Text size="h3" fontWeight="bold" style={{ marginTop: 10 }}>
                  Workout Complete!
                </Text>
                <Text style={{ opacity: 0.6 }}>Great effort today.</Text>
              </View>

              <Text fontWeight="bold" style={{ marginBottom: 8 }}>
                How did it feel?
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  marginBottom: 16,
                }}
              >
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity
                    key={star}
                    onPress={() => setRating(star)}
                    style={{ padding: 8 }}
                  >
                    <Ionicons
                      name={star <= rating ? "star" : "star-outline"}
                      size={32}
                      color={star <= rating ? "#F59E0B" : "gray"}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                placeholder="Add a note (e.g. Felt strong, Knee hurt)"
                value={feedback}
                onChangeText={setFeedback}
              />

              <Button
                text={saving ? "Saving..." : "Save & Close"}
                style={{ marginTop: 16 }}
                onPress={() => saveSession("completed")}
                disabled={saving}
              />
            </Section>
          )}

          {/* 5. List View (Timeline) - Only show if not done to avoid clutter */}
          {!sessionDone && (
            <View style={{ marginTop: 20 }}>
              <Text
                style={{
                  marginLeft: 4,
                  marginBottom: 8,
                  fontWeight: "bold",
                  opacity: 0.5,
                }}
              >
                TIMELINE
              </Text>
              {steps.map((s, i) => {
                const isCurrent = i === currentIndex;
                const isPast = i < currentIndex;
                return (
                  <View
                    key={i}
                    style={[
                      styles.timelineItem,
                      {
                        opacity: isPast ? 0.4 : 1,
                        backgroundColor: isCurrent
                          ? isDarkmode
                            ? "#1f2937"
                            : "#fff"
                          : "transparent",
                      },
                    ]}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: typeColor(s.type),
                        marginRight: 10,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text fontWeight={isCurrent ? "bold" : "normal"}>
                        {s.title}
                      </Text>
                      <Text style={{ fontSize: 10, opacity: 0.6 }}>
                        {Math.round(s.durationSec / 60)} min · {s.type}
                      </Text>
                    </View>
                    {isPast && (
                      <Ionicons
                        name="checkmark-circle"
                        color={FITNESS_COLOR}
                        size={16}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </Layout>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  nextBadge: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  controls: {
    alignItems: "center",
    width: "100%",
  },
  card: {
    borderRadius: 16,
    padding: 16,
  },
  timelineItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
});
