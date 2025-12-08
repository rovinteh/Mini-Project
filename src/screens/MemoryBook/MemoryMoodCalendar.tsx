// src/screens/MemoryBook/MemoryMoodCalendar.tsx
import React, { useEffect, useState } from "react";
import { View, TouchableOpacity, ScrollView } from "react-native";
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
  setDoc,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import MemoryFloatingMenu from "./MemoryFloatingMenu";
type Props = NativeStackScreenProps<MainStackParamList, "MemoryMoodCalendar">;

type MoodCategory = "positive" | "neutral" | "tired" | "sad";

export default function MemoryMoodCalendar({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const firestore = getFirestore();
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || "";

  const [displayName, setDisplayName] = useState<string>("My Account");

  // "YYYY-MM-DD" -> emoji
  const [moods, setMoods] = useState<Record<string, string>>({});

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

  const daysInMonth = new Date(
    currentYear,
    currentMonthIndex + 1,
    0
  ).getDate();
  const firstDayIndex = new Date(currentYear, currentMonthIndex, 1).getDay();

  const dateKeyFromDay = (day: number) =>
    `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;

  const dateKeyFromDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

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

  // ---- load moods for current month (users/{uid}/moods) ----
  useEffect(() => {
    if (!uid) return;

    setMoods({});

    const moodsCol = collection(firestore, "users", uid, "moods");
    const qMoods = query(moodsCol, where("monthKey", "==", currentMonthKey));

    const unsub = onSnapshot(qMoods, (snap) => {
      const map: Record<string, string> = {};
      snap.forEach((ds) => {
        const data = ds.data() as any;
        if (data.date) {
          map[data.date] = data.emoji || "";
        }
      });
      setMoods(map);
    });

    return () => unsub();
  }, [uid, firestore, currentMonthKey]);

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

    if (typeof data.moodScore === "number") {
      score = data.moodScore;
    } else {
      score = scoreFromLabel(data.moodLabel);
    }

    // 通过 score -> 大分类
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
    // 找出出现最多的类别
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

    if (bestCount === 0) return null; // 没有任何贴文

    const topCats = entries
      .filter(([, c]) => c === bestCount)
      .map(([cat]) => cat);

    // 如果最高票不止一个 → 平手 → neutral
    if (topCats.length > 1) {
      return "😐";
    }

    const only = topCats[0];
    switch (only) {
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

  // ---- auto-compute moods per day, using AI mood from posts ----
  // 多数决 + 当某天没有任何 post 时，自动把该日的 mood doc 删除
  useEffect(() => {
    if (!uid) return;

    const postsCol = collection(firestore, "posts");
    const qPosts = query(
      postsCol,
      where("CreatedUser.CreatedUserId", "==", uid)
    );

    const unsub = onSnapshot(qPosts, async (snap) => {
      // 每天的分类计数
      const perDay: Record<
        string,
        { positive: number; neutral: number; tired: number; sad: number }
      > = {};

      snap.forEach((ds) => {
        const data = ds.data() as any;

        const createdAt = data.createdAt;
        let dateObj: Date;
        if (createdAt && typeof createdAt.toDate === "function") {
          dateObj = createdAt.toDate();
        } else if (createdAt) {
          dateObj = new Date(createdAt);
        } else {
          return;
        }

        const key = dateKeyFromDate(dateObj);
        const cat = moodCategoryFromPost(data);

        if (!perDay[key]) {
          perDay[key] = { positive: 0, neutral: 0, tired: 0, sad: 0 };
        }
        perDay[key][cat] += 1;
      });

      const moodsCol = collection(firestore, "users", uid, "moods");
      const writePromises: Promise<any>[] = [];

      const dateKeysWithPosts = new Set<string>();

      // 写入 / 更新有贴文的日期
      Object.entries(perDay).forEach(([dateKey, counts]) => {
        const emoji = emojiFromCategoryMajority(counts);
        if (!emoji) return; // 理论上不会发生，但以防万一

        dateKeysWithPosts.add(dateKey);
        const monthKeyFromDate = dateKey.slice(0, 7); // "YYYY-MM"

        writePromises.push(
          setDoc(
            doc(firestore, "users", uid, "moods", dateKey),
            {
              date: dateKey,
              emoji,
              monthKey: monthKeyFromDate,
            },
            { merge: true }
          )
        );
      });

      // 把现在 moods 里那些「已经没有任何贴文的日期」删掉
      const deletePromises: Promise<any>[] = [];
      try {
        const existing = await getDocs(moodsCol);
        existing.forEach((ds) => {
          const data = ds.data() as any;
          const dateKey = (data.date as string) || ds.id;
          if (!dateKeysWithPosts.has(dateKey)) {
            deletePromises.push(deleteDoc(ds.ref));
          }
        });
      } catch (e) {
        console.log("Failed to load existing moods for cleanup:", e);
      }

      try {
        await Promise.all([...writePromises, ...deletePromises]);
      } catch (e) {
        console.log("Failed to auto-save moods:", e);
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
                style={{
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 2,
                }}
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
                    style={{
                      width: "14.285%",
                      aspectRatio: 1,
                      padding: 2,
                    }}
                  />
                );
              }

              const key = dateKeyFromDay(day);
              const emoji = moods[key];

              return (
                <View
                  key={key}
                  style={{
                    width: "14.285%",
                    aspectRatio: 1,
                    padding: 2,
                  }}
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
                    <Text
                      style={{
                        fontSize: 11,
                        color: primaryTextColor,
                      }}
                    >
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
                  style={{
                    fontSize: 11,
                    color: isDarkmode ? "#ddd" : "#444",
                  }}
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

      <View style={{ flex: 1 }}>{renderMoodCalendar()}</View>
      <MemoryFloatingMenu navigation={navigation} />
    </Layout>
  );
}
