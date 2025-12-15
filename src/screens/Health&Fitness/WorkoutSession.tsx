import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  Button,
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
import * as Speech from "expo-speech";
import Svg, { Circle } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Props = NativeStackScreenProps<MainStackParamList, "WorkoutSession">;

type StepType = "warmup" | "work" | "rest" | "cooldown";
type SessionPhase = "ready" | "countdown" | "running" | "paused" | "finished";

type GeneratedStep = {
  id: string;
  title: string;
  durationSec: number;
  type: StepType;
};

type PrefDoc = {
  goal?: string;
  difficulty?: "easy" | "moderate" | "hard";
  sessionLengthMinutes?: number;
  workoutDays?: string[];
};

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
  workout: "#3B82F6",
  warmup: "#F97316",
  rest: "#22C55E",
  cooldown: "#8B5CF6",
  danger: "#EF4444",
  warn: "#F59E0B",
};

const EXERCISE_LIBRARY = {
  cardio: {
    easy: [
      "March in Place",
      "Step Touch",
      "Arm Circles",
      "Torso Twists",
      "Side Steps",
      "High Knees (Slow)",
    ],
    hard: [
      "Jumping Jacks",
      "Burpees",
      "Mountain Climbers",
      "High Knees",
      "Skaters",
      "Jump Squats",
      "Fast Feet",
    ],
  },
  strength: {
    easy: [
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
      "Plank to Push-Up",
    ],
  },
  core: {
    easy: ["Dead Bug", "Bird Dog", "Standing Side Bends"],
    hard: [
      "Plank Hold",
      "Bicycle Crunch",
      "Leg Raises",
      "Russian Twists",
      "Shoulder Taps",
    ],
  },
};

const uniq = (arr: string[]) => Array.from(new Set(arr));
const shuffle = (arr: string[]) => [...arr].sort(() => Math.random() - 0.5);

const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const typeColor = (t?: StepType) => {
  if (t === "warmup") return ACCENT.warmup;
  if (t === "work") return ACCENT.workout;
  if (t === "rest") return ACCENT.rest;
  if (t === "cooldown") return ACCENT.cooldown;
  return "#94A3B8";
};

const estimateRestSec = (difficulty?: string) => {
  if (difficulty === "hard") return 15;
  if (difficulty === "moderate") return 30;
  return 45;
};

const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

const EXERCISE_TIPS: Record<string, string> = {
  "Warm Up": "Move gently. Breathe steadily and loosen your joints.",
  "Cool Down": "Slow down your breathing and stretch lightly.",
  Rest: "Shake it out. Slow breathing: inhale 3s, exhale 3s.",

  "March in Place":
    "Stand tall, swing arms naturally, keep core lightly braced.",
  "Step Touch":
    "Soft knees, step side-to-side smoothly, keep shoulders relaxed.",
  "Arm Circles":
    "Small circles first, then bigger. Don’t shrug your shoulders.",
  "Torso Twists":
    "Rotate from the upper body, keep hips stable, breathe out on twist.",
  "Side Steps": "Step wide, push hips back slightly, stay light on your feet.",
  "High Knees (Slow)": "Drive knees up with control, maintain upright posture.",

  "Jumping Jacks": "Land softly, keep core tight, steady rhythm.",
  Burpees: "Go at your pace. Keep back flat when placing hands down.",
  "Mountain Climbers":
    "Hands under shoulders, keep hips level, quick small steps.",
  "High Knees": "Drive knees up, pump arms, stay tall.",
  Skaters: "Step wide, control balance, don’t let knees collapse inward.",
  "Jump Squats": "Chest up, land quietly, knees track over toes.",
  "Fast Feet": "Small quick steps, stay light, keep breathing.",

  "Bodyweight Squats": "Hips back, chest up, push through heels.",
  Lunges: "Front knee over ankle, keep torso upright, control the descent.",
  "Calf Raises": "Pause at the top, slow down on the way down.",
  "Glute Bridges": "Squeeze glutes at the top, avoid arching your lower back.",
  "Incline Push-Ups": "Body in a straight line, elbows ~45°, controlled reps.",

  "Push-Ups": "Core tight, straight line, lower with control.",
  "Tricep Dips": "Keep elbows back, shoulders down, small controlled range.",
  "Reverse Lunges":
    "Step back gently, keep front heel planted, balanced posture.",
  "Sumo Squats": "Wide stance, toes out, push knees out slightly as you squat.",
  "Plank to Push-Up": "Keep hips steady, move one arm at a time.",

  "Dead Bug": "Lower back stays down, move slowly, exhale as you extend.",
  "Bird Dog": "Reach long, keep hips level, don’t twist.",
  "Standing Side Bends": "Bend gently, don’t collapse the chest, breathe out.",
  "Plank Hold": "Glutes tight, ribs down, breathe slowly.",
  "Bicycle Crunch": "Slow twist, elbow to opposite knee, don’t pull the neck.",
  "Leg Raises": "Control the lowering, keep lower back down if possible.",
  "Russian Twists": "Rotate shoulders, keep chest up, control tempo.",
  "Shoulder Taps": "Feet wider for stability, keep hips still.",
};

