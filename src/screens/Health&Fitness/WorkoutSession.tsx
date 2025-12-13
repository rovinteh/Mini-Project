import React, { useEffect, useRef, useState, useMemo } from "react";
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

type Props = NativeStackScreenProps<MainStackParamList, "WorkoutSession">;

type StepType = "warmup" | "work" | "rest" | "cooldown";

type GeneratedStep = {
  id: string;
  title: string;
  durationSec: number;
  type: StepType;
};

// New phase 'preview' added
type SessionPhase = "preview" | "running" | "paused";

// --- Colors ---
const COLOR_WARMUP = "#F97316"; // Orange
const COLOR_WORK = "#3B82F6"; // Blue
const COLOR_REST = "#22C55E"; // Green
const COLOR_COOLDOWN = "#8B5CF6"; // Purple

export default function WorkoutSessionScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  // --- State ---
  const [steps, setSteps] = useState<GeneratedStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  // Default start phase is now PREVIEW
  const [phase, setPhase] = useState<SessionPhase>("preview");
  const [sessionDone, setSessionDone] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Coach settings
  const [voiceOn, setVoiceOn] = useState(true);

  // Time tracking
  const totalDurationSec = useMemo(
    () => steps.reduce((sum, s) => sum + s.durationSec, 0),
    [steps]
  );
  const [elapsedSec, setElapsedSec] = useState(0);
  const [startedAtClient, setStartedAtClient] = useState<Date | null>(null);

  // Feedback
  const [rating, setRating] = useState<number>(0);
  const [feedback, setFeedback] = useState("");

  // Refs
  const progressAnim = useRef(new Animated.Value(0)).current;
  const lastCountdownSpoken = useRef<number | null>(null);

  // --- Voice Helper ---
  const speak = (text: string) => {
    if (!voiceOn) return;
    Speech.stop();
    Speech.speak(text, { language: "en", pitch: 1.0, rate: 0.95 });
  };

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  // --- Haptics Helper ---
  const triggerHaptic = async () => {
    if (Platform.OS !== "web") {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        /* ignore */
      }
    }
  };

  // --- Generate Plan ---
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
          setSteps([]);
        } else {
          const difficulty = pref.difficulty || "easy";
          const lengthMin = pref.sessionLengthMinutes || 20;

          const baseWarmup = 3;
          const baseCooldown = 3;
          const restSec = 30;

          const mainMin = Math.max(lengthMin - baseWarmup - baseCooldown, 5);
          const blockCount =
            difficulty === "easy" ? 2 : difficulty === "moderate" ? 3 : 4;

          const totalWorkSeconds = mainMin * 60 - restSec * (blockCount - 1);
          const perBlockSec = Math.max(
            20,
            Math.floor(totalWorkSeconds / blockCount)
          );

          const stepsGenerated: GeneratedStep[] = [];

          stepsGenerated.push({
            id: "warmup",
            title: "Warm Up",
            durationSec: baseWarmup * 60,
            type: "warmup",
          });

          const exercises =
            difficulty === "easy"
              ? ["March in Place", "Bodyweight Squats", "Arm Circles"]
              : difficulty === "moderate"
              ? ["Lunges", "Push-Ups (Knees)", "Plank Hold", "High Knees"]
              : ["Jump Squats", "Burpees", "Mountain Climbers", "Push-Ups"];

          for (let i = 0; i < blockCount; i++) {
            const title = exercises[i % exercises.length];

            stepsGenerated.push({
              id: `work-${i}`,
              title,
              durationSec: perBlockSec,
              type: "work",
            });

            if (i < blockCount - 1) {
              stepsGenerated.push({
                id: `rest-${i}`,
                title: "Rest",
                durationSec: restSec,
                type: "rest",
              });
            }
          }

          stepsGenerated.push({
            id: "cooldown",
            title: "Cool Down",
            durationSec: baseCooldown * 60,
            type: "cooldown",
          });

          setSteps(stepsGenerated);
          // Prep initial state but wait in "preview" phase
          setCurrentIndex(0);
          setSecondsLeft(stepsGenerated[0].durationSec);
          setElapsedSec(0);
          setSessionDone(false);
        }
      } catch (err) {
        console.log("Error generating plan:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --- Timer: Ticker ---
  useEffect(() => {
    if (phase !== "running") return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
      setElapsedSec((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [phase]);

  // --- Timer: Watcher ---
  useEffect(() => {
    if (phase === "running" && secondsLeft === 0) {
      handleStepFinished();
    }
  }, [secondsLeft, phase]);

  // --- Countdown Voice ---
  useEffect(() => {
    if (phase !== "running") return;
    if (secondsLeft > 3) lastCountdownSpoken.current = null;

    if (secondsLeft <= 3 && secondsLeft > 0) {
      if (lastCountdownSpoken.current !== secondsLeft) {
        lastCountdownSpoken.current = secondsLeft;
        speak(String(secondsLeft));
      }
    }
  }, [secondsLeft, phase, voiceOn]);

  // --- Progress Bar ---
  useEffect(() => {
    if (totalDurationSec <= 0) return;
    const ratio = Math.min(elapsedSec / totalDurationSec, 1);
    Animated.timing(progressAnim, {
      toValue: ratio,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [elapsedSec, totalDurationSec]);

  // --- Logic ---
  const handleStepFinished = () => {
    triggerHaptic();

    setCurrentIndex((idx) => {
      const next = idx + 1;
      const nextStepObj = steps[next];

      if (!nextStepObj) {
        setPhase("paused");
        setSessionDone(true);
        speak("Workout complete! Great job.");
        return idx;
      }

      setSecondsLeft(nextStepObj.durationSec);
      speak(nextStepObj.title);
      return next;
    });
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

  // --- Rendering Helpers ---
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
          {Math.round(item.durationSec / 60) < 1
            ? `${item.durationSec} sec`
            : `${Math.ceil(item.durationSec / 60)} min`}{" "}
          • {item.type}
        </Text>
      </View>
    </View>
  );

  const currentStep = steps[currentIndex];
  const nextStep = steps[currentIndex + 1];
  const activeColor = getTypeColor(currentStep?.type);

  // Timer Circle Config
  const radius = 100;
  const strokeWidth = 16;
  const circumference = 2 * Math.PI * radius;
  const currentDuration = steps[currentIndex]?.durationSec || 1;
  const countdownOffset = circumference * (1 - secondsLeft / currentDuration);

  return (
    <Layout>
      <TopNav
        middleContent={
          sessionDone
            ? "Session Summary"
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
        // MAIN CONTENT SWITCHER
        <>
          {/* PHASE 1: PREVIEW LIST */}
          {phase === "preview" && !sessionDone && (
            <View style={{ flex: 1 }}>
              <FlatList
                data={steps}
                keyExtractor={(item) => item.id}
                renderItem={renderPreviewItem}
                contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
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

          {/* PHASE 2: ACTIVE SESSION or SUMMARY */}
          {(phase !== "preview" || sessionDone) && (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Progress Bar */}
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

              {/* Voice Toggle */}
              {!sessionDone && (
                <View style={styles.coachRow}>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity
                    onPress={() => setVoiceOn((v) => !v)}
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
                    <Text style={{ fontSize: 12, marginLeft: 6 }}>
                      Voice Coach
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* TIMER DISPLAY */}
              {!sessionDone && currentStep && (
                <View
                  style={{
                    alignItems: "center",
                    marginBottom: 32,
                    marginTop: 10,
                  }}
                >
                  <View
                    style={{
                      position: "relative",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 240,
                      height: 240,
                    }}
                  >
                    <Svg width={240} height={240}>
                      <Circle
                        cx="120"
                        cy="120"
                        r={radius}
                        stroke={isDarkmode ? "#1f2937" : "#e5e7eb"}
                        strokeWidth={strokeWidth}
                        fill="transparent"
                      />
                      <Circle
                        cx="120"
                        cy="120"
                        r={radius}
                        stroke={activeColor}
                        strokeWidth={strokeWidth}
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
                          marginTop: 4,
                          letterSpacing: 1,
                        }}
                      >
                        {currentStep.type}
                      </Text>
                    </View>
                  </View>

                  <Text
                    size="h3"
                    fontWeight="bold"
                    style={{
                      marginTop: 20,
                      textAlign: "center",
                      paddingHorizontal: 20,
                    }}
                  >
                    {currentStep.title}
                  </Text>

                  {/* Up Next Card */}
                  {nextStep ? (
                    <View
                      style={[
                        styles.upNextCard,
                        {
                          backgroundColor: isDarkmode ? "#1f2937" : "#fff",
                          borderColor: isDarkmode ? "#374151" : "#e5e7eb",
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          opacity: 0.5,
                          textTransform: "uppercase",
                          marginBottom: 2,
                        }}
                      >
                        Up Next
                      </Text>
                      <View
                        style={{ flexDirection: "row", alignItems: "center" }}
                      >
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: getTypeColor(nextStep.type),
                            marginRight: 6,
                          }}
                        />
                        <Text fontWeight="bold">{nextStep.title}</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={{ marginTop: 20 }}>
                      <Text style={{ opacity: 0.5, fontSize: 12 }}>
                        Final Step!
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* CONTROLS (Pause/Resume/Skip) */}
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
                      onPress={skipStep}
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
                          onPress: () => saveSession("cancelled"),
                        },
                      ])
                    }
                  />
                </View>
              )}

              {/* COMPLETION FORM */}
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
                    placeholder="Add a note (e.g. Felt strong, Knee hurt)"
                    value={feedback}
                    onChangeText={setFeedback}
                  />

                  <Button
                    text={saving ? "Saving..." : "Save & Close"}
                    style={{ marginTop: 16 }}
                    onPress={() => saveSession("completed")}
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
  } as any,
  coachChip: {
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  } as any,
  upNextCard: {
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 180,
    alignItems: "center",
  },
  controls: { alignItems: "center", width: "100%" },
  card: { borderRadius: 16, padding: 16 },
  starsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  // Preview Styles
  previewItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    backgroundColor: "rgba(150,150,150,0.05)",
    padding: 12,
    borderRadius: 12,
  },
  previewDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  bottomFloat: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
    backgroundColor: "transparent",
  },
});
