import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
} from "react-native";
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
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  writeBatch,
  Timestamp,
  orderBy,
  getDocs,
} from "firebase/firestore";

import MemoryFloatingMenu from "./MemoryFloatingMenu";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryMoodCalendar">;

type MoodCategory = "positive" | "neutral" | "tired" | "sad";

// ✅ manual edit emoji list (you can add more)
const EMOJI_OPTIONS = [
  { emoji: "😊", label: "Happy" },
  { emoji: "😐", label: "Neutral" },
  { emoji: "😴", label: "Tired" },
  { emoji: "😢", label: "Sad" },
  { emoji: "😡", label: "Angry" }, // optional, in case AI returns angry
  { emoji: "🤩", label: "Excited" },
  { emoji: "😌", label: "Calm" },
];

export default function MemoryMoodCalendar({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const firestore = getFirestore();
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || "";

  const [displayName, setDisplayName] = useState<string>("My Account");

  // "YYYY-MM-DD" -> emoji
  const [moods, setMoods] = useState<Record<string, string>>({});
  const moodsRef = useRef<Record<string, string>>({});

  // ✅ keep track of user manual overrides so auto-compute won't overwrite
  // "YYYY-MM-DD" -> true
  const [manualMoodEdits, setManualMoodEdits] = useState<Record<string, boolean>>(
    {}
  );
  const manualRef = useRef<Record<string, boolean>>({});

  // ✅ editing modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingDateKey, setEditingDateKey] = useState<string | null>(null);
  const [editingCurrentEmoji, setEditingCurrentEmoji] = useState<string>("😐");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

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
  const currentMonthKey = `${currentYear}-${String(currentMonthIndex + 1).padStart(
    2,
    "0"
  )}`;

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
    const found = EMOJI_OPTIONS.find((x) => x.emoji === emoji);
    if (found) return found.label;
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

  // -------------------------------------------------------
  // ✅ load moods for current month (READ FROM posts.mood)
  // ALSO load manual flags (mood.manual === true)
  // -------------------------------------------------------
  useEffect(() => {
    if (!uid) return;

    setMoods({});
    moodsRef.current = {};
    setManualMoodEdits({});
    manualRef.current = {};

    const postsCol = collection(firestore, "posts");
    const qPosts = query(
      postsCol,
      where("CreatedUser.CreatedUserId", "==", uid),
      where("isStory", "==", false),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(qPosts, (snap) => {
      const map: Record<string, string> = {};
      const manualMap: Record<string, boolean> = {};

      snap.forEach((ds) => {
        const data: any = ds.data();
        const m = data.mood;
        if (m?.date && m?.emoji && m?.monthKey === currentMonthKey) {
          map[m.date] = m.emoji;
          if (m.manual === true) manualMap[m.date] = true;
        }
      });

      moodsRef.current = map;
      setMoods(map);

      manualRef.current = manualMap;
      setManualMoodEdits(manualMap);
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

  // -------------------------------------------------------
  // ✅ auto-compute moods per day, STORE INTO posts.mood
  // ✅ but SKIP dates manually edited (mood.manual === true)
  // -------------------------------------------------------
  useEffect(() => {
    if (!uid) return;

    const postsCol = collection(firestore, "posts");
    const qPosts = query(postsCol, where("CreatedUser.CreatedUserId", "==", uid));

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

        // ✅ Skip auto overwrite if manually edited
        if (manualRef.current?.[dateKey] === true) return;

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
              manual: false, // ✅ computed
            },
          });
        });
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

  // -------------------------------------------------------
  // ✅ EDIT FLOW (long press -> confirm -> open modal)
  // -------------------------------------------------------
  const openEditForDate = (dateKey: string) => {
    const currentEmoji = moodsRef.current?.[dateKey] || "😐";

    Alert.alert(
      "Edit mood emoji?",
      `Change ${dateKey} from ${currentEmoji} (${labelFromEmoji(
        currentEmoji
      )})?\n\nThis prevents accidental taps.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Edit",
          style: "default",
          onPress: () => {
            setEditingDateKey(dateKey);
            setEditingCurrentEmoji(currentEmoji);
            setEditModalVisible(true);
          },
        },
      ]
    );
  };

  // save manual emoji to ALL posts that day
  const saveManualEmoji = async (dateKey: string, emoji: string) => {
    if (!uid) return;

    try {
      setIsSavingEdit(true);

      // Query posts in that day by checking mood.date == dateKey
      // Note: your auto-compute writes mood.date on each post, so this works.
      const postsCol = collection(firestore, "posts");
      const qDay = query(
        postsCol,
        where("CreatedUser.CreatedUserId", "==", uid),
        where("isStory", "==", false),
        where("mood.date", "==", dateKey)
      );

      const snap = await getDocs(qDay);
      const batch = writeBatch(firestore);

      const monthKeyFromDate = dateKey.slice(0, 7);

      snap.forEach((ds) => {
        batch.update(ds.ref, {
          mood: {
            date: dateKey,
            emoji,
            monthKey: monthKeyFromDate,
            updatedAt: Timestamp.now(),
            manual: true, // ✅ manual override
          },
        });
      });

      await batch.commit();

      // update local maps immediately (smooth UI)
      setMoods((prev) => ({ ...prev, [dateKey]: emoji }));
      moodsRef.current = { ...moodsRef.current, [dateKey]: emoji };

      setManualMoodEdits((prev) => {
        const next = { ...prev, [dateKey]: true };
        manualRef.current = next;
        return next;
      });

      setEditModalVisible(false);
      setEditingDateKey(null);

      Alert.alert("Saved", `Mood for ${dateKey} updated to ${emoji}.`);
    } catch (e) {
      console.log("saveManualEmoji error:", e);
      Alert.alert("Error", "Failed to update mood. Please try again.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const renderEditModal = () => {
    if (!editingDateKey) return null;

    return (
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (isSavingEdit) return;
          setEditModalVisible(false);
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View
            style={{
              borderRadius: 16,
              padding: 16,
              backgroundColor: isDarkmode ? "#111" : "#fff",
              borderWidth: 1,
              borderColor: isDarkmode ? "#222" : "#eee",
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "bold",
                color: primaryTextColor,
              }}
            >
              Edit mood for {editingDateKey}
            </Text>

            <Text
              style={{
                marginTop: 6,
                fontSize: 12,
                color: isDarkmode ? "#bbb" : "#666",
              }}
            >
              Pick an emoji. This will override AI for that date.
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12 }}>
              {EMOJI_OPTIONS.map((opt) => {
                const active = opt.emoji === editingCurrentEmoji;
                return (
                  <TouchableOpacity
                    key={opt.emoji}
                    onPress={() => setEditingCurrentEmoji(opt.emoji)}
                    style={{
                      width: "25%",
                      padding: 8,
                      alignItems: "center",
                    }}
                  >
                    <View
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 26,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: active
                          ? (isDarkmode ? "#1f3b5c" : "#d7e7ff")
                          : (isDarkmode ? "#1f2933" : "#f3f4f6"),
                        borderWidth: active ? 1 : 0,
                        borderColor: active ? themeColor.info : "transparent",
                      }}
                    >
                      <Text style={{ fontSize: 24 }}>{opt.emoji}</Text>
                    </View>
                    <Text
                      style={{
                        marginTop: 4,
                        fontSize: 10,
                        color: isDarkmode ? "#ddd" : "#444",
                      }}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 12,
              }}
            >
              <Button
                text="Cancel"
                style={{ width: "48%" }}
                disabled={isSavingEdit}
                onPress={() => setEditModalVisible(false)}
              />
              <Button
                text={isSavingEdit ? "Saving..." : "Save"}
                status="info"
                style={{ width: "48%" }}
                disabled={isSavingEdit}
                onPress={() => {
                  // ✅ second safety confirm (prevents accidental save)
                  Alert.alert(
                    "Confirm change",
                    `Save ${editingCurrentEmoji} for ${editingDateKey}?`,
                    [
                      { text: "No", style: "cancel" },
                      {
                        text: "Yes, save",
                        style: "default",
                        onPress: () => saveManualEmoji(editingDateKey, editingCurrentEmoji),
                      },
                    ]
                  );
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    );
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
              <Ionicons name="chevron-back" size={20} color={primaryTextColor} />
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
                Long-press a day to edit (with confirmation) ✍️
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
              const isManual = manualMoodEdits[key] === true;

              return (
                <View
                  key={key}
                  style={{ width: "14.285%", aspectRatio: 1, padding: 2 }}
                >
                  {/* ✅ Long press to edit */}
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onLongPress={() => {
                      // only allow edit if this date has an emoji (means there are posts)
                      if (!emoji) {
                        Alert.alert(
                          "No mood yet",
                          "No posts detected for this day, so there’s nothing to edit."
                        );
                        return;
                      }
                      openEditForDate(key);
                    }}
                    delayLongPress={350}
                    style={{
                      flex: 1,
                      borderRadius: 999,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isDarkmode ? "#1f2933" : "#f3f4f6",
                      borderWidth: isManual ? 1 : 0,
                      borderColor: isManual ? themeColor.info : "transparent",
                    }}
                  >
                    <Text style={{ fontSize: 11, color: primaryTextColor }}>
                      {day}
                    </Text>

                    <Text style={{ fontSize: 16, marginTop: 2 }}>
                      {emoji || " "}
                    </Text>

                    {/* ✅ small "edited" hint */}
                    {isManual && (
                      <Text
                        style={{
                          marginTop: 1,
                          fontSize: 9,
                          color: isDarkmode ? "#9cc8ff" : "#2c6db6",
                        }}
                      >
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
                <Text style={{ fontSize: 11, color: isDarkmode ? "#ddd" : "#444" }}>
                  {label}
                </Text>
              </View>
            ))}
          </View>

          <Text
            style={{
              marginTop: 10,
              fontSize: 11,
              color: isDarkmode ? "#bbb" : "#666",
            }}
          >
            Tip: Manual edits are highlighted with a blue border.
          </Text>
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
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
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

      {/* ✅ Modal */}
      {renderEditModal()}

      <MemoryFloatingMenu navigation={navigation as any} />
    </Layout>
  );
}
