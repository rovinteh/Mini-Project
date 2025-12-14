// src/screens/MemoryBook/MemoryMoodCalendar.tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, TouchableOpacity, ScrollView, Modal, Alert } from "react-native";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  Button,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";

import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

import { getAuth } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

import MemoryFloatingMenu from "./MemoryFloatingMenu";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryMoodCalendar">;

type OverrideMap = Record<string, string>; // dateKey -> emoji
type DayEmojiMap = Record<string, string>; // dateKey -> emoji (from last post)

export default function MemoryMoodCalendar({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const firestore = getFirestore();
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || "";

  // =============================
  // Month state
  // =============================
  const [monthDate, setMonthDate] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const currentYear = monthDate.getFullYear();
  const currentMonthIndex = monthDate.getMonth(); // 0-11
  const currentMonthKey = `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}`;

  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const daysInMonth = new Date(currentYear, currentMonthIndex + 1, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonthIndex, 1).getDay();

  const dateKeyFromDay = (day: number) =>
    `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // =============================
  // Theme colors
  // =============================
  const primaryTextColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const subTextColor = isDarkmode ? "#bbb" : "#666";
  const cardBg = isDarkmode ? themeColor.dark100 : "#e9edf2";
  const dayBg = isDarkmode ? "#1f2933" : "#f3f4f6";

  // =============================
  // Data maps
  // =============================
  const [lastPostEmojiByDay, setLastPostEmojiByDay] = useState<DayEmojiMap>({});
  const [overridesByDay, setOverridesByDay] = useState<OverrideMap>({});

  // =============================
  // Edit UI state
  // =============================
  const [editDateKey, setEditDateKey] = useState<string | null>(null);
  const [editVisible, setEditVisible] = useState(false);

  const emojiOptions = useMemo(() => ["😊", "😐", "😴", "😢", "😡"], []);

  // =============================
  // Helper: final emoji for a day
  // =============================
  const emojiForDay = (dateKey: string) => {
    if (overridesByDay[dateKey]) return overridesByDay[dateKey];
    if (lastPostEmojiByDay[dateKey]) return lastPostEmojiByDay[dateKey];
    return "";
  };

  // =============================
  // 1) Load LAST POST mood emoji per day (for current month)
  // Rule: last post wins
  // =============================
  useEffect(() => {
    if (!uid) return;

    setLastPostEmojiByDay({});

    const postsCol = collection(firestore, "posts");
    const qPosts = query(
      postsCol,
      where("CreatedUser.CreatedUserId", "==", uid),
      where("isStory", "==", false),
      orderBy("createdAt", "asc") // ✅ older -> newer, newest overwrites per date
    );

    const unsub = onSnapshot(qPosts, (snap) => {
      const map: DayEmojiMap = {};

      snap.forEach((ds) => {
        const data: any = ds.data();
        const m = data?.mood;

        // expect mood in post:
        // mood: { date:"YYYY-MM-DD", monthKey:"YYYY-MM", emoji:"😊" }
        if (!m?.date || !m?.monthKey || !m?.emoji) return;
        if (String(m.monthKey) !== currentMonthKey) return;

        map[String(m.date)] = String(m.emoji);
      });

      setLastPostEmojiByDay(map);
    });

    return () => unsub();
  }, [uid, firestore, currentMonthKey]);

  // =============================
  // 2) Load overrides for this month
  // Path: users/{uid}/moodOverrides/{YYYY-MM-DD}
  // =============================
  useEffect(() => {
    if (!uid) return;

    setOverridesByDay({});

    const overridesCol = collection(firestore, "users", uid, "moodOverrides");
    const qOverrides = query(overridesCol);

    const unsub = onSnapshot(qOverrides, (snap) => {
      const map: OverrideMap = {};
      snap.forEach((ds) => {
        const dateKey = ds.id; // doc id = YYYY-MM-DD
        if (!dateKey.startsWith(currentMonthKey)) return;

        const data: any = ds.data();
        if (data?.emoji) map[dateKey] = String(data.emoji);
      });
      setOverridesByDay(map);
    });

    return () => unsub();
  }, [uid, firestore, currentMonthKey]);

  // =============================
  // Month navigation
  // =============================
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

  // =============================
  // Edit flow: confirm -> open picker
  // =============================
  const requestEditDay = (dateKey: string) => {
    const hasAi = !!lastPostEmojiByDay[dateKey];
    const hasOverride = !!overridesByDay[dateKey];

    // If no posts and no override, show message (optional)
    if (!hasAi && !hasOverride) {
      Alert.alert("No mood yet", "No posts found for this day.");
      return;
    }

    const current = emojiForDay(dateKey) || "😐";

    Alert.alert(
      "Edit mood emoji?",
      `Change mood for ${dateKey}?\nCurrent: ${current}\n\nThis only changes the calendar display.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Edit",
          onPress: () => {
            setEditDateKey(dateKey);
            setEditVisible(true);
          },
        },
      ]
    );
  };

  const saveOverride = async (emoji: string) => {
    if (!uid || !editDateKey) return;
    try {
      await setDoc(
        doc(firestore, "users", uid, "moodOverrides", editDateKey),
        { emoji, updatedAt: serverTimestamp() },
        { merge: true }
      );
      setEditVisible(false);
      setEditDateKey(null);
    } catch (e) {
      console.log("saveOverride error:", e);
      Alert.alert("Error", "Failed to save emoji override.");
    }
  };

  const removeOverride = async () => {
    if (!uid || !editDateKey) return;
    try {
      await deleteDoc(doc(firestore, "users", uid, "moodOverrides", editDateKey));
      setEditVisible(false);
      setEditDateKey(null);
    } catch (e) {
      console.log("removeOverride error:", e);
      Alert.alert("Error", "Failed to remove override.");
    }
  };

  // =============================
  // Render calendar grid
  // =============================
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
              <Ionicons name="chevron-back" size={20} color={primaryTextColor} />
            </TouchableOpacity>

            <View style={{ alignItems: "center" }}>
              <Text style={{ fontWeight: "bold", fontSize: 16, color: primaryTextColor }}>
                {monthNames[currentMonthIndex]} {currentYear}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  color: subTextColor,
                  marginTop: 2,
                  textAlign: "center",
                }}
              >
                Default emoji comes from AI (last post of each day)
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  color: subTextColor,
                  marginTop: 2,
                  textAlign: "center",
                }}
              >
                Tap a day to edit
              </Text>
            </View>

            <TouchableOpacity onPress={goToNextMonth} style={{ padding: 4 }}>
              <Ionicons name="chevron-forward" size={20} color={primaryTextColor} />
            </TouchableOpacity>
          </View>

          {/* weekday labels */}
          <View style={{ flexDirection: "row", marginBottom: 6 }}>
            {weekdayLabels.map((w) => (
              <View key={w} style={{ flex: 1, alignItems: "center", paddingVertical: 2 }}>
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

              const dateKey = dateKeyFromDay(day);
              const emo = emojiForDay(dateKey);
              const hasOverride = !!overridesByDay[dateKey];

              return (
                <View key={dateKey} style={{ width: "14.285%", aspectRatio: 1, padding: 2 }}>
                  <TouchableOpacity
                    onPress={() => requestEditDay(dateKey)}
                    activeOpacity={0.75}
                    style={{
                      flex: 1,
                      borderRadius: 999,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: dayBg,
                      borderWidth: hasOverride ? 2 : 0,
                      borderColor: hasOverride ? themeColor.info : "transparent",
                    }}
                  >
                    <Text style={{ fontSize: 11, color: primaryTextColor }}>{day}</Text>
                    <Text style={{ fontSize: 16, marginTop: 2 }}>{emo || " "}</Text>

                    {hasOverride && (
                      <Text style={{ fontSize: 9, marginTop: 1, color: themeColor.info }}>
                        edited
                      </Text>
                    )}
                  </TouchableOpacity>
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
              ["😊", "Happy"],
              ["😐", "Neutral"],
              ["😴", "Tired"],
              ["😢", "Sad"],
              ["😡", "Angry"],
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
                <Text style={{ fontSize: 11, color: isDarkmode ? "#ddd" : "#444" }}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Edit modal */}
        <Modal
          visible={editVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setEditVisible(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.55)",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <View
              style={{
                width: "100%",
                maxWidth: 380,
                borderRadius: 16,
                backgroundColor: isDarkmode ? "#0b1220" : "#fff",
                padding: 14,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "700", color: primaryTextColor }}>
                Pick an emoji
              </Text>
              <Text style={{ marginTop: 6, fontSize: 12, color: subTextColor }}>
                Date: {editDateKey}
              </Text>

              <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12 }}>
                {emojiOptions.map((emo) => (
                  <TouchableOpacity
                    key={emo}
                    onPress={() => saveOverride(emo)}
                    style={{
                      width: "20%",
                      paddingVertical: 10,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 26 }}>{emo}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: "row", marginTop: 12 }}>
                <Button
                  text="Cancel"
                  status="info"
                  style={{ flex: 1, marginRight: 8 }}
                  onPress={() => {
                    setEditVisible(false);
                    setEditDateKey(null);
                  }}
                />

                <Button
                  text="Remove edit"
                  status="danger"
                  style={{ flex: 1 }}
                  disabled={!editDateKey || !overridesByDay[String(editDateKey)]}
                  onPress={() => {
                    Alert.alert(
                      "Remove edited emoji?",
                      "This will go back to AI emoji from your last post of that day.",
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Remove", style: "destructive", onPress: removeOverride },
                      ]
                    );
                  }}
                />
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  };

  // =============================
  // Not signed in
  // =============================
  if (!currentUser) {
    return (
      <Layout>
        <TopNav
          middleContent={<Text>Mood Calendar</Text>}
          leftContent={<Ionicons name="chevron-back" size={20} color={primaryTextColor} />}
          leftAction={() => navigation.popToTop()}
          rightContent={
            <Ionicons
              name={isDarkmode ? "sunny" : "moon"}
              size={20}
              color={primaryTextColor}
            />
          }
          rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
        />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text>Please sign in to use the mood calendar.</Text>
        </View>
      </Layout>
    );
  }

  // =============================
  // Main render
  // =============================
  return (
    <Layout>
      <TopNav
        middleContent={<Text>Mood Calendar</Text>}
        leftContent={<Ionicons name="chevron-back" size={20} color={primaryTextColor} />}
        leftAction={() => navigation.popToTop()}
        rightContent={
          <Ionicons name={isDarkmode ? "sunny" : "moon"} size={20} color={primaryTextColor} />
        }
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />

      <View style={{ flex: 1 }}>{renderMoodCalendar()}</View>
      <MemoryFloatingMenu navigation={navigation as any} />
    </Layout>
  );
}
