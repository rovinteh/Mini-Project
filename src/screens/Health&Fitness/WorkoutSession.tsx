import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Animated,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  AppState,
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
import Svg, { Circle } from "react-native-svg";
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Props = NativeStackScreenProps<MainStackParamList, "WorkoutSession">;

type StepType = "warmup" | "work" | "rest" | "cooldown";
type SessionPhase = "preview" | "running" | "paused";

type GeneratedStep = {
  id: string;
  title: string;
  durationSec: number;
  type: StepType;
};

// --- Expanded Exercise Library ---
const EXERCISE_LIBRARY = {
  cardio: {
    easy: [
      "March in Place",
      "Step Touches",
      "Arm Circles",
      "Torso Twists",
      "Side Leg Raises",
      "High Knees (Slow)",
    ],
    hard: [
      "Jumping Jacks",
      "Burpees",
      "Mountain Climbers",
      "High Knees (Fast)",
      "Skaters",
      "Jump Squats",
      "Fast Feet",
      "Butt Kicks",
      "Rope Skips",
    ],
  },
  strength: {
    easy: [
      "Wall Sit",
      "Bodyweight Squats",
      "Lunges",
      "Calf Raises",
      "Glute Bridges",
      "Incline Push-Ups",
    ],
    hard: [
      "Push-Ups",
      "Tricep Dips",
      "Reverse Lunges",
      "Sumo Squats",
      "Commandos",
      "Side Lunges",
    ],
  },
  core: {
    easy: ["Standing Side Bends", "Dead Bug", "Bird Dog"],
    hard: [
      "Plank Hold",
      "Bicycle Crunches",
      "Leg Raises",
      "Russian Twists",
      "Shoulder Taps",
    ],
  },
};

const COLOR_WARMUP = "#F97316";
const COLOR_WORK = "#3B82F6";
const COLOR_REST = "#22C55E";
const COLOR_COOLDOWN = "#8B5CF6";

// Helper to shuffle arrays
const shuffle = (array: string[]) => {
  return array.sort(() => Math.random() - 0.5);
};

