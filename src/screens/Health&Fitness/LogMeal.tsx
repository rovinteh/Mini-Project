import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Platform,
  KeyboardAvoidingView,
  Image,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
  RefreshControl,
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
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  addDoc,
  collection,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  orderBy,
  Timestamp,
  doc,
  deleteDoc,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";

type Props = NativeStackScreenProps<MainStackParamList, "LogMeal">;

type MealEntry = {
  id: string;
  mealType: string;
  category: string;
  notes: string;
  photoURL?: string | null;
  mealTimeClient?: any;
  // calories?: number | null; // (kept removed from UI)
  isWater?: boolean;
  volumeMl?: number | null;
};

// --- Theme (match FitnessMenu / WeeklySummary) ---
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

// --- Meal colors (keep) ---
const COLOR_BREAKFAST = "#F59E0B";
const COLOR_LUNCH = "#EF4444";
const COLOR_DINNER = "#8B5CF6";
const COLOR_SNACK = "#10B981";
const FITNESS_COLOR = "#22C55E";

const MEAL_TYPES = [
  {
    label: "Breakfast",
    value: "breakfast",
    icon: "sunny",
    color: COLOR_BREAKFAST,
  },
  { label: "Lunch", value: "lunch", icon: "restaurant", color: COLOR_LUNCH },
  { label: "Dinner", value: "dinner", icon: "moon", color: COLOR_DINNER },
  { label: "Snack", value: "snack", icon: "cafe", color: COLOR_SNACK },
] as const;

