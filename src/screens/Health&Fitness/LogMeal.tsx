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
  Section,
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
};

const FITNESS_COLOR = "#22C55E";

const MEAL_TYPES = [
  { label: "Breakfast", value: "breakfast", icon: "sunny", color: "#F59E0B" },
  { label: "Lunch", value: "lunch", icon: "restaurant", color: "#EF4444" },
  { label: "Dinner", value: "dinner", icon: "moon", color: "#6366F1" },
  { label: "Snack", value: "snack", icon: "cafe", color: "#10B981" },
] as const;

// Common food items for quick tagging
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
  const [saving, setSaving] = useState(false);

  // --- Data State ---
  const [todayMeals, setTodayMeals] = useState<MealEntry[]>([]);
  const [loadingMeals, setLoadingMeals] = useState(true);

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

    // Listen for real-time updates
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
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            mealType: data.mealType,
            category: data.category || "General",
            notes: data.notes,
            photoURL: data.photoURL,
            mealTimeClient: data.mealTimeClient,
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
      quality: 0.8, // Compress slightly for speed
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

    setSaving(true);
    const db = getFirestore();
    const storage = getStorage();
    let photoURL: string | null = null;

    try {
      // 1. Upload Image if exists
      if (image) {
        const resp = await fetch(image);
        const blob = await resp.blob();
        const fileName = `meals/${user.uid}/${Date.now()}.jpg`;
        const storageRef = ref(storage, fileName);
        const snap = await uploadBytes(storageRef, blob);
        photoURL = await getDownloadURL(snap.ref);
      }

      // 2. Save Document
      const now = new Date();
      await addDoc(collection(db, "MealEntry"), {
        userId: user.uid,
        mealType,
        category: "home-cooked", // Defaulting for simplicity, or add selector if needed
        notes: notes.trim(),
        photoURL,
        mealTimeClient: Timestamp.fromDate(now),
        createdAtClient: Timestamp.fromDate(now),
        mealTime: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      // 3. Reset Form
      setImage(null);
      setNotes("");
      Alert.alert("Saved", "Meal entry added to your log.");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSaving(false);
    }
  };

  // --- Render Helpers ---
  const formatTime = (ts?: any) => {
    if (!ts?.toDate) return "";
    return ts
      .toDate()
      .toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  };

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
        {/* Left Column: Time & Line */}
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

        {/* Right Column: Card */}
        <View
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
              {item.notes ? (
                <Text style={{ marginTop: 4, opacity: 0.8, fontSize: 13 }}>
                  {item.notes}
                </Text>
              ) : (
                <Text
                  style={{
                    marginTop: 4,
                    opacity: 0.5,
                    fontSize: 13,
                    fontStyle: "italic",
                  }}
                >
                  No notes added.
                </Text>
              )}
            </View>

            {/* Thumbnail */}
            {item.photoURL && (
              <TouchableOpacity
                onPress={() => Alert.alert("Photo", item.notes || "Meal Photo")}
              >
                <Image
                  source={{ uri: item.photoURL }}
                  style={styles.thumbnail}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
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

        <View style={styles.container}>
          {/* --- SECTION 1: VISUAL SELECTOR --- */}
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
          </View>

          {/* --- SECTION 2: INPUT & TAGS --- */}
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

            {/* Horizontal Tags Scroll */}
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

            {/* Photo Button */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginTop: 12,
                justifyContent: "space-between",
              }}
            >
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

          {/* --- SECTION 3: TIMELINE --- */}
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
                <Text style={{ marginTop: 8 }}>No meals logged today yet.</Text>
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
    width: "48%", // Approx 2 columns
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
  },
  divider: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 16,
    opacity: 0.5,
  },

  // Timeline Styles
  timelineRow: {
    flexDirection: "row",
    marginBottom: 0,
    minHeight: 70,
  },
  timelineLeft: {
    width: 60,
    alignItems: "center",
    marginRight: 10,
  },
  timeText: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 4,
    opacity: 0.7,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    zIndex: 2,
  },
  timelineLine: {
    width: 2,
    backgroundColor: "#e5e7eb",
    flex: 1, // Stretches to fill gap
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
});
