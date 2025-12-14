// src/screens/MemoryBook/MemoryMoodCalendar.tsx
import React, { useEffect, useRef, useState } from "react";
import { View, TouchableOpacity, ScrollView, Platform } from "react-native";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";

import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  writeBatch,
  Timestamp,
  orderBy,
} from "firebase/firestore";

import * as Notifications from "expo-notifications";
import MemoryFloatingMenu from "./MemoryFloatingMenu";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryMoodCalendar">;

type MoodCategory = "positive" | "neutral" | "tired" | "sad";

// ✅ foreground notification behavior (iOS Expo Go friendly)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function MemoryMoodCalendar({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const firestore = getFirestore();
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || "";

  const [displayName, setDisplayName] = useState<string>("My Account");

  // "YYYY-MM-DD" -> emoji
  const [moods, setMoods] = useState<Record<string, string>>({});
  const moodsRef = useRef<Record<string, string>>({}); // for change detection
  const lastMoodNotifyKeyRef = useRef<string>(""); // anti-spam

  // which month is being viewed
  const [monthDate, setMonthDate] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const primaryTextColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const cardBg = isDarkmode ? themeColor.dark100 : "#e9edf2";

  // ----- derived month values -----
  const currentYear = monthDate.getFullYear();
  const currentMonthIndex = monthDate.getMonth(); // 0-11
  const currentMonthKey = `${currentYear}-${String(
    currentMonthIndex + 1
  ).padStart(2, "0")}`;

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const daysInMonth = new Date(currentYear, currentMonthIndex + 1, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonthIndex, 1).getDay();

  const dateKeyFromDay = (day: number) =>
    `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;

  const dateKeyFromDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  const labelFromEmoji = (emoji: string) => {
    switch (emoji) {
      case "😊":
        return "Happy";
      case "😢":
        return "Sad";
      case "😴":
        return "Tired";
      case "😐":
      default:
        return "Neutral";
    }
  };

  // -------------------------------
  // ✅ Local notifications setup
  // -------------------------------
  const ensureLocalNotificationsReady = async () => {
    try {
      // Android needs channel for sound/importance
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("mood", {
          name: "Mood Updates",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "default",
          vibrationPattern: [0, 200, 200, 200],
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }

      const perm = await Notifications.getPermissionsAsync();
      if (perm.status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        if (req.status !== "granted") {
          console.log("Notification permission not granted.");
        }
      }
    } catch (e) {
      console.log("ensureLocalNotificationsReady error:", e);
    }
  };

  // ✅ Expo Go + iPhone: presentNotificationAsync is more reliable for immediate show
  const sendMoodLocalNotification = async (emoji: string) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Mood updated",
          body: `Your current mood is ${labelFromEmoji(emoji)} ${emoji}`,
          sound: "default",
        },
        trigger: null, // ✅ fire immediately
      });
    } catch (e) {
      console.log("Failed to present local notification:", e);
    }
  };

  // ask permission when screen opens
  useEffect(() => {
    ensureLocalNotificationsReady();
  }, []);

  // ---- load user display name ----
  useEffect(() => {
    if (!uid) return;

    const load = async () => {
      try {
        const snap = await getDoc(doc(firestore, "users", uid));
        if (snap.exists()) {
          const data = snap.data() as any;
          setDisplayName(data.displayName || "My Account");
        }
      } catch (e) {
        console.log("Failed to load user info:", e);
      }
    };

    load();
  }, [uid, firestore]);

  // ---- load moods for current month (READ FROM posts.mood) ----
  useEffect(() => {
    if (!uid) return;

    setMoods({});
    moodsRef.current = {};

    const postsCol = collection(firestore, "posts");
    const qPosts = query(
      postsCol,
      where("CreatedUser.CreatedUserId", "==", uid),
      where("isStory", "==", false),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(qPosts, (snap) => {
      const map: Record<string, string> = {};

      snap.forEach((ds) => {
        const data: any = ds.data();
        const m = data.mood;
        if (m?.date && m?.emoji && m?.monthKey === currentMonthKey) {
          map[m.date] = m.emoji;
        }
      });

      moodsRef.current = map;
      setMoods(map);
    });

    return () => unsub();
  }, [uid, firestore, currentMonthKey]);

  // ✅ Notify user if TODAY mood emoji changes (LOCAL ONLY)
  useEffect(() => {
    if (!uid) return;

    const todayKey = dateKeyFromDate(new Date());
    const postsCol = collection(firestore, "posts");

    const qToday = query(
      postsCol,
      where("CreatedUser.CreatedUserId", "==", uid),
      where("mood.date", "==", todayKey)
    );

    const unsub = onSnapshot(qToday, async (snap) => {
      const counts: Record<string, number> = {};

      snap.forEach((ds) => {
        const data: any = ds.data();
        const emo = data?.mood?.emoji;
        if (!emo) return;
        counts[emo] = (counts[emo] || 0) + 1;
      });

      let bestEmoji: string | null = null;
      let bestCount = 0;

      Object.entries(counts).forEach(([emo, c]) => {
        if (c > bestCount) {
          bestCount = c;
          bestEmoji = emo;
        }
      });

      if (!bestEmoji) return;

      const emoji = bestEmoji;
      const prevEmoji = moodsRef.current[todayKey];

      if (emoji !== prevEmoji) {
        const notifyKey = `${todayKey}:${emoji}`;

        if (lastMoodNotifyKeyRef.current !== notifyKey) {
          lastMoodNotifyKeyRef.current = notifyKey;

          // ✅ Option A: local-only notification
          await sendMoodLocalNotification(emoji);
        }

        setMoods((prev) => {
          const next = { ...prev, [todayKey]: emoji };
          moodsRef.current = next;
          return next;
        });
      }
    });

    return () => unsub();
  }, [uid, firestore]);

  // ---------- helper: score & category ----------
  const scoreFromLabel = (label?: string | null) => {
    const l = (label || "").toLowerCase();
    switch (l) {
      case "happy":
        return 0.9;
      case "loved":
        return 1.0;
      case "neutral":
        return 0;
      case "tired":
        return -0.5;
      case "sad":
        return -0.9;
      case "angry":
        return -1.0;
      default:
        return 0;
    }
  };

  const moodCategoryFromPost = (data: any): MoodCategory => {
    let score: number;

    if (typeof data.moodScore === "number") score = data.moodScore;
    else score = scoreFromLabel(data.moodLabel);

    if (score >= 0.3) return "positive";
    if (score <= -0.7) return "sad";
    if (score <= -0.3) return "tired";
    return "neutral";
  };

  const emojiFromCategoryMajority = (counts: {
    positive: number;
    neutral: number;
    tired: number;
    sad: number;
  }): string | null => {
    const entries: [MoodCategory, number][] = [
      ["positive", counts.positive],
      ["neutral", counts.neutral],
      ["tired", counts.tired],
      ["sad", counts.sad],
    ];

    let bestCount = 0;
    entries.forEach(([, c]) => {
      if (c > bestCount) bestCount = c;
    });

    if (bestCount === 0) return null;

    const topCats = entries
      .filter(([, c]) => c === bestCount)
      .map(([cat]) => cat);

    if (topCats.length > 1) return "😐";

    switch (topCats[0]) {
      case "positive":
        return "😊";
      case "sad":
        return "😢";
      case "tired":
        return "😴";
      case "neutral":
      default:
        return "😐";
    }
  };

  // ---- auto-compute moods per day, STORE INTO posts.mood ----
  useEffect(() => {
    if (!uid) return;

    const postsCol = collection(firestore, "posts");
    const qPosts = query(
      postsCol,
      where("CreatedUser.CreatedUserId", "==", uid)
    );

    const unsub = onSnapshot(qPosts, async (snap) => {
      const postsByDate: Record<string, { ref: any; data: any }[]> = {};

      snap.forEach((ds) => {
        const data: any = ds.data();
        const createdAt = data.createdAt;

        let dateObj: Date | null = null;

        if (createdAt && typeof createdAt.toDate === "function") {
          dateObj = createdAt.toDate();
        } else if (createdAt?.seconds) {
          dateObj = new Date(createdAt.seconds * 1000);
        } else if (createdAt) {
          dateObj = new Date(createdAt);
        }

        if (!dateObj || isNaN(dateObj.getTime())) return;

        const dateKey = dateKeyFromDate(dateObj);
        if (!postsByDate[dateKey]) postsByDate[dateKey] = [];
        postsByDate[dateKey].push({ ref: ds.ref, data });
      });

      const batch = writeBatch(firestore);
      const dateKeysWithPosts = new Set<string>();

      Object.entries(postsByDate).forEach(([dateKey, list]) => {
        const counts = { positive: 0, neutral: 0, tired: 0, sad: 0 };

        list.forEach(({ data }) => {
          const cat = moodCategoryFromPost(data);
          counts[cat] += 1;
        });

        const emoji = emojiFromCategoryMajority(counts);
        if (!emoji) return;

        dateKeysWithPosts.add(dateKey);
        const monthKeyFromDate = dateKey.slice(0, 7);

        list.forEach(({ ref }) => {
          batch.update(ref, {
            mood: {
              date: dateKey,
              emoji,
              monthKey: monthKeyFromDate,
              updatedAt: Timestamp.now(),
            },
          });
        });
      });

      // optional cleanup
      snap.forEach((ds) => {
        const data: any = ds.data();
        const m = data.mood;
        if (!m?.date) return;
        if (!dateKeysWithPosts.has(m.date)) {
          batch.update(ds.ref, { mood: null });
        }
      });

      try {
        await batch.commit();
      } catch (e) {
        console.log("Failed to auto-save moods into posts:", e);
      }
    });

    return () => unsub();
  }, [uid, firestore]);

  const goToPrevMonth = () => {
    setMonthDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return new Date(d.getFullYear(), d.getMonth(), 1);
    });
  };

  const goToNextMonth = () => {
    setMonthDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      return new Date(d.getFullYear(), d.getMonth(), 1);
    });
  };

  const renderMoodCalendar = () => {
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDayIndex; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
      <ScrollView>
        <View
          style={{
            marginTop: 20,
            marginHorizontal: 16,
            padding: 12,
            borderRadius: 16,
            backgroundColor: cardBg,
          }}
        >
          {/* Month header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <TouchableOpacity onPress={goToPrevMonth} style={{ padding: 4 }}>
              <Ionicons
                name="chevron-back"
                size={20}
                color={primaryTextColor}
              />
            </TouchableOpacity>

            <View style={{ alignItems: "center" }}>
              <Text
                style={{
                  fontWeight: "bold",
                  fontSize: 16,
                  color: primaryTextColor,
                }}
              >
                {monthNames[currentMonthIndex]} {currentYear}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  color: isDarkmode ? "#bbb" : "#666",
                  marginTop: 2,
                  textAlign: "center",
                }}
              >
                Emojis are AI-detected from your daily posts 🧠
              </Text>
            </View>

            <TouchableOpacity onPress={goToNextMonth} style={{ padding: 4 }}>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={primaryTextColor}
              />
            </TouchableOpacity>
          </View>

          {/* weekday labels */}
          <View style={{ flexDirection: "row", marginBottom: 6 }}>
            {weekdayLabels.map((w) => (
              <View
                key={w}
                style={{ flex: 1, alignItems: "center", paddingVertical: 2 }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "bold",
                    color: isDarkmode ? "#ddd" : "#444",
                  }}
                >
                  {w}
                </Text>
              </View>
            ))}
          </View>

          {/* grid */}
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {cells.map((day, idx) => {
              if (day == null) {
                return (
                  <View
                    key={`empty-${idx}`}
                    style={{ width: "14.285%", aspectRatio: 1, padding: 2 }}
                  />
                );
              }

              const key = dateKeyFromDay(day);
              const emoji = moods[key];

              return (
                <View
                  key={key}
                  style={{ width: "14.285%", aspectRatio: 1, padding: 2 }}
                >
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 999,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isDarkmode ? "#1f2933" : "#f3f4f6",
                    }}
                  >
                    <Text style={{ fontSize: 11, color: primaryTextColor }}>
                      {day}
                    </Text>
                    <Text style={{ fontSize: 16, marginTop: 2 }}>
                      {emoji || " "}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* legend */}
          <View
            style={{
              marginTop: 10,
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            {[
              ["😊", "Positive / Happy"],
              ["😐", "Neutral / Mixed"],
              ["😢", "Sad"],
              ["😴", "Tired / Stressed"],
            ].map(([emo, label]) => (
              <View
                key={label}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginVertical: 2,
                  width: "48%",
                }}
              >
                <Text style={{ fontSize: 16, marginRight: 4 }}>{emo}</Text>
                <Text
                  style={{ fontSize: 11, color: isDarkmode ? "#ddd" : "#444" }}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    );
  };

  if (!currentUser) {
    return (
      <Layout>
        <TopNav
          middleContent={<Text>Mood Calendar</Text>}
          leftContent={
            <Ionicons
              name="chevron-back"
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
            />
          }
          leftAction={() => navigation.popToTop()}
          rightContent={
            <Ionicons
              name={isDarkmode ? "sunny" : "moon"}
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
            />
          }
          rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
        />
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Text>Please sign in to use the mood calendar.</Text>
        </View>
      </Layout>
    );
  }

  return (
    <Layout>
      <TopNav
        middleContent={<Text>Mood Calendar</Text>}
        leftContent={
          <Ionicons
            name="chevron-back"
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        leftAction={() => navigation.popToTop()}
        rightContent={
          <Ionicons
            name={isDarkmode ? "sunny" : "moon"}
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />

      <View style={{ flex: 1 }}>{renderMoodCalendar()}</View>
      <MemoryFloatingMenu navigation={navigation as any} />
    </Layout>
  );
}