const QUICK_TAGS = [
  "Rice",
  "Chicken",
  "Noodles",
  "Egg",
  "Fish",
  "Veg",
  "Bread",
  "Coffee",
  "Fruits",
  "Soup",
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export default function LogMealScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();

  const bg = isDarkmode ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDarkmode ? COLORS.cardDark : COLORS.cardLight;
  const borderColor = isDarkmode ? COLORS.borderDark : COLORS.borderLight;
  const dimText = isDarkmode ? COLORS.dimDark : COLORS.dimLight;
  const dimText2 = isDarkmode ? COLORS.dimDark2 : COLORS.dimLight2;

  // --- Form State ---
  const [image, setImage] = useState<string | null>(null);
  const [mealType, setMealType] = useState<string>("breakfast");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // --- Data State ---
  const [todayMeals, setTodayMeals] = useState<MealEntry[]>([]);
  const [loadingMeals, setLoadingMeals] = useState(true);

  // --- Preview Modal ---
  const [preview, setPreview] = useState<{ uri: string; title: string } | null>(
    null
  );

  // --- Permissions ---
  useEffect(() => {
    if (Platform.OS !== "web") {
      (async () => {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Required", "We need access to your photos.");
        }
      })();
    }
  }, []);

  // --- Live Listener for Today's Meals ---
  useEffect(() => {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
      setLoadingMeals(false);
      return;
    }

    const db = getFirestore();
    const now = new Date();
    const startTs = Timestamp.fromDate(startOfDay(now));

    const q = query(
      collection(db, "MealEntry"),
      where("userId", "==", user.uid),
      where("mealTimeClient", ">=", startTs),
      orderBy("mealTimeClient", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: MealEntry[] = [];
        snap.forEach((docSnap) => {
          const data: any = docSnap.data();
          if (data?.isWater) return; // keep existing behavior

          list.push({
            id: docSnap.id,
            mealType: data.mealType,
            category: data.category || "General",
            notes: data.notes || "",
            photoURL: data.photoURL,
            mealTimeClient: data.mealTimeClient,
            // calories removed from UI
            isWater: !!data.isWater,
            volumeMl: typeof data.volumeMl === "number" ? data.volumeMl : null,
          });
        });
        setTodayMeals(list);
        setLoadingMeals(false);
      },
      (err) => {
        console.log("Meal list error:", err);
        setLoadingMeals(false);
      }
    );

    return () => unsub();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  };

  // --- Actions ---
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });

    if (!result.canceled) setImage(result.assets[0].uri);
  };

  const addTag = (tag: string) => {
    setNotes((prev) => (prev ? `${prev}, ${tag}` : tag));
  };

  const saveMeal = async () => {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Error", "Please login first.");
      return;
    }

    if (!notes.trim() && !image) {
      Alert.alert("Empty Entry", "Please add some notes or a photo.");
      return;
    }

    setSaving(true);
    const db = getFirestore();
    const storage = getStorage();
    let photoURL: string | null = null;

    try {
      if (image) {
        const resp = await fetch(image);
        const blob = await resp.blob();
        const fileName = `meals/${user.uid}/${Date.now()}.jpg`;
        const storageRef = ref(storage, fileName);
        const snap = await uploadBytes(storageRef, blob);
        photoURL = await getDownloadURL(snap.ref);
      }

      const now = new Date();
      await addDoc(collection(db, "MealEntry"), {
        userId: user.uid,
        mealType,
        category: "home-cooked", // keep existing behavior
        notes: notes.trim(),
        photoURL,
        isWater: false,
        volumeMl: null,
        mealTimeClient: Timestamp.fromDate(now),
        createdAtClient: Timestamp.fromDate(now),
        mealTime: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      setImage(null);
      setNotes("");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (id: string) => {
    Alert.alert("Delete Entry?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const db = getFirestore();
            await deleteDoc(doc(db, "MealEntry", id));
          } catch {
            Alert.alert("Error", "Could not delete.");
          }
        },
      },
    ]);
  };

  const formatTime = (ts?: any) => {
    if (!ts?.toDate) return "";
    return ts
      .toDate()
      .toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  };

  const activeColor =
    MEAL_TYPES.find((m) => m.value === mealType)?.color || FITNESS_COLOR;

  const IconBubble = ({ icon, color }: { icon: any; color: string }) => (
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
      <Ionicons name={icon} size={18} color={color} />
    </View>
  );

  const renderTimelineItem = ({
    item,
    index,
  }: {
    item: MealEntry;
    index: number;
  }) => {
    const meta = MEAL_TYPES.find((m) => m.value === item.mealType);
    const color = meta?.color || "#9CA3AF";
    const isLast = index === todayMeals.length - 1;

    return (
      <View style={styles.timelineRow}>
        <View style={styles.timelineLeft}>
          <Text
            numberOfLines={1}
            style={StyleSheet.flatten([styles.timeText, { color: dimText2 }])}
          >
            {formatTime(item.mealTimeClient)}
          </Text>

          <View
            style={[
              styles.timelineDot,
              { backgroundColor: color, borderColor: cardBg },
            ]}
          />
          {!isLast && (
            <View
              style={[
                styles.timelineLine,
                {
                  backgroundColor: isDarkmode
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(0,0,0,0.08)",
                },
              ]}
            />
          )}
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => confirmDelete(item.id)}
          style={[
            styles.timelineCard,
            {
              backgroundColor: cardBg,
              borderColor,
              borderLeftColor: color,
            },
          ]}
        >
          <View style={styles.cardContent}>
            <View style={{ flex: 1 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <Text
                  fontWeight="bold"
                  style={{ textTransform: "capitalize", color, marginRight: 8 }}
                >
                  {item.mealType}
                </Text>

                {/* ✅ Change #1: calories UI removed */}
              </View>

              <Text
                style={{
                  opacity: item.notes ? 0.9 : 0.6,
                  fontSize: 14,
                  color: isDarkmode ? "#fff" : "#111827",
                }}
              >
                {item.notes || "No description"}
              </Text>
            </View>

            {item.photoURL && (
              <TouchableOpacity
                onPress={() =>
                  setPreview({
                    uri: item.photoURL!,
                    title: item.notes || "Meal Photo",
                  })
                }
                activeOpacity={0.9}
              >
                <Image
                  source={{ uri: item.photoURL }}
                  style={styles.thumbnail}
                />
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      <Layout>
        <TopNav
          middleContent="Log Meal"
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

        <ScrollView
          style={{ flex: 1, backgroundColor: bg }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* Header */}
          <View style={{ padding: 14 }}>
            <Text style={{ fontSize: 24, fontWeight: "900" }}>
              What did you eat?
            </Text>
            <Text style={{ marginTop: 6, color: dimText, fontSize: 13 }}>
              Keep it simple: photo + short notes.
            </Text>
          </View>

          {/* Meal Type Selector */}
          <View style={{ paddingHorizontal: 14 }}>
            <View
              style={[styles.card, { backgroundColor: cardBg, borderColor }]}
            >
              <View style={styles.cardHeaderRow}>
                <View
                  style={
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    } as any
                  }
                >
                  <IconBubble icon="fast-food" color={activeColor} />
                  <View>
                    <Text style={{ fontWeight: "900" }}>Meal type</Text>
                    <Text
                      style={{ fontSize: 12, color: dimText, marginTop: 2 }}
                    >
                      Tap to select
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.gridContainer}>
                {MEAL_TYPES.map((m) => {
                  const active = mealType === m.value;
                  return (
                    <TouchableOpacity
                      key={m.value}
                      onPress={() => setMealType(m.value)}
                      activeOpacity={0.9}
                      style={[
                        styles.gridButton,
                        {
                          borderColor: active ? m.color : borderColor,
                          backgroundColor: active
                            ? isDarkmode
                              ? "rgba(255,255,255,0.04)"
                              : "rgba(0,0,0,0.03)"
                            : isDarkmode
                            ? "rgba(255,255,255,0.02)"
                            : "rgba(0,0,0,0.02)",
                        },
                      ]}
                    >
                      <Ionicons
                        name={m.icon as any}
                        size={22}
                        color={active ? m.color : dimText2}
                      />
                      <Text
                        style={{
                          marginTop: 8,
                          color: active ? m.color : dimText,
                          fontWeight: "900",
                          fontSize: 12,
                        }}
                      >
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Form */}
          <View style={{ paddingHorizontal: 14, marginTop: 12 }}>
            <View
              style={[styles.card, { backgroundColor: cardBg, borderColor }]}
            >
              <View style={styles.cardHeaderRow}>
                <View
                  style={
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    } as any
                  }
                >
                  <IconBubble icon="create" color={activeColor} />
                  <View>
                    <Text style={{ fontWeight: "900" }}>Log entry</Text>
                    <Text
                      style={{ fontSize: 12, color: dimText, marginTop: 2 }}
                    >
                      Notes + optional photo
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 12 } as any}>
                <TouchableOpacity
                  onPress={pickImage}
                  activeOpacity={0.9}
                  style={[
                    styles.photoBox,
                    {
                      borderColor: activeColor,
                      backgroundColor: isDarkmode
                        ? "rgba(255,255,255,0.03)"
                        : "rgba(0,0,0,0.02)",
                    },
                  ]}
                >
                  {image ? (
                    <Image
                      source={{ uri: image }}
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <View style={{ alignItems: "center" }}>
                      <Ionicons name="camera" size={22} color={activeColor} />
                      <Text
                        style={{
                          fontSize: 10,
                          color: activeColor,
                          marginTop: 6,
                          fontWeight: "900",
                        }}
                      >
                        ADD PHOTO
                      </Text>
                    </View>
                  )}

                  {image && (
                    <TouchableOpacity
                      onPress={() => setImage(null)}
                      style={[
                        styles.removePhotoBtn,
                        {
                          backgroundColor: isDarkmode
                            ? "rgba(0,0,0,0.6)"
                            : "rgba(0,0,0,0.55)",
                        },
                      ]}
                      activeOpacity={0.9}
                    >
                      <Ionicons name="close" color="#fff" size={12} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>

                <View style={{ flex: 1, gap: 10 } as any}>
                  <TextInput
                    placeholder="What's on your plate?"
                    value={notes}
                    onChangeText={setNotes}
                    multiline={false}
                  />
                </View>
              </View>

              {/* Quick Tags */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 12 }}
              >
                {QUICK_TAGS.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => addTag(tag)}
                    activeOpacity={0.9}
                    style={[
                      styles.tagChip,
                      {
                        backgroundColor: isDarkmode
                          ? "rgba(255,255,255,0.03)"
                          : "rgba(0,0,0,0.03)",
                        borderColor: isDarkmode
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(0,0,0,0.08)",
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: dimText,
                        fontWeight: "800",
                      }}
                    >
                      + {tag}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Button
                text={saving ? "Saving..." : "Log Meal"}
                onPress={saveMeal}
                style={{ marginTop: 16 }}
                disabled={saving}
                color={activeColor}
                rightContent={
                  saving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons name="arrow-forward" color="#fff" />
                  )
                }
              />
            </View>
          </View>

          {/* History */}
          <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
            <View
              style={[styles.card, { backgroundColor: cardBg, borderColor }]}
            >
              <View style={[styles.cardHeaderRow, { marginBottom: 10 }]}>
                <View
                  style={
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    } as any
                  }
                >
                  <IconBubble icon="time" color={FITNESS_COLOR} />
                  <View>
                    <Text style={{ fontWeight: "900" }}>Today’s History</Text>
                    <Text
                      style={{ fontSize: 12, color: dimText, marginTop: 2 }}
                    >
                      Long press to delete
                    </Text>
                  </View>
                </View>

                {/* ✅ Change #1: total calories badge removed */}
              </View>

              {loadingMeals ? (
                <ActivityIndicator size="small" style={{ marginTop: 12 }} />
              ) : todayMeals.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons
                    name="fast-food-outline"
                    size={48}
                    color={
                      isDarkmode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"
                    }
                  />
                  <Text style={{ marginTop: 10, color: dimText }}>
                    No meals logged yet today.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={todayMeals}
                  keyExtractor={(item) => item.id}
                  renderItem={renderTimelineItem}
                  scrollEnabled={false}
                />
              )}
            </View>
          </View>
        </ScrollView>

        {/* Image Preview Modal */}
        <Modal
          visible={!!preview}
          transparent
          animationType="fade"
          onRequestClose={() => setPreview(null)}
        >
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.modalCard,
                { backgroundColor: cardBg, borderColor },
              ]}
            >
              <View
                style={[
                  styles.modalHeader,
                  {
                    borderBottomColor: isDarkmode
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(0,0,0,0.08)",
                  },
                ]}
              >
                <Text fontWeight="bold" style={{ flex: 1 }}>
                  {preview?.title || "Preview"}
                </Text>
                <TouchableOpacity
                  onPress={() => setPreview(null)}
                  activeOpacity={0.9}
                >
                  <Ionicons name="close" size={22} color={dimText2} />
                </TouchableOpacity>
              </View>

              {preview?.uri && (
                <Image
                  source={{ uri: preview.uri }}
                  style={styles.previewImage}
                />
              )}
            </View>
          </View>
        </Modal>
      </Layout>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  } as any,
  gridButton: {
    width: "48%",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },

  photoBox: {
    width: 86,
    height: 86,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  removePhotoBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    borderRadius: 999,
    padding: 4,
  },

  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    marginRight: 8,
    borderWidth: 1,
  },

  // Timeline
  timelineRow: { flexDirection: "row", minHeight: 84 },
  timelineLeft: { width: 54, alignItems: "center", marginRight: 10 },
  // ✅ Change #2: smaller font to avoid wrapping
  timeText: {
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 6,
    textAlign: "center",
  },

  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    zIndex: 2,
    borderWidth: 2,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    marginTop: -2,
  },
  timelineCard: {
    flex: 1,
    borderRadius: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderLeftWidth: 4,
    overflow: "hidden",
  },
  cardContent: {
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  } as any,
  thumbnail: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.08)",
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: 22,
    opacity: 0.95,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    width: "100%",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
  },
  previewImage: { width: "100%", height: 360, resizeMode: "cover" },
});