export default function WorkoutSessionScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  // --- State ---
  const [steps, setSteps] = useState<GeneratedStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>("preview");
  const [sessionDone, setSessionDone] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);

  // Time & Progress Tracking
  const [completedDuration, setCompletedDuration] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [startedAtClient, setStartedAtClient] = useState<Date | null>(null);

  const totalDurationSec = useMemo(
    () => steps.reduce((sum, s) => sum + s.durationSec, 0),
    [steps]
  );

  const [rating, setRating] = useState<number>(0);
  const [feedback, setFeedback] = useState("");

  const progressAnim = useRef(new Animated.Value(0)).current;
  const lastCountdownSpoken = useRef<number | null>(null);

  // CRITICAL FIX: Ref to track if we are intentionally exiting
  // This prevents the "auto-save" listener from resurrecting a deleted session
  const isExiting = useRef(false);

  // --- Voice & Haptics ---
  const speak = (text: string) => {
    if (!voiceOn) return;
    Speech.stop();
    Speech.speak(text, { language: "en", pitch: 1.0, rate: 0.95 });
  };
  const triggerHaptic = async () => {
    if (Platform.OS !== "web")
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // --- Plan Generator ---
  const generatePlan = async (pref: any) => {
    const goal = pref?.goal || "Stay Active";
    const difficulty = pref?.difficulty || "easy"; // easy, moderate, hard
    const lengthMin = pref?.sessionLengthMinutes || 20;

    // 1. Determine Intensity Pools
    let pool: string[] = [];

    // Base mix: Always include some cardio and some strength
    if (difficulty === "easy") {
      pool = [
        ...EXERCISE_LIBRARY.cardio.easy,
        ...EXERCISE_LIBRARY.strength.easy,
        ...EXERCISE_LIBRARY.core.easy,
      ];
    } else if (difficulty === "moderate") {
      pool = [
        ...EXERCISE_LIBRARY.cardio.easy,
        ...EXERCISE_LIBRARY.cardio.hard,
        ...EXERCISE_LIBRARY.strength.easy,
        ...EXERCISE_LIBRARY.core.hard,
      ];
    } else {
      pool = [
        ...EXERCISE_LIBRARY.cardio.hard,
        ...EXERCISE_LIBRARY.strength.hard,
        ...EXERCISE_LIBRARY.core.hard,
      ];
    }

    // 2. Goal Bias
    if (goal.includes("Fat") || goal.includes("Stamina")) {
      pool = [
        ...pool,
        ...EXERCISE_LIBRARY.cardio.hard,
        ...EXERCISE_LIBRARY.cardio.hard,
      ];
    } else if (goal.includes("Muscle") || goal.includes("Strong")) {
      pool = [
        ...pool,
        ...EXERCISE_LIBRARY.strength.hard,
        ...EXERCISE_LIBRARY.strength.hard,
      ];
    }

    // Shuffle and deduplicate
    pool = shuffle([...new Set(pool)]);

    // 3. Structure
    const baseWarmup = 3;
    const baseCooldown = 3;
    const restSec =
      difficulty === "hard" ? 15 : difficulty === "moderate" ? 30 : 45;

    const workMin = Math.max(lengthMin - baseWarmup - baseCooldown, 5);
    const totalWorkSec = workMin * 60;

    const approxBlockSec = 45 + restSec;
    const blockCount = Math.floor(totalWorkSec / approxBlockSec) || 3;
    const workSecPerBlock = Math.floor(
      (totalWorkSec - blockCount * restSec) / blockCount
    );

    const newSteps: GeneratedStep[] = [];
    newSteps.push({
      id: "warmup",
      title: "Warm Up",
      durationSec: baseWarmup * 60,
      type: "warmup",
    });

    for (let i = 0; i < blockCount; i++) {
      const move = pool[i % pool.length];
      newSteps.push({
        id: `work-${i}`,
        title: move,
        durationSec: workSecPerBlock,
        type: "work",
      });

      if (i < blockCount - 1) {
        newSteps.push({
          id: `rest-${i}`,
          title: "Rest",
          durationSec: restSec,
          type: "rest",
        });
      }
    }
    newSteps.push({
      id: "cooldown",
      title: "Cool Down",
      durationSec: baseCooldown * 60,
      type: "cooldown",
    });

    return newSteps;
  };

  // --- Load Session ---
  const loadSession = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    // Reset Exit Flag on load
    isExiting.current = false;

    try {
      const user = auth.currentUser;
      if (!user) return;

      const saved = await AsyncStorage.getItem(`session_${user.uid}`);
      if (saved && !isRefresh) {
        const parsed = JSON.parse(saved);
        const savedTime = new Date(parsed.timestamp).getTime();
        if (Date.now() - savedTime < 24 * 60 * 60 * 1000) {
          setSteps(parsed.steps);
          setCurrentIndex(parsed.currentIndex);
          setSecondsLeft(parsed.secondsLeft);
          setElapsedSec(parsed.elapsedSec);
          setCompletedDuration(parsed.completedDuration || 0);
          setPhase("paused");
          setStartedAtClient(new Date(parsed.startedAt));
          setLoading(false);
          setRefreshing(false);
          return;
        }
      }

      // Generate New
      const prefSnap = await getDoc(doc(db, "WorkoutPreference", user.uid));
      const pref = prefSnap.data() as any | undefined;
      const newSteps = await generatePlan(pref);

      setSteps(newSteps);
      setCurrentIndex(0);
      setSecondsLeft(newSteps[0].durationSec);
      setElapsedSec(0);
      setCompletedDuration(0);
      setSessionDone(false);
      setPhase("preview");

      // Clean stale storage
      await AsyncStorage.removeItem(`session_${user.uid}`);
    } catch (err) {
      console.log("Error loading session:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // --- Auto-Save ---
  useEffect(() => {
    const saveState = async () => {
      const user = auth.currentUser;
      // Do NOT save if we are intentionally exiting or finished
      if (!user || sessionDone || phase === "preview" || isExiting.current)
        return;

      const stateToSave = {
        steps,
        currentIndex,
        secondsLeft,
        elapsedSec,
        completedDuration,
        startedAt: startedAtClient || new Date(),
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(
        `session_${user.uid}`,
        JSON.stringify(stateToSave)
      );
    };

    const unsubscribe = navigation.addListener("beforeRemove", () => {
      // Only auto-save if we are NOT intentionally cancelling/finishing
      if (!isExiting.current && (phase === "running" || phase === "paused")) {
        saveState();
      }
    });

    if (phase === "paused") saveState();

    return unsubscribe;
  }, [
    navigation,
    phase,
    steps,
    currentIndex,
    secondsLeft,
    elapsedSec,
    completedDuration,
    sessionDone,
  ]);

  // --- Timer ---
  useEffect(() => {
    if (phase !== "running") return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    if (phase === "running" && secondsLeft === 0) {
      handleStepFinished();
    }
  }, [secondsLeft, phase]);

  useEffect(() => {
    if (phase !== "running") return;
    if (
      secondsLeft <= 3 &&
      secondsLeft > 0 &&
      lastCountdownSpoken.current !== secondsLeft
    ) {
      lastCountdownSpoken.current = secondsLeft;
      speak(String(secondsLeft));
    }
    if (secondsLeft > 3) lastCountdownSpoken.current = null;
  }, [secondsLeft, phase, voiceOn]);

  // --- Progress Bar Animation (Fixed) ---
  useEffect(() => {
    if (totalDurationSec <= 0) return;

    // Total Progress = (Already Finished Steps Duration) + (Time spent in current step)
    const currentStepDuration = steps[currentIndex]?.durationSec || 0;
    const timeSpentInCurrent = Math.max(0, currentStepDuration - secondsLeft);
    const effectiveProgress = completedDuration + timeSpentInCurrent;

    const ratio = Math.min(effectiveProgress / totalDurationSec, 1);

    Animated.timing(progressAnim, {
      toValue: ratio,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [secondsLeft, completedDuration, totalDurationSec, currentIndex]);

  // --- Handlers ---
  const handleStepFinished = () => {
    triggerHaptic();

    // Add full duration of the step we just finished/skipped
    const finishedStepDuration = steps[currentIndex]?.durationSec || 0;
    setCompletedDuration((prev) => prev + finishedStepDuration);

    setCurrentIndex((idx) => {
      const next = idx + 1;
      const nextStepObj = steps[next];
      if (!nextStepObj) {
        finishSession();
        return idx;
      }
      setSecondsLeft(nextStepObj.durationSec);
      speak(nextStepObj.title);
      return next;
    });
  };

  const finishSession = async () => {
    setPhase("paused");
    setSessionDone(true);
    speak("Workout complete!");
    // Mark as exiting so auto-save doesn't run
    isExiting.current = true;
    const user = auth.currentUser;
    if (user) await AsyncStorage.removeItem(`session_${user.uid}`);
  };

  const startSession = () => {
    if (!startedAtClient) {
      setStartedAtClient(new Date());
      if (steps[0]) speak("Starting workout. " + steps[0].title);
    } else {
      speak("Resuming.");
    }
    setPhase("running");
  };

  const pauseSession = () => {
    setPhase("paused");
    speak("Paused.");
  };

  const cancelSession = async () => {
    // Mark as exiting to block auto-save resurrection
    isExiting.current = true;
    const user = auth.currentUser;
    if (user) await AsyncStorage.removeItem(`session_${user.uid}`);
    await saveToHistory("cancelled");
  };

  const saveToHistory = async (status: "completed" | "cancelled") => {
    const user = auth.currentUser;
    if (!user || saving) return;
    setSaving(true);
    isExiting.current = true; // Ensure we don't auto-save while leaving

    try {
      const now = new Date();
      await addDoc(collection(db, "WorkoutSession"), {
        userId: user.uid,
        createdAtClient: Timestamp.fromDate(now),
        startedAtClient: Timestamp.fromDate(startedAtClient || now),
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

      if (status === "completed") Alert.alert("Saved", "Great job!");
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

  const getTypeColor = (type?: StepType) => {
    switch (type) {
      case "warmup":
        return COLOR_WARMUP;
      case "work":
        return COLOR_WORK;
      case "rest":
        return COLOR_REST;
      case "cooldown":
        return COLOR_COOLDOWN;
      default:
        return "#ccc";
    }
  };

  const renderPreviewItem = ({ item }: { item: GeneratedStep }) => (
    <View style={styles.previewItem}>
      <View
        style={[
          styles.previewDot,
          { backgroundColor: getTypeColor(item.type) },
        ]}
      />
      <View style={{ flex: 1 }}>
        <Text fontWeight="bold">{item.title}</Text>
        <Text style={{ fontSize: 12, opacity: 0.6 }}>
          {item.durationSec >= 60
            ? `${Math.ceil(item.durationSec / 60)} min`
            : `${item.durationSec} sec`}{" "}
          • {item.type}
        </Text>
      </View>
    </View>
  );

  const currentStep = steps[currentIndex];
  const activeColor = getTypeColor(currentStep?.type);
  const radius = 100;
  const circumference = 2 * Math.PI * radius;
  const currentDuration = steps[currentIndex]?.durationSec || 1;
  const countdownOffset = circumference * (1 - secondsLeft / currentDuration);

  return (
    <Layout>
      <TopNav
        middleContent={
          sessionDone
            ? "Summary"
            : phase === "preview"
            ? "Plan Preview"
            : "In Progress"
        }
        leftContent={
          <Ionicons
            name="chevron-back"
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
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
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLOR_WORK} />
          <Text style={{ marginTop: 10 }}>Generating Plan...</Text>
        </View>
      ) : (
        <>
          {phase === "preview" && !sessionDone && (
            <View style={{ flex: 1 }}>
              <FlatList
                data={steps}
                keyExtractor={(item) => item.id}
                renderItem={renderPreviewItem}
                contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => loadSession(true)}
                  />
                }
                ListHeaderComponent={
                  <View style={{ marginBottom: 16 }}>
                    <Text size="h3" fontWeight="bold">
                      Today's Session
                    </Text>
                    <Text style={{ opacity: 0.6 }}>
                      Total: {Math.ceil(totalDurationSec / 60)} mins
                    </Text>
                  </View>
                }
              />
              <View style={styles.bottomFloat}>
                <Button
                  text="Start Workout"
                  size="lg"
                  color={COLOR_WORK}
                  onPress={startSession}
                  width="100%"
                  leftContent={<Ionicons name="play" color="#fff" size={20} />}
                />
              </View>
            </View>
          )}

          {(phase !== "preview" || sessionDone) && (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={{ paddingBottom: 40 }}
            >
              {/* Linear Progress Bar */}
              <View style={styles.globalProgressBg}>
                <Animated.View
                  style={[
                    styles.globalProgressFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0%", "100%"],
                      }),
                      backgroundColor: activeColor,
                    },
                  ]}
                />
              </View>

              {!sessionDone && (
                <View style={styles.coachRow}>
                  <TouchableOpacity
                    onPress={() => setVoiceOn(!voiceOn)}
                    style={[
                      styles.coachChip,
                      { backgroundColor: isDarkmode ? "#1f2937" : "#f3f4f6" },
                    ]}
                  >
                    <Ionicons
                      name={voiceOn ? "volume-high" : "volume-mute"}
                      size={16}
                      color={voiceOn ? activeColor : "#6B7280"}
                    />
                  </TouchableOpacity>
                </View>
              )}

              {/* Circular Timer */}
              {!sessionDone && currentStep && (
                <View style={{ alignItems: "center", marginBottom: 32 }}>
                  <View
                    style={{
                      width: 240,
                      height: 240,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Svg width={240} height={240}>
                      <Circle
                        cx="120"
                        cy="120"
                        r={radius}
                        stroke={isDarkmode ? "#1f2937" : "#e5e7eb"}
                        strokeWidth={16}
                        fill="transparent"
                      />
                      <Circle
                        cx="120"
                        cy="120"
                        r={radius}
                        stroke={activeColor}
                        strokeWidth={16}
                        fill="transparent"
                        strokeDasharray={circumference}
                        strokeDashoffset={-countdownOffset}
                        strokeLinecap="round"
                        rotation="-90"
                        origin="120, 120"
                      />
                    </Svg>
                    <View
                      style={{ position: "absolute", alignItems: "center" }}
                    >
                      <Text
                        style={{
                          fontSize: 48,
                          fontWeight: "bold",
                          fontVariant: ["tabular-nums"],
                          color: activeColor,
                        }}
                      >
                        {formatTime(secondsLeft)}
                      </Text>
                      <Text
                        style={{
                          opacity: 0.6,
                          fontSize: 14,
                          textTransform: "uppercase",
                        }}
                      >
                        {currentStep.type}
                      </Text>
                    </View>
                  </View>
                  <Text
                    size="h3"
                    fontWeight="bold"
                    style={{ marginTop: 20, textAlign: "center" }}
                  >
                    {currentStep.title}
                  </Text>
                </View>
              )}

              {!sessionDone && (
                <View style={styles.controls}>
                  <View
                    style={{ flexDirection: "row", gap: 12, width: "100%" }}
                  >
                    {phase === "running" ? (
                      <Button
                        text="Pause"
                        color="#F59E0B"
                        onPress={pauseSession}
                        style={{ flex: 1 }}
                        leftContent={
                          <Ionicons name="pause" color="#fff" size={20} />
                        }
                      />
                    ) : (
                      <Button
                        text="Resume"
                        color={COLOR_REST}
                        onPress={startSession}
                        style={{ flex: 1 }}
                        leftContent={
                          <Ionicons name="play" color="#fff" size={20} />
                        }
                      />
                    )}
                    <Button
                      text="Skip"
                      outline
                      color={isDarkmode ? "#fff" : "#333"}
                      style={{ flex: 0.6 }}
                      onPress={handleStepFinished}
                    />
                  </View>
                  <Button
                    text="End Session"
                    outline
                    status="danger"
                    style={{ marginTop: 12, width: "100%" }}
                    onPress={() =>
                      Alert.alert("End Session?", "Progress will be lost.", [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "End Session",
                          style: "destructive",
                          onPress: cancelSession,
                        }, // Use specific cancel function
                      ])
                    }
                  />
                </View>
              )}

              {sessionDone && (
                <Section style={styles.card}>
                  <View style={{ alignItems: "center", marginVertical: 20 }}>
                    <Ionicons name="trophy" size={64} color="#F59E0B" />
                    <Text size="h3" fontWeight="bold" style={{ marginTop: 10 }}>
                      Workout Complete!
                    </Text>
                  </View>
                  <Text fontWeight="bold">How did it feel?</Text>
                  <View style={styles.starsRow}>
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
                    placeholder="Notes..."
                    value={feedback}
                    onChangeText={setFeedback}
                  />
                  <Button
                    text={saving ? "Saving..." : "Save & Close"}
                    style={{ marginTop: 16 }}
                    onPress={() => saveToHistory("completed")}
                    disabled={saving}
                    color={COLOR_REST}
                  />
                </Section>
              )}
            </ScrollView>
          )}
        </>
      )}
    </Layout>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  globalProgressBg: {
    height: 6,
    backgroundColor: "rgba(0,0,0,0.08)",
    borderRadius: 3,
    marginBottom: 10,
    overflow: "hidden",
  },
  globalProgressFill: { height: "100%" },
  coachRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 10,
  },
  coachChip: {
    borderRadius: 20,
    padding: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  controls: { alignItems: "center", width: "100%" },
  card: { borderRadius: 16, padding: 16 },
  starsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  previewItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    backgroundColor: "rgba(150,150,150,0.05)",
    padding: 12,
    borderRadius: 12,
  },
  previewDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  bottomFloat: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
    backgroundColor: "transparent",
  },
});