const EXERCISE_MEDIA: Record<string, { gif?: string; link?: string }> = {
  "March in Place": {
    link: "https://www.pinterest.com/pin/march-in-place--75716837473618705/",
  },
  "Step Touch": {
    link: "https://spotebi.com/exercise-guide/alternating-side-lunge-touch/",
  },
  "Arm Circles": {
    link: "https://www.pinterest.com/pin/arm-circles--375558056430912163/",
  },
  "Torso Twists": {
    link: "https://www.shutterstock.com/search/torso-twist-standing?image_type=illustration",
  },
  "Side Steps": { link: "https://id.pinterest.com/nuymotion/exercise-gif/" },
  "High Knees (Slow)": {
    link: "https://spotebi.com/exercise-guide/high-knees/",
  },

  "Jumping Jacks": {
    link: "https://www.pinterest.com/pin/jumping-jacks--602497256417008902/",
  },
  Burpees: {
    link: "https://www.pinterest.com/pin/top-10-exercises-to-challenge-tighten-strengthen-your-core--760756562044277960/",
  },
  "Mountain Climbers": {
    link: "https://www.pinterest.com/pin/1141310730569548912/",
  },
  "High Knees": {
    link: "https://www.pinterest.com/pin/high-knees--114208540544264006/",
  },
  Skaters: { link: "https://spotebi.com/exercise-guide/skaters/" },
  "Jump Squats": {
    link: "https://www.pinterest.com/pin/jump-squat--30188259984884472/",
  },
  "Fast Feet": {
    link: "https://www.pinterest.com/pin/quick-feet--295408056800248837/",
  },

  "Bodyweight Squats": { link: "https://spotebi.com/exercise-guide/squat/" },
  Lunges: {
    link: "https://www.pinterest.com/pin/front-and-back-lunges--453667362448292283/",
  },
  "Calf Raises": { link: "https://spotebi.com/exercise-guide/calf-raises/" },
  "Glute Bridges": { link: "https://spotebi.com/exercise-guide/glute-bridge/" },
  "Incline Push-Ups": {
    link: "https://www.pinterest.com/pin/lower-body-total-body-hiit-002--826269862868278446/",
  },

  "Push-Ups": {
    link: "https://www.pinterest.com/pin/push-up--405746247691765222/",
  },
  "Tricep Dips": { link: "https://spotebi.com/exercise-guide/tricep-dips/" },
  "Reverse Lunges": {
    link: "https://www.pinterest.com/pin/740349626234855798/",
  },
  "Sumo Squats": { link: "https://spotebi.com/exercise-guide/sumo-squat/" },
  "Plank to Push-Up": {
    link: "https://es.pinterest.com/pin/344455071519646840/",
  },

  "Dead Bug": { link: "https://es.pinterest.com/pin/453667362469757922/" },
  "Bird Dog": { link: "https://spotebi.com/exercise-guide/plank-bird-dog/" },
  "Standing Side Bends": {
    link: "https://ca.pinterest.com/pin/standing-side-bend--60094976267963905/",
  },

  "Plank Hold": { link: "https://www.inspireusafoundation.org/planks/" },
  "Bicycle Crunch": {
    link: "https://spotebi.com/exercise-guide/bicycle-crunches/",
  },
  "Leg Raises": {
    link: "https://www.pinterest.com/pin/straight-leg-raise--206743439136417488/",
  },
  "Russian Twists": {
    link: "https://www.pinterest.com/pin/top-10-exercises-to-cinch-the-waist-sculpt-your-obliques--50032245845089959/",
  },
  "Shoulder Taps": {
    link: "https://spotebi.com/exercise-guide/plank-shoulder-taps/",
  },
};

const isDirectImageUrl = (url?: string) => {
  if (!url) return false;
  return /\.(gif|png|jpg|jpeg|webp)(\?.*)?$/i.test(url);
};

