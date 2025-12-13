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

  // optional fields
  calories?: number | null;
  isWater?: boolean;
  volumeMl?: number | null;
};

const FITNESS_COLOR = "#22C55E";

const MEAL_TYPES = [
  { label: "Breakfast", value: "breakfast", icon: "sunny", color: "#F59E0B" },
  { label: "Lunch", value: "lunch", icon: "restaurant", color: "#EF4444" },
  { label: "Dinner", value: "dinner", icon: "moon", color: "#6366F1" },
  { label: "Snack", value: "snack", icon: "cafe", color: "#10B981" },
] as const;

const QUICK_TAGS = [
  "Rice",
  "Chicken",
  "Noodles",
  "Egg",
  "Fish",
  "Vegetables",
  "Bread",
  "Coffee",
  "Tea",
  "Fruits",
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
  const [calories, setCalories] = useState(""); // optional
  const [saving, setSaving] = useState(false);

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
          Alert.alert(
            "Permission Required",
            "We need access to your photos to attach meal pictures."
          );
        }
      })();
    }
  }, []);

  // --- Load Today's Meals ---
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
          // Ignore water-only rows in the meal timeline (they still exist for hydration widgets)
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

  // --- Actions ---
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
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
    if (cals !== null && (Number.isNaN(cals) || cals < 0 || cals > 3000)) {
      Alert.alert("Invalid Calories", "Please enter a value between 0–3000.");
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

      setImage(null);
      setNotes("");
      setCalories("");
      Alert.alert("Saved", "Meal entry added to your log.");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (id: string) => {
    Alert.alert("Delete Entry?", "This will remove the meal log.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const db = getFirestore();
            await deleteDoc(doc(db, "MealEntry", id));
          } catch (e) {
            Alert.alert("Error", "Could not delete the entry.");
          }
        },
      },
    ]);
  };

  // --- Render Helpers ---
  const formatTime = (ts?: any) => {
    if (!ts?.toDate) return "";
    return ts
      .toDate()
      .toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  };

  const totalMeals = todayMeals.length;
  const totalCalories = useMemo(() => {
    return todayMeals.reduce((sum, m) => sum + (m.calories || 0), 0);
  }, [todayMeals]);

  const renderTimelineItem = ({
    item,
    index,
  }: {
    item: MealEntry;
    index: number;
  }) => {
    const meta = MEAL_TYPES.find((m) => m.value === item.mealType);
    const isLast = index === todayMeals.length - 1;

    return (
      <View style={styles.timelineRow}>
        <View style={styles.timelineLeft}>
          <Text style={styles.timeText}>{formatTime(item.mealTimeClient)}</Text>
          <View
            style={[
              styles.timelineDot,
              { backgroundColor: meta?.color || "#ccc" },
            ]}
          />
          {!isLast && <View style={styles.timelineLine} />}
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => confirmDelete(item.id)}
          style={[
            styles.timelineCard,
            {
              backgroundColor: isDarkmode ? "#1F2937" : "#fff",
              borderColor: isDarkmode ? "#374151" : "#e5e7eb",
            },
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                fontWeight="bold"
                style={{ textTransform: "capitalize", color: meta?.color }}
              >
                {item.mealType}
              </Text>

              {!!item.calories && (
                <Text style={{ marginTop: 2, opacity: 0.7, fontSize: 12 }}>
                  {item.calories} kcal
                </Text>
              )}

              {item.notes ? (
                <Text style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>
                  {item.notes}
                </Text>
              ) : (
                <Text
                  style={{
                    marginTop: 6,
                    opacity: 0.5,
                    fontSize: 13,
                    fontStyle: "italic",
                  }}
                >
                  No notes added.
                </Text>
              )}
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

          <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
            <View style={styles.miniPill}>
              <Ionicons name="trash-outline" size={14} color="#6B7280" />
              <Text style={styles.miniPillText}>Long-press to delete</Text>
            </View>
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
          contentContainerStyle={{ paddingBottom: 28 }}
        >
          <View style={styles.container}>
            {/* SECTION 1: selector */}
            <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
              <Text size="h4" fontWeight="bold">
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
                            : "#f9fafb",
                          borderColor: active
                            ? "transparent"
                            : isDarkmode
                            ? "#374151"
                            : "#e5e7eb",
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
                          color: active ? "#fff" : isDarkmode ? "#fff" : "#000",
                          fontWeight: active ? "bold" : "normal",
                        }}
                      >
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.summaryRow}>
                <View style={styles.summaryPill}>
                  <Ionicons name="restaurant" size={14} color={FITNESS_COLOR} />
                  <Text style={styles.summaryText}>{totalMeals} meals</Text>
                </View>
                <View style={styles.summaryPill}>
                  <Ionicons name="flame" size={14} color="#F59E0B" />
                  <Text style={styles.summaryText}>{totalCalories} kcal</Text>
                </View>
              </View>
            </View>

            {/* SECTION 2: input */}
            <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
              <Text fontWeight="bold" style={{ marginBottom: 8 }}>
                Description
              </Text>
              <TextInput
                placeholder="e.g. Nasi Lemak, Apple, Coffee..."
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={2}
              />

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontWeight: "600", marginBottom: 6, opacity: 0.8 }}
                  >
                    Calories (optional)
                  </Text>
                  <TextInput
                    placeholder="e.g. 450"
                    value={calories}
                    onChangeText={setCalories}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              {/* Tags */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 10, marginBottom: 4 }}
              >
                {QUICK_TAGS.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => addTag(tag)}
                    style={[
                      styles.tagChip,
                      { backgroundColor: isDarkmode ? "#374151" : "#eff6ff" },
                    ]}
                  >
                    <Text
                      size="sm"
                      style={{ color: isDarkmode ? "#fff" : "#2563eb" }}
                    >
                      + {tag}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Photo */}
              <View style={styles.photoRow}>
                <TouchableOpacity
                  onPress={pickImage}
                  style={{ flexDirection: "row", alignItems: "center" }}
                >
                  <Ionicons
                    name="camera"
                    size={20}
                    color={FITNESS_COLOR}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={{ color: FITNESS_COLOR, fontWeight: "600" }}>
                    {image ? "Change Photo" : "Add Photo"}
                  </Text>
                </TouchableOpacity>

                {image && (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Image
                      source={{ uri: image }}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 4,
                        marginRight: 8,
                      }}
                    />
                    <TouchableOpacity onPress={() => setImage(null)}>
                      <Ionicons name="close-circle" size={20} color="gray" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <Button
                text={saving ? "Saving..." : "Save Log"}
                onPress={saveMeal}
                style={{ marginTop: 16 }}
                disabled={saving}
                color={FITNESS_COLOR}
              />
            </View>

            <View style={styles.divider} />

            {/* SECTION 3: timeline */}
            <View style={{ flex: 1, paddingHorizontal: 16 }}>
              <Text size="h4" fontWeight="bold" style={{ marginBottom: 12 }}>
                Today's History
              </Text>

              {loadingMeals ? (
                <Text style={{ opacity: 0.6 }}>Loading history...</Text>
              ) : todayMeals.length === 0 ? (
                <View
                  style={{ alignItems: "center", marginTop: 20, opacity: 0.5 }}
                >
                  <Ionicons name="fast-food-outline" size={40} color="gray" />
                  <Text style={{ marginTop: 8 }}>
                    No meals logged today yet.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={todayMeals}
                  keyExtractor={(item) => item.id}
                  renderItem={renderTimelineItem}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 20 }}
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
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text fontWeight="bold" style={{ flex: 1 }}>
                  {preview?.title || "Preview"}
                </Text>
                <TouchableOpacity onPress={() => setPreview(null)}>
                  <Ionicons name="close" size={22} color="#6B7280" />
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
  container: { flex: 1, backgroundColor: "transparent" },
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
  },
  gridButton: {
    width: "48%",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  summaryRow: { flexDirection: "row", gap: 10, marginTop: 12 } as any,
  summaryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.04)",
  } as any,
  summaryText: { fontSize: 12, opacity: 0.8 },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    justifyContent: "space-between",
  },

  divider: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 16,
    opacity: 0.5,
  },

  // Timeline
  timelineRow: { flexDirection: "row", marginBottom: 0, minHeight: 70 },
  timelineLeft: { width: 60, alignItems: "center", marginRight: 10 },
  timeText: { fontSize: 11, fontWeight: "bold", marginBottom: 4, opacity: 0.7 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, zIndex: 2 },
  timelineLine: {
    width: 2,
    backgroundColor: "#e5e7eb",
    flex: 1,
    marginTop: -2,
  },
  timelineCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  thumbnail: {
    width: 40,
    height: 40,
    borderRadius: 6,
    marginLeft: 10,
    backgroundColor: "#eee",
  },
  miniPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(107,114,128,0.08)",
  } as any,
  miniPillText: { fontSize: 11, color: "#6B7280" },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 16,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  previewImage: { width: "100%", height: 320, resizeMode: "cover" },
});
