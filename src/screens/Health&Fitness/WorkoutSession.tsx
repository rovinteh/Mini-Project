// app/modules/fitness/WorkoutSession.tsx
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Animated,
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
  Button,
  Section,
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
} from "firebase/firestore";
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";
import Svg, { Circle } from "react-native-svg";

type Props = NativeStackScreenProps<MainStackParamList, "WorkoutSession">;

type StepType = "warmup" | "work" | "rest" | "cooldown";

type GeneratedStep = {
  id: string;
  title: string;
  durationSec: number;
  type: StepType;
};

type SessionPhase = "idle" | "running" | "paused";

export default function WorkoutSessionScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const [steps, setSteps] = useState<GeneratedStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [sessionDone, setSessionDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const totalDurationSec = steps.reduce((sum, s) => sum + s.durationSec, 0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // 🔊 Haptics + beep for last 3 seconds of each step
  const countdownBeepRef = useRef<Audio.Sound | null>(null);
  const lastBeepSecondRef = useRef<number | null>(null);

  // Load beep sound once
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
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
      if (countdownBeepRef.current) {
        countdownBeepRef.current.unloadAsync();
      }
    };
  }, []);

  const triggerCountdownFeedback = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (countdownBeepRef.current) {
        await countdownBeepRef.current.replayAsync();
      }
    } catch (e) {
      console.log("Countdown feedback error:", e);
    }
  };

  // Helper to style by step type
  const typeStyle = (type: StepType) => {
    switch (type) {
      case "warmup":
        return { label: "Warm-up", color: "#f97316" }; // orange
      case "work":
        return { label: "Main workout", color: "#22c55e" }; // green
      case "rest":
        return { label: "Rest", color: "#38bdf8" }; // blue
      case "cooldown":
        return { label: "Cooldown", color: "#a855f7" }; // purple
      default:
        return { label: "Workout", color: themeColor.primary };
    }
  };

  // --- Load preference & generate today's plan ---
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
          setLoading(false);
          return;
        }

        const difficulty: "easy" | "moderate" | "hard" =
          pref.difficulty || "easy";
        const lengthMin: number = pref.sessionLengthMinutes || 20;

        // Reserve 3 min warmup + 3 min cooldown
        const baseWarmup = 3;
        const baseCooldown = 3;
        const restSec = 30; // rest interval between main blocks
        const mainMin = Math.max(lengthMin - baseWarmup - baseCooldown, 5);

        const blockCount =
          difficulty === "easy" ? 2 : difficulty === "moderate" ? 3 : 4;
        const perBlockSec = Math.floor(
          (mainMin * 60 - restSec * (blockCount - 1)) / blockCount
        );

        const stepsGenerated: GeneratedStep[] = [];

        // Warm-up
        stepsGenerated.push({
          id: "warmup",
          title: "Warm-up: light cardio & mobility",
          durationSec: baseWarmup * 60,
          type: "warmup",
        });

        // Main blocks + rest
        const blockTitles =
          difficulty === "easy"
            ? ["Walk in place / light march", "Bodyweight squats & arm circles"]
            : difficulty === "moderate"
            ? [
                "Alternating squats & lunges",
                "Wall / knee push-ups",
                "Core: plank & crunch combo",
              ]
            : [
                "Jump squats & high knees",
                "Lunges & split squats",
                "Standard / incline push-ups",
                "Core: plank & mountain climbers",
              ];

        for (let i = 0; i < blockCount; i++) {
          stepsGenerated.push({
            id: `work-${i}`,
            title: blockTitles[i] || "Main block",
            durationSec: perBlockSec,
            type: "work",
          });

          // Add rest between main blocks (except after last main block)
          if (i < blockCount - 1) {
            stepsGenerated.push({
              id: `rest-${i}`,
              title: "Rest: sip water & recover",
              durationSec: restSec,
              type: "rest",
            });
          }
        }

        // Cooldown
        stepsGenerated.push({
          id: "cooldown",
          title: "Cooldown: stretching & deep breathing",
          durationSec: baseCooldown * 60,
          type: "cooldown",
        });

        setSteps(stepsGenerated);
        setCurrentIndex(0);
        setSecondsLeft(stepsGenerated[0].durationSec);
        setElapsedSec(0);
        setSessionDone(false);
      } catch (err) {
        console.log("Error generating plan:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --- Timer effect ---
  useEffect(() => {
    if (phase !== "running") {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    if (phase !== "running") return;

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          handleStepFinished();
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

  // --- 3..2..1 countdown feedback ---
  useEffect(() => {
    if (phase !== "running") return;

    if (secondsLeft > 3) {
      lastBeepSecondRef.current = null;
      return;
    }

    if (secondsLeft <= 3 && secondsLeft > 0) {
      if (lastBeepSecondRef.current !== secondsLeft) {
        lastBeepSecondRef.current = secondsLeft;
        triggerCountdownFeedback();
      }
    }
  }, [secondsLeft, phase]);

  // --- Animate progress bar whenever elapsedSec changes ---
  useEffect(() => {
    if (totalDurationSec <= 0) return;
    const ratio = Math.min(elapsedSec / totalDurationSec, 1);
    Animated.timing(progressAnim, {
      toValue: ratio,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [elapsedSec, totalDurationSec]);

  const handleStepFinished = () => {
    setCurrentIndex((idx) => {
      const next = idx + 1;
      if (!steps[next]) {
        // session complete
        if (intervalRef.current) clearInterval(intervalRef.current);
        setPhase("paused");
        setSessionDone(true);
        setSecondsLeft(0);
        return idx;
      }
      setSecondsLeft(steps[next].durationSec);
      return next;
    });
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const startSession = () => {
    if (!steps.length) {
      alert("Please set your workout preference first.");
      return;
    }
    setPhase("running");
  };

  const pauseOrResume = () => {
    if (phase === "running") {
      setPhase("paused");
    } else if (phase === "paused") {
      setPhase("running");
    }
  };

  const skipStep = () => {
    if (!steps[currentIndex + 1]) {
      // skipping last step = session complete
      if (intervalRef.current) clearInterval(intervalRef.current);
      setPhase("paused");
      setSessionDone(true);
      setSecondsLeft(0);
    } else {
      setCurrentIndex((idx) => {
        const next = idx + 1;
        setSecondsLeft(steps[next].durationSec);
        return next;
      });
    }
  };

  const endSessionEarly = () => {
    Alert.alert(
      "End Session",
      "End the session now? It will be saved as cancelled.",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, end session",
          style: "destructive",
          onPress: () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            saveSession("cancelled");
          },
        },
      ]
    );
  };

  const saveSession = async (status: "completed" | "cancelled") => {
    const user = auth.currentUser;
    if (!user) {
      alert("Please login first.");
      return;
    }

    if (saving) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "WorkoutSession"), {
        userId: user.uid,
        createdAt: serverTimestamp(),
        status,
        totalPlannedDurationSec: totalDurationSec,
        actualDurationSec: elapsedSec,
        steps: steps.map((s) => ({
          title: s.title,
          durationSec: s.durationSec,
          type: s.type,
        })),
      });
      alert(
        status === "completed"
          ? "Workout session saved. Great job!"
          : "Session saved as cancelled."
      );
      navigation.goBack();
    } catch (err: any) {
      alert("Error saving session: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const currentStep = steps[currentIndex];
  const nextStep = steps[currentIndex + 1];
  const currentStyle = currentStep ? typeStyle(currentStep.type) : null;

  // Circular timer values
  const radius = 70;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  const currentDuration = currentStep?.durationSec || 1;
  const stepRatio = secondsLeft / currentDuration; // 1 -> full, 0 -> empty
  const strokeDashoffset = circumference * (1 - stepRatio);

  return (
    <Layout>
      <TopNav
        middleContent="Track Workout Session"
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
          <Text style={{ marginTop: 10 }}>Preparing your session...</Text>
        </View>
      ) : !steps.length ? (
        <View style={styles.center}>
          <Text size="h4" fontWeight="bold" style={{ marginBottom: 8 }}>
            No workout plan found
          </Text>
          <Text style={{ textAlign: "center", marginBottom: 20 }}>
            Set up your Workout Preference Profile first to generate a
            personalised workout plan.
          </Text>
          <Button
            text="Go to Workout Preference"
            onPress={() => navigation.navigate("WorkoutPreference")}
          />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {/* Overall session progress */}
          <View style={styles.progressContainer}>
            <Animated.View
              style={[
                styles.progressBar,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }) as any,
                  backgroundColor: themeColor.primary,
                },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {Math.min(elapsedSec, totalDurationSec)}s / {totalDurationSec}s
          </Text>

          {/* Current step card with circular timer */}
          <Section style={styles.card}>
            {currentStep && (
              <>
                <View style={styles.cardHeader}>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: currentStyle?.color || "#e5e7eb" },
                    ]}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontWeight: "bold",
                        fontSize: 12,
                      }}
                    >
                      {currentStyle?.label}
                    </Text>
                  </View>

                  <Text style={styles.stepIndex}>
                    Step {currentIndex + 1} of {steps.length}
                  </Text>
                </View>

                <Text size="h4" fontWeight="bold" style={{ marginTop: 8 }}>
                  {currentStep.title}
                </Text>

                <View style={styles.circleWrapper}>
                  <Svg width={180} height={180}>
                    <Circle
                      stroke={isDarkmode ? "#374151" : "#e5e7eb"}
                      fill="none"
                      cx={90}
                      cy={90}
                      r={radius}
                      strokeWidth={strokeWidth}
                    />
                    <Circle
                      stroke={themeColor.primary}
                      fill="none"
                      cx={90}
                      cy={90}
                      r={radius}
                      strokeWidth={strokeWidth}
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      rotation={-90}
                      origin="90,90"
                    />
                  </Svg>
                  <View style={styles.circleLabel}>
                    <Text size="h1" fontWeight="bold">
                      {formatTime(secondsLeft)}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </Section>

          {/* Next step preview */}
          <Section style={styles.card}>
            <Text size="lg" fontWeight="bold">
              Next
            </Text>
            {nextStep ? (
              <>
                <Text style={{ marginTop: 6 }}>{nextStep.title}</Text>
                <Text style={{ marginTop: 4, opacity: 0.7 }}>
                  Type: {typeStyle(nextStep.type).label} ·{" "}
                  {Math.round(nextStep.durationSec / 60)} min
                </Text>
              </>
            ) : (
              <Text style={{ marginTop: 6 }}>This is the last step.</Text>
            )}
          </Section>

          {/* Step timeline */}
          <Section style={styles.card}>
            <Text size="lg" fontWeight="bold" style={{ marginBottom: 8 }}>
              Session Timeline
            </Text>
            {steps.map((step, idx) => {
              const style = typeStyle(step.type);
              const isCurrent = idx === currentIndex;
              return (
                <View
                  key={step.id}
                  style={[
                    styles.timelineItem,
                    isCurrent && {
                      backgroundColor: isDarkmode ? "#111827" : "#eef2ff",
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.timelineDot,
                      { backgroundColor: style.color },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      fontWeight={isCurrent ? "bold" : "normal"}
                      style={{ fontSize: 13 }}
                    >
                      {idx + 1}. {step.title}
                    </Text>
                    <Text style={{ fontSize: 11, opacity: 0.7 }}>
                      {style.label} · {Math.round(step.durationSec / 60)} min
                    </Text>
                  </View>
                </View>
              );
            })}
          </Section>

          {/* Controls */}
          <Section style={styles.card}>
            {phase === "idle" && !sessionDone && (
              <Button text="Start Session" onPress={startSession} />
            )}

            {phase !== "idle" && !sessionDone && (
              <>
                <Button
                  text={phase === "running" ? "Pause" : "Resume"}
                  onPress={pauseOrResume}
                  style={{ marginBottom: 10 }}
                />
                <Button
                  text="Skip to Next Step"
                  onPress={skipStep}
                  disabled={!nextStep}
                  style={{ marginBottom: 10 }}
                />
                <Button
                  text="End Session Now (Cancel)"
                  status="danger"
                  onPress={endSessionEarly}
                />
              </>
            )}

            {sessionDone && (
              <>
                <Text style={{ marginBottom: 10 }}>
                  Session completed. Save your result?
                </Text>
                <Button
                  text={saving ? "Saving..." : "Save as Completed"}
                  onPress={() => saveSession("completed")}
                  disabled={saving}
                  style={{ marginBottom: 10 }}
                />
                <Button
                  text="Exit Without Saving"
                  status="danger"
                  onPress={() => navigation.goBack()}
                />
              </>
            )}
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
  card: {
    borderRadius: 16,
    marginBottom: 12,
  },
  progressContainer: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 999,
  },
  progressText: {
    marginTop: 6,
    marginBottom: 8,
    fontSize: 12,
    opacity: 0.7,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  stepIndex: {
    fontSize: 12,
    opacity: 0.7,
  },
  circleWrapper: {
    marginTop: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  circleLabel: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  timelineItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
    marginBottom: 4,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginRight: 8,
  },
});