export default function WorkoutSessionScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const db = getFirestore();

  const bg = isDarkmode ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDarkmode ? COLORS.cardDark : COLORS.cardLight;
  const borderColor = isDarkmode ? COLORS.borderDark : COLORS.borderLight;
  const dimText = isDarkmode ? COLORS.dimDark : COLORS.dimLight;
  const dimText2 = isDarkmode ? COLORS.dimDark2 : COLORS.dimLight2;

  const [phase, setPhase] = useState<SessionPhase>("ready");
  const [steps, setSteps] = useState<GeneratedStep[]>([]);
  const [idx, setIdx] = useState(0);
  const [secLeft, setSecLeft] = useState(0);

  const [countdown, setCountdown] = useState(3);
  const [banner, setBanner] = useState<string | null>(null);

  const [elapsedSec, setElapsedSec] = useState(0);
  const [creditedPlannedSec, setCreditedPlannedSec] = useState(0);
  const [startedAtClient, setStartedAtClient] = useState<Date | null>(null);

  const [voiceOn, setVoiceOn] = useState(true);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");

  const exitingRef = useRef(false);

  // ✅ start vs resume vs next
  const countdownIntroRef = useRef<"start" | "next" | "resume">("next");

  const current = steps[idx];
  const next = steps[idx + 1];
  const activeColor = typeColor(current?.type);

  const totalPlannedSec = useMemo(
    () => steps.reduce((s, x) => s + x.durationSec, 0),
    [steps]
  );

  const overallProgress = useMemo(() => {
    if (totalPlannedSec <= 0) return 0;
    const curDur = current?.durationSec || 0;
    const spentInCurrent = Math.max(0, curDur - secLeft);
    const effective = creditedPlannedSec + spentInCurrent;
    return Math.min(effective / totalPlannedSec, 1);
  }, [totalPlannedSec, creditedPlannedSec, current?.durationSec, secLeft]);

  const radius = 100;
  const circumference = 2 * Math.PI * radius;
  const stepDur = current?.durationSec || 1;
  const stepRatio = Math.min(1, Math.max(0, (stepDur - secLeft) / stepDur));
  const dashOffset = circumference * (1 - stepRatio);

  const speak = useCallback(
    (text: string) => {
      if (!voiceOn) return;
      try {
        Speech.stop();
        Speech.speak(text, { language: "en", rate: 0.95, pitch: 1.0 } as any);
      } catch {}
    },
    [voiceOn]
  );

  const coachTip = useMemo(() => {
    const key = current?.title || "";
    return (
      EXERCISE_TIPS[key] ||
      "Focus on controlled form and steady breathing. Go at your own pace."
    );
  }, [current?.title]);

  const media = useMemo(() => {
    const key = current?.title || "";
    return EXERCISE_MEDIA[key];
  }, [current?.title]);

  const directGifUrl = useMemo(() => {
    const u = media?.gif;
    return isDirectImageUrl(u) ? u : undefined;
  }, [media?.gif]);

  // ✅ show demo ONLY for WORK
  const showDemo = useMemo(() => current?.type === "work", [current?.type]);

  const generatePlan = useCallback(async (pref: PrefDoc | undefined) => {
    const goal = pref?.goal || "Stay Active";
    const difficulty = pref?.difficulty || "easy";
    const lengthMin = pref?.sessionLengthMinutes || 20;

    let pool: string[] = [];

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

    if (
      goal.toLowerCase().includes("fat") ||
      goal.toLowerCase().includes("stamina")
    ) {
      pool = [
        ...pool,
        ...EXERCISE_LIBRARY.cardio.hard,
        ...EXERCISE_LIBRARY.cardio.hard,
      ];
    } else if (
      goal.toLowerCase().includes("muscle") ||
      goal.toLowerCase().includes("strong")
    ) {
      pool = [
        ...pool,
        ...EXERCISE_LIBRARY.strength.hard,
        ...EXERCISE_LIBRARY.strength.hard,
      ];
    }

    pool = shuffle(uniq(pool));

    const warmupMin = 3;
    const cooldownMin = 3;

    const restSec = estimateRestSec(difficulty);
    const workMin = Math.max(lengthMin - warmupMin - cooldownMin, 6);
    const totalWorkSec = workMin * 60;

    const blockSec = 40;
    const approxBlock = blockSec + restSec;
    const blocks = Math.max(3, Math.floor(totalWorkSec / approxBlock));

    const out: GeneratedStep[] = [];
    out.push({
      id: "warmup",
      title: "Warm Up",
      durationSec: warmupMin * 60,
      type: "warmup",
    });

    for (let i = 0; i < blocks; i++) {
      const move = pool[i % pool.length] || "Jumping Jacks";
      out.push({
        id: `work-${i}`,
        title: move,
        durationSec: blockSec,
        type: "work",
      });
      if (i < blocks - 1)
        out.push({
          id: `rest-${i}`,
          title: "Rest",
          durationSec: restSec,
          type: "rest",
        });
    }

    out.push({
      id: "cooldown",
      title: "Cool Down",
      durationSec: cooldownMin * 60,
      type: "cooldown",
    });

    return out;
  }, []);

  const loadSession = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);

      exitingRef.current = false;

      try {
        const user = auth.currentUser;
        if (!user) {
          setLoading(false);
          setRefreshing(false);
          return;
        }

        const saved = await AsyncStorage.getItem(`session_${user.uid}`);
        if (saved && !refresh) {
          const parsed = JSON.parse(saved);
          const ts = Number(parsed.timestamp || 0);
          if (Date.now() - ts < 24 * 60 * 60 * 1000 && parsed.steps?.length) {
            setSteps(parsed.steps);
            setIdx(parsed.idx ?? 0);
            setSecLeft(parsed.secLeft ?? parsed.steps?.[0]?.durationSec ?? 0);
            setPhase(parsed.phase ?? "paused");
            setElapsedSec(parsed.elapsedSec ?? 0);
            setCreditedPlannedSec(parsed.creditedPlannedSec ?? 0);
            setStartedAtClient(
              parsed.startedAt ? new Date(parsed.startedAt) : new Date()
            );
            setCountdown(3);
            setBanner(null);

            setLoading(false);
            setRefreshing(false);
            return;
          }
        }

        const prefSnap = await getDoc(doc(db, "WorkoutPreference", user.uid));
        const pref = (
          prefSnap.exists() ? (prefSnap.data() as PrefDoc) : undefined
        ) as PrefDoc | undefined;

        const plan = await generatePlan(pref);
        setSteps(plan);
        setIdx(0);
        setSecLeft(plan[0]?.durationSec ?? 0);
        setPhase("ready");
        setElapsedSec(0);
        setCreditedPlannedSec(0);
        setStartedAtClient(null);
        setCountdown(3);
        setBanner(null);

        await AsyncStorage.removeItem(`session_${user.uid}`);
      } catch (e) {
        console.log("loadSession error:", e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [auth.currentUser, db, generatePlan]
  );

  useEffect(() => {
    loadSession(false);
    return () => {
      try {
        Speech.stop();
      } catch {}
    };
  }, [loadSession]);

  useEffect(() => {
    const saveState = async () => {
      const user = auth.currentUser;
      if (!user) return;
      if (phase === "finished") return;
      if (exitingRef.current) return;
      if (!steps.length) return;
      if (phase === "ready") return;

      const payload = {
        steps,
        idx,
        secLeft,
        phase,
        elapsedSec,
        creditedPlannedSec,
        startedAt: startedAtClient || new Date(),
        timestamp: Date.now(),
      };

      try {
        await AsyncStorage.setItem(
          `session_${user.uid}`,
          JSON.stringify(payload)
        );
      } catch {}
    };

    const unsub = navigation.addListener("beforeRemove", () => {
      if (phase === "running") setPhase("paused");
      saveState();
      try {
        Speech.stop();
      } catch {}
    });

    if (phase === "paused") saveState();

    return unsub;
  }, [
    navigation,
    phase,
    steps,
    idx,
    secLeft,
    elapsedSec,
    creditedPlannedSec,
    startedAtClient,
    auth.currentUser,
  ]);

  // ✅ Countdown voice logic:
  // - start: "Starting workout" then 3..2..1
  // - resume: "Resuming" then 3..2..1
  // - next: "Next, <name>" then 3..2..1
  useEffect(() => {
    if (phase !== "countdown") return;
    if (!current) return;

    let cancelled = false;

    const run = async () => {
      const mode = countdownIntroRef.current;

      if (mode === "start") {
        setBanner("Starting workout");
        if (voiceOn) {
          speak("Starting workout");
          await wait(900);
        }
      } else if (mode === "resume") {
        setBanner("Resuming");
        if (voiceOn) {
          speak("Resuming");
          await wait(700);
        }
      } else {
        setBanner(`Next: ${current.title}`);
        if (voiceOn) {
          speak(`Next, ${current.title}`);
          await wait(900);
        }
      }

      if (cancelled) return;

      let c = 3;
      setCountdown(c);

      const interval = setInterval(() => {
        if (cancelled) return;

        if (c > 0) {
          if (voiceOn) speak(String(c));
          c -= 1;
          setCountdown(Math.max(c, 0));
        } else {
          clearInterval(interval);
          setBanner(null);
          setPhase("running");
          countdownIntroRef.current = "next"; // reset default
        }
      }, 1000); // ✅ smoother spacing to avoid overlap
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [phase, current?.title, voiceOn, speak]);

  useEffect(() => {
    if (phase !== "running") return;
    if (!current) return;

    const interval = setInterval(() => {
      setSecLeft((prev) => (prev > 0 ? prev - 1 : 0));
      setElapsedSec((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, current?.id]);

  useEffect(() => {
    if (phase !== "running") return;
    if (secLeft !== 0) return;
    if (!current) return;
    void completeStep({ skipped: false });
  }, [phase, secLeft, current?.id]);

  const beginOrResume = useCallback(async () => {
    if (!current) return;
    if (!startedAtClient) setStartedAtClient(new Date());

    if (phase === "ready") countdownIntroRef.current = "start";
    else if (phase === "paused") countdownIntroRef.current = "resume";
    else countdownIntroRef.current = "next";

    setPhase("countdown");
  }, [current, startedAtClient, phase]);

  const pause = useCallback(async () => {
    setPhase("paused");
    speak("Paused");
  }, [speak]);

  const completeStep = useCallback(
    async ({ skipped }: { skipped: boolean }) => {
      if (!current) return;

      setCreditedPlannedSec((p) => p + (current.durationSec || 0));

      if (skipped && secLeft > 0) {
        setElapsedSec((p) => p + secLeft);
      }

      const nextIndex = idx + 1;
      const upcoming = steps[nextIndex];

      if (!upcoming) {
        setPhase("finished");
        try {
          Speech.stop();
        } catch {}
        speak("Workout complete!");
        exitingRef.current = true;

        const user = auth.currentUser;
        if (user) {
          try {
            await AsyncStorage.removeItem(`session_${user.uid}`);
          } catch {}
        }
        return;
      }

      setIdx(nextIndex);
      setSecLeft(upcoming.durationSec);
      countdownIntroRef.current = "next";
      setPhase("countdown");
    },
    [current, secLeft, idx, steps, speak, auth.currentUser]
  );

  const skip = useCallback(async () => {
    if (phase !== "running" && phase !== "paused" && phase !== "countdown")
      return;
    await completeStep({ skipped: true });
  }, [phase, completeStep]);

  const saveToHistory = useCallback(
    async (status: "completed" | "cancelled") => {
      const user = auth.currentUser;
      if (!user || saving) return;

      setSaving(true);
      exitingRef.current = true;

      try {
        const now = new Date();
        const actual =
          status === "completed"
            ? Math.max(elapsedSec, creditedPlannedSec)
            : elapsedSec;

        await addDoc(collection(db, "WorkoutSession"), {
          userId: user.uid,
          status,
          createdAt: serverTimestamp(),
          createdAtClient: Timestamp.fromDate(now),
          startedAtClient: Timestamp.fromDate(startedAtClient || now),
          endedAtClient: Timestamp.fromDate(now),
          totalPlannedDurationSec: totalPlannedSec,
          actualDurationSec: actual,
          rating: status === "completed" ? rating : null,
          feedback: status === "completed" ? feedback.trim() : null,
          steps: steps.map((s) => ({
            title: s.title,
            type: s.type,
            durationSec: s.durationSec,
          })),
        });

        if (status === "completed") Alert.alert("Saved", "Nice work!");
        navigation.goBack();
      } catch (err: any) {
        Alert.alert("Error", err?.message || "Failed to save session.");
      } finally {
        setSaving(false);
      }
    },
    [
      auth.currentUser,
      saving,
      db,
      steps,
      startedAtClient,
      totalPlannedSec,
      elapsedSec,
      creditedPlannedSec,
      rating,
      feedback,
      navigation,
    ]
  );

  const endSession = useCallback(async () => {
    const user = auth.currentUser;
    if (user) {
      try {
        await AsyncStorage.removeItem(`session_${user.uid}`);
      } catch {}
    }
    await saveToHistory("cancelled");
  }, [auth.currentUser, saveToHistory]);

  const Card = ({
    children,
    style,
  }: {
    children: React.ReactNode;
    style?: any;
  }) => (
    <View
      style={[styles.card, { backgroundColor: cardBg, borderColor }, style]}
    >
      {children}
    </View>
  );

  const StepPill = ({ t }: { t: StepType }) => {
    const c = typeColor(t);
    return (
      <View
        style={[
          styles.typePill,
          {
            borderColor: isDarkmode
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.08)",
            backgroundColor: isDarkmode
              ? "rgba(255,255,255,0.04)"
              : "rgba(0,0,0,0.03)",
          },
        ]}
      >
        <View style={[styles.dotSmall, { backgroundColor: c }]} />
        <Text style={{ fontSize: 11, fontWeight: "900", color: dimText }}>
          {t.toUpperCase()}
        </Text>
      </View>
    );
  };

  const renderPlanRow = ({
    item,
    index,
  }: {
    item: GeneratedStep;
    index: number;
  }) => {
    const c = typeColor(item.type);
    return (
      <View style={[styles.planRow, { backgroundColor: cardBg, borderColor }]}>
        <View style={[styles.dot, { backgroundColor: c }]} />
        <View style={{ flex: 1 }}>
          <Text fontWeight="bold" style={{ fontSize: 13 }}>
            {item.title}
          </Text>
          <Text style={{ fontSize: 12, color: dimText, marginTop: 2 }}>
            {item.durationSec >= 60
              ? `${Math.ceil(item.durationSec / 60)} min`
              : `${item.durationSec} sec`}{" "}
            • {item.type}
          </Text>
        </View>
        <Text style={{ fontSize: 12, fontWeight: "900", color: dimText2 }}>
          {index + 1}/{steps.length}
        </Text>
      </View>
    );
  };

  const headerTitle =
    phase === "finished"
      ? "Summary"
      : phase === "ready"
      ? "Workout Plan"
      : "Workout";

  return (
    <Layout>
      <TopNav
        middleContent={headerTitle}
        leftContent={
          <Ionicons
            name="chevron-back"
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        leftAction={() => {
          if (phase === "running") void pause();
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
        <View style={[styles.center, { backgroundColor: bg }]}>
          <ActivityIndicator size="large" color={ACCENT.workout} />
          <Text style={{ marginTop: 10, opacity: 0.7 }}>
            Preparing your workout...
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: bg }}>
          {phase === "ready" && (
            <>
              <FlatList
                data={steps}
                keyExtractor={(x) => x.id}
                renderItem={renderPlanRow}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => loadSession(true)}
                  />
                }
                contentContainerStyle={{ padding: 14, paddingBottom: 160 }}
                ListHeaderComponent={
                  <View style={{ marginBottom: 10 }}>
                    <Text fontWeight="bold" style={{ fontSize: 22 }}>
                      Today’s Workout
                    </Text>
                    <Text
                      style={{ fontSize: 13, color: dimText, marginTop: 6 }}
                    >
                      Total • {Math.ceil(totalPlannedSec / 60)} min •{" "}
                      {steps.length} steps
                    </Text>

                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={
                        { gap: 8, marginTop: 10, paddingRight: 10 } as any
                      }
                    >
                      <StepPill t="warmup" />
                      <StepPill t="work" />
                      <StepPill t="rest" />
                      <StepPill t="cooldown" />
                    </ScrollView>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setVoiceOn((v) => !v)}
                      style={[
                        styles.voiceRow,
                        { backgroundColor: cardBg, borderColor },
                      ]}
                    >
                      <View
                        style={[
                          styles.iconBubble,
                          {
                            backgroundColor: isDarkmode
                              ? "rgba(255,255,255,0.05)"
                              : "rgba(0,0,0,0.04)",
                          },
                        ]}
                      >
                        <Ionicons
                          name={voiceOn ? "volume-high" : "volume-mute"}
                          size={18}
                          color={voiceOn ? ACCENT.workout : "#94A3B8"}
                        />
                      </View>

                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text fontWeight="bold" style={{ fontSize: 14 }}>
                          Voice cues
                        </Text>
                        <Text
                          style={{ fontSize: 12, color: dimText, marginTop: 2 }}
                        >
                          {voiceOn
                            ? "On (Start/Resuming/Next + 3..2..1)"
                            : "Off"}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.pill,
                          {
                            borderColor: voiceOn ? ACCENT.workout : borderColor,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "900",
                            color: voiceOn ? ACCENT.workout : dimText2,
                          }}
                        >
                          {voiceOn ? "ON" : "OFF"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                }
              />

              <View
                style={[
                  styles.bottomBar,
                  {
                    backgroundColor: isDarkmode
                      ? "rgba(11,18,32,0.96)"
                      : "rgba(255,255,255,0.96)",
                    borderTopColor: borderColor,
                  },
                ]}
              >
                <Button
                  text="Start Workout"
                  color={ACCENT.workout}
                  size="lg"
                  onPress={() => void beginOrResume()}
                  style={{ width: "100%" }}
                  leftContent={<Ionicons name="play" color="#fff" size={20} />}
                />
              </View>
            </>
          )}

          {phase !== "ready" && phase !== "finished" && current && (
            <>
              <ScrollView
                contentContainerStyle={{ padding: 14, paddingBottom: 200 }}
                showsVerticalScrollIndicator={false}
              >
                <Card>
                  <View style={styles.progressTop}>
                    <Text style={{ fontSize: 12, color: dimText }}>
                      Progress
                    </Text>
                    <Text style={{ fontSize: 12, color: dimText }}>
                      Step {Math.min(idx + 1, steps.length)}/{steps.length}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.progressBg,
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
                          width: `${Math.round(overallProgress * 100)}%`,
                          backgroundColor: activeColor,
                        },
                      ]}
                    />
                  </View>

                  <View style={styles.miniRow}>
                    <View
                      style={[
                        styles.miniChip,
                        {
                          borderColor: isDarkmode
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(0,0,0,0.08)",
                        },
                      ]}
                    >
                      <Ionicons name="time" size={16} color="#94A3B8" />
                      <Text style={{ marginLeft: 8, fontWeight: "900" }}>
                        {fmtTime(Math.max(elapsedSec, creditedPlannedSec))}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.miniChip,
                        {
                          borderColor: isDarkmode
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(0,0,0,0.08)",
                        },
                      ]}
                    >
                      <Ionicons name="flash" size={16} color={activeColor} />
                      <Text
                        style={{
                          marginLeft: 8,
                          fontWeight: "900",
                          color: dimText,
                        }}
                      >
                        {current.type.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </Card>

                {!!banner && (
                  <View
                    style={[
                      styles.banner,
                      {
                        backgroundColor: cardBg,
                        borderColor,
                        borderLeftColor: activeColor,
                      },
                    ]}
                  >
                    <Ionicons
                      name="arrow-forward-circle"
                      size={18}
                      color={activeColor}
                    />
                    <Text style={{ marginLeft: 10, fontWeight: "900" }}>
                      {banner}
                    </Text>
                  </View>
                )}

                <Card style={{ padding: 16 }}>
                  <View style={{ alignItems: "center" }}>
                    <View
                      style={{
                        width: 260,
                        height: 260,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Svg width={260} height={260}>
                        <Circle
                          cx="130"
                          cy="130"
                          r={radius}
                          stroke={
                            isDarkmode
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,0,0,0.08)"
                          }
                          strokeWidth={16}
                          fill="transparent"
                        />
                        <Circle
                          cx="130"
                          cy="130"
                          r={radius}
                          stroke={activeColor}
                          strokeWidth={16}
                          fill="transparent"
                          strokeDasharray={circumference}
                          strokeDashoffset={dashOffset}
                          strokeLinecap="round"
                          rotation="-90"
                          origin="130, 130"
                        />
                      </Svg>

                      <View
                        style={{ position: "absolute", alignItems: "center" }}
                      >
                        {phase === "countdown" ? (
                          <Text
                            style={{
                              fontSize: 56,
                              fontWeight: "900",
                              color: activeColor,
                              fontVariant: ["tabular-nums"],
                            }}
                          >
                            {countdown}
                          </Text>
                        ) : (
                          <Text
                            style={{
                              fontSize: 52,
                              fontWeight: "900",
                              color: activeColor,
                              fontVariant: ["tabular-nums"],
                            }}
                          >
                            {fmtTime(secLeft)}
                          </Text>
                        )}

                        <View style={{ marginTop: 10 }}>
                          <StepPill t={current.type} />
                        </View>
                      </View>
                    </View>

                    <Text
                      fontWeight="bold"
                      style={{
                        fontSize: 20,
                        marginTop: 12,
                        textAlign: "center",
                      }}
                    >
                      {current.title}
                    </Text>

                    <Text
                      style={{
                        marginTop: 8,
                        color: dimText,
                        textAlign: "center",
                        fontSize: 13,
                        lineHeight: 18,
                      }}
                    >
                      {coachTip}
                    </Text>

                    {showDemo && (
                      <View
                        style={[
                          styles.demoBox,
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
                        {directGifUrl ? (
                          <Image
                            source={{ uri: directGifUrl }}
                            style={styles.demoImg}
                            resizeMode="cover"
                          />
                        ) : media?.link ? (
                          <View style={styles.demoPlaceholder}>
                            <Ionicons
                              name="play-circle"
                              size={26}
                              color={dimText2}
                            />
                            <Text
                              style={{
                                marginTop: 6,
                                color: dimText2,
                                fontSize: 12,
                                textAlign: "center",
                              }}
                            >
                              Demo GIF link
                            </Text>

                            <TouchableOpacity
                              activeOpacity={0.9}
                              onPress={() =>
                                WebBrowser.openBrowserAsync(media.link!)
                              }
                              style={{
                                marginTop: 10,
                                paddingHorizontal: 14,
                                paddingVertical: 10,
                                borderRadius: 999,
                                borderWidth: 1,
                                borderColor: isDarkmode
                                  ? "rgba(255,255,255,0.10)"
                                  : "rgba(0,0,0,0.10)",
                                backgroundColor: isDarkmode
                                  ? "rgba(255,255,255,0.04)"
                                  : "rgba(0,0,0,0.03)",
                              }}
                            >
                              <Text
                                style={{
                                  fontWeight: "900",
                                  color: isDarkmode ? "#fff" : "#111827",
                                }}
                              >
                                Open Demo
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.demoPlaceholder}>
                            <Ionicons name="image" size={22} color={dimText2} />
                            <Text
                              style={{
                                marginTop: 6,
                                color: dimText2,
                                fontSize: 12,
                                textAlign: "center",
                              }}
                            >
                              (Optional) Add GIF URL later
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {next && (
                      <View
                        style={[
                          styles.upNext,
                          {
                            backgroundColor: isDarkmode
                              ? "rgba(255,255,255,0.04)"
                              : "rgba(0,0,0,0.03)",
                            borderColor: isDarkmode
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,0,0,0.08)",
                          },
                        ]}
                      >
                        <Ionicons
                          name="arrow-forward"
                          size={16}
                          color="#94A3B8"
                        />
                        <Text style={{ marginLeft: 8, color: dimText }}>
                          Up next:{" "}
                          <Text
                            fontWeight="bold"
                            style={{ color: isDarkmode ? "#fff" : "#111827" }}
                          >
                            {next.title}
                          </Text>
                        </Text>
                      </View>
                    )}
                  </View>
                </Card>
              </ScrollView>

              <View
                style={[
                  styles.bottomBar,
                  {
                    backgroundColor: isDarkmode
                      ? "rgba(11,18,32,0.96)"
                      : "rgba(255,255,255,0.96)",
                    borderTopColor: borderColor,
                  },
                ]}
              >
                <View style={{ flexDirection: "row", gap: 12 } as any}>
                  {phase === "running" ? (
                    <Button
                      text="Pause"
                      color={ACCENT.warn}
                      onPress={() => void pause()}
                      style={{ flex: 1 }}
                      leftContent={
                        <Ionicons name="pause" color="#fff" size={18} />
                      }
                    />
                  ) : (
                    <Button
                      text="Resume"
                      color={ACCENT.rest}
                      onPress={() => void beginOrResume()}
                      style={{ flex: 1 }}
                      leftContent={
                        <Ionicons name="play" color="#fff" size={18} />
                      }
                    />
                  )}

                  <Button
                    text="Skip"
                    outline
                    color={isDarkmode ? "#fff" : "#111827"}
                    style={{ flex: 0.85 }}
                    onPress={() => void skip()}
                  />
                </View>

                <Button
                  text="End Session"
                  color={ACCENT.danger}
                  outline
                  style={{ marginTop: 10 }}
                  onPress={() =>
                    Alert.alert(
                      "End Session?",
                      "Your session will be saved as cancelled.",
                      [
                        { text: "Keep going", style: "cancel" },
                        {
                          text: "End",
                          style: "destructive",
                          onPress: () => void endSession(),
                        },
                      ]
                    )
                  }
                  leftContent={
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={ACCENT.danger}
                    />
                  }
                />
              </View>
            </>
          )}

          {phase === "finished" && (
            <ScrollView
              contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
              showsVerticalScrollIndicator={false}
            >
              <View
                style={[styles.card, { backgroundColor: cardBg, borderColor }]}
              >
                <View style={{ alignItems: "center" }}>
                  <Ionicons name="trophy" size={64} color={ACCENT.warn} />
                  <Text
                    fontWeight="bold"
                    style={{ fontSize: 20, marginTop: 10 }}
                  >
                    Workout Complete!
                  </Text>
                  <Text style={{ color: dimText, marginTop: 6 }}>
                    Time credited:{" "}
                    {fmtTime(Math.max(elapsedSec, creditedPlannedSec))}
                  </Text>
                </View>

                <Text fontWeight="bold" style={{ marginTop: 18 }}>
                  How did it feel?
                </Text>

                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setRating(s)}
                      style={{ padding: 8 }}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={s <= rating ? "star" : "star-outline"}
                        size={32}
                        color={s <= rating ? ACCENT.warn : "#94A3B8"}
                      />
                    </TouchableOpacity>
                  ))}
                </View>

                <TextInput
                  placeholder="Notes (optional)..."
                  value={feedback}
                  onChangeText={setFeedback}
                />

                <Button
                  text={saving ? "Saving..." : "Save & Close"}
                  color={ACCENT.rest}
                  style={{ marginTop: 16 }}
                  disabled={saving}
                  onPress={() => saveToHistory("completed")}
                />
              </View>
            </ScrollView>
          )}
        </View>
      )}
    </Layout>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
  },

  planRow: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },

  progressTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  progressBg: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 2,
  },
  progressFill: { height: "100%", borderRadius: 999 },

  miniRow: { flexDirection: "row", gap: 10, marginTop: 12 } as any,
  miniChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.02)",
  },

  banner: {
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },

  upNext: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },

  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  dotSmall: { width: 8, height: 8, borderRadius: 4 },

  typePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  } as any,

  voiceRow: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },

  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  pill: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },

  starsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    marginTop: 8,
  },

  demoBox: {
    width: "100%",
    height: 140,
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
    marginTop: 12,
  },

  demoImg: {
    width: "100%",
    height: "100%",
  },

  demoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    borderTopWidth: 1,
  },
});
