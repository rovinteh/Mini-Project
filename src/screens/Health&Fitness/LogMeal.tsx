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
  calories?: number | null;
  isWater?: boolean;
  volumeMl?: number | null;
};

// --- Vibrant Colors ---
const COLOR_BREAKFAST = "#F59E0B"; // Amber
const COLOR_LUNCH = "#EF4444"; // Red
const COLOR_DINNER = "#8B5CF6"; // Purple
const COLOR_SNACK = "#10B981"; // Emerald
const FITNESS_COLOR = "#22C55E"; // Generic Green

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

  // --- Form State ---
  const [image, setImage] = useState<string | null>(null);
  const [mealType, setMealType] = useState<string>("breakfast");
  const [notes, setNotes] = useState("");
  const [calories, setCalories] = useState("");
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
          if (data?.isWater) return;

          list.push({
            id: docSnap.id,
            mealType: data.mealType,
            category: data.category || "General",
            notes: data.notes || "",
            photoURL: data.photoURL,
            mealTimeClient: data.mealTimeClient,
            calories: typeof data.calories === "number" ? data.calories : null,
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
    // Data updates live, so just simulate a network wait feel
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  };

  // --- Actions ---
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
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

    const cals =
      calories.trim().length === 0 ? null : Number.parseInt(calories, 10);
    if (cals !== null && (Number.isNaN(cals) || cals < 0 || cals > 5000)) {
      Alert.alert("Invalid Calories", "Please enter a valid number.");
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
        category: "home-cooked",
        notes: notes.trim(),
        photoURL,
        calories: cals,
        isWater: false,
        volumeMl: null,
        mealTimeClient: Timestamp.fromDate(now),
        createdAtClient: Timestamp.fromDate(now),
        mealTime: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      // Reset form
      setImage(null);
      setNotes("");
      setCalories("");
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
          } catch (e) {
            Alert.alert("Error", "Could not delete.");
          }
        },
      },
    ]);
  };

  // --- Rendering ---
  const formatTime = (ts?: any) => {
    if (!ts?.toDate) return "";
    return ts
      .toDate()
      .toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  };

  const totalCalories = useMemo(() => {
    return todayMeals.reduce((sum, m) => sum + (m.calories || 0), 0);
  }, [todayMeals]);

  const activeColor =
    MEAL_TYPES.find((m) => m.value === mealType)?.color || FITNESS_COLOR;

  const renderTimelineItem = ({
    item,
    index,
  }: {
    item: MealEntry;
    index: number;
  }) => {
    const meta = MEAL_TYPES.find((m) => m.value === item.mealType);
    const color = meta?.color || "#ccc";
    const isLast = index === todayMeals.length - 1;

    return (
      <View style={styles.timelineRow}>
        {/* Left Time Column */}
        <View style={styles.timelineLeft}>
          <Text style={styles.timeText}>{formatTime(item.mealTimeClient)}</Text>
          <View style={[styles.timelineDot, { backgroundColor: color }]} />
          {!isLast && <View style={styles.timelineLine} />}
        </View>

        {/* Right Card */}
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => confirmDelete(item.id)}
          style={[
            styles.timelineCard,
            {
              backgroundColor: isDarkmode ? "#1F2937" : "#fff",
              borderColor: isDarkmode ? "#374151" : "#e5e7eb",
              borderLeftColor: color,
              borderLeftWidth: 4,
            },
          ]}
        >
          <View style={styles.cardContent}>
            <View style={{ flex: 1 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <Text
                  fontWeight="bold"
                  style={{
                    textTransform: "capitalize",
                    color: color,
                    marginRight: 8,
                  }}
                >
                  {item.mealType}
                </Text>
                {!!item.calories && (
                  <View style={styles.calBadge}>
                    <Text
                      style={{
                        fontSize: 10,
                        color: "#666",
                        fontWeight: "bold",
                      }}
                    >
                      {item.calories} kcal
                    </Text>
                  </View>
                )}
              </View>

              <Text style={{ opacity: item.notes ? 0.9 : 0.5, fontSize: 14 }}>
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
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* SECTION 1: Meal Selector */}
          <View style={{ padding: 16 }}>
            <Text size="h3" fontWeight="bold" style={{ marginBottom: 16 }}>
              What did you eat?
            </Text>

            <View style={styles.gridContainer}>
              {MEAL_TYPES.map((m) => {
                const active = mealType === m.value;
                return (
                  <TouchableOpacity
                    key={m.value}
                    onPress={() => setMealType(m.value)}
                    style={[
                      styles.gridButton,
                      {
                        backgroundColor: active
                          ? m.color
                          : isDarkmode
                          ? "#1f2937"
                          : "#fff",
                        borderColor: active
                          ? m.color
                          : isDarkmode
                          ? "#374151"
                          : "#e5e7eb",
                        shadowColor: active ? m.color : "#000",
                        shadowOpacity: active ? 0.3 : 0.05,
                      },
                    ]}
                  >
                    <Ionicons
                      name={m.icon as any}
                      size={24}
                      color={active ? "#fff" : m.color}
                    />
                    <Text
                      style={{
                        marginTop: 8,
                        color: active
                          ? "#fff"
                          : isDarkmode
                          ? "#ccc"
                          : "#4b5563",
                        fontWeight: active ? "bold" : "500",
                      }}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* SECTION 2: Form Input */}
          <View
            style={[
              styles.formSection,
              { backgroundColor: isDarkmode ? "#111827" : "#f9fafb" },
            ]}
          >
            <View style={{ flexDirection: "row", gap: 12 }}>
              {/* Photo Box */}
              <TouchableOpacity
                onPress={pickImage}
                style={[styles.photoBox, { borderColor: activeColor }]}
              >
                {image ? (
                  <Image
                    source={{ uri: image }}
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : (
                  <View style={{ alignItems: "center" }}>
                    <Ionicons name="camera" size={24} color={activeColor} />
                    <Text
                      style={{
                        fontSize: 10,
                        color: activeColor,
                        marginTop: 4,
                        fontWeight: "bold",
                      }}
                    >
                      ADD PHOTO
                    </Text>
                  </View>
                )}
                {image && (
                  <View style={styles.removePhotoBtn}>
                    <Ionicons
                      name="close"
                      color="#fff"
                      size={12}
                      onPress={() => setImage(null)}
                    />
                  </View>
                )}
              </TouchableOpacity>

              {/* Text Inputs */}
              <View style={{ flex: 1, gap: 10 }}>
                <TextInput
                  placeholder="What's on your plate?"
                  value={notes}
                  onChangeText={setNotes}
                  multiline={false}
                />
                <TextInput
                  placeholder="Calories (optional)"
                  value={calories}
                  onChangeText={setCalories}
                  keyboardType="numeric"
                  rightContent={
                    <Text
                      style={{ opacity: 0.5, marginRight: 8, fontSize: 12 }}
                    >
                      kcal
                    </Text>
                  }
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
                  style={[
                    styles.tagChip,
                    {
                      backgroundColor: isDarkmode ? "#374151" : "#fff",
                      borderColor: isDarkmode ? "#4b5563" : "#e5e7eb",
                    },
                  ]}
                >
                  <Text size="sm" style={{ opacity: 0.8 }}>
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

          {/* SECTION 3: Timeline History */}
          <View style={{ paddingHorizontal: 16, paddingTop: 24 }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <Text size="h4" fontWeight="bold">
                Today's History
              </Text>
              <View style={styles.totalBadge}>
                <Ionicons name="flame" size={14} color="#F59E0B" />
                <Text
                  style={{ fontSize: 12, fontWeight: "bold", marginLeft: 4 }}
                >
                  {totalCalories} kcal
                </Text>
              </View>
            </View>

            {loadingMeals ? (
              <ActivityIndicator size="small" style={{ marginTop: 20 }} />
            ) : todayMeals.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons
                  name="fast-food-outline"
                  size={48}
                  color={isDarkmode ? "#374151" : "#d1d5db"}
                />
                <Text style={{ marginTop: 8, opacity: 0.5 }}>
                  No meals logged yet today.
                </Text>
              </View>
            ) : (
              <FlatList
                data={todayMeals}
                keyExtractor={(item) => item.id}
                renderItem={renderTimelineItem}
                scrollEnabled={false} // Let parent ScrollView handle scrolling
              />
            )}
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
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text fontWeight="bold" style={{ flex: 1 }}>
                  {preview?.title || "Preview"}
                </Text>
                <TouchableOpacity onPress={() => setPreview(null)}>
                  <Ionicons name="close" size={24} color="#6B7280" />
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
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  gridButton: {
    width: "48%",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  formSection: {
    padding: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  photoBox: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.02)",
  },
  removePhotoBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 10,
    padding: 2,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
  },

  // Timeline Styles
  timelineRow: { flexDirection: "row", minHeight: 80 },
  timelineLeft: { width: 50, alignItems: "center", marginRight: 10 },
  timeText: { fontSize: 11, fontWeight: "bold", marginBottom: 6, opacity: 0.6 },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    zIndex: 2,
    borderWidth: 2,
    borderColor: "#fff",
  },
  timelineLine: {
    width: 2,
    backgroundColor: "#e5e7eb",
    flex: 1,
    marginTop: -2,
  },

  timelineCard: {
    flex: 1,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardContent: {
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  calBadge: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginLeft: 10,
    backgroundColor: "#eee",
  },
  totalBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
    opacity: 0.8,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    borderRadius: 16,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  previewImage: { width: "100%", height: 350, resizeMode: "cover" },
});
