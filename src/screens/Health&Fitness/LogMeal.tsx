// app/modules/fitness/MealLogAdd.tsx
import React, { useState, useEffect } from "react";
import {
  View,
  Platform,
  KeyboardAvoidingView,
  Image,
  StyleSheet,
  FlatList,
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
  mealTime?: any;
};

const MEAL_TYPES = [
  { label: "Breakfast", value: "breakfast", icon: "sunny" },
  { label: "Lunch", value: "lunch", icon: "restaurant" },
  { label: "Dinner", value: "dinner", icon: "moon" },
  { label: "Snack", value: "snack", icon: "fast-food" },
];

const CATEGORIES = [
  { label: "Home-cooked", value: "home-cooked" },
  { label: "Restaurant", value: "restaurant" },
  { label: "Fast food", value: "fast-food" },
  { label: "Beverage / Dessert", value: "beverage" },
];

export default function MealLogAddScreen({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();

  const [image, setImage] = useState<string | null>(null);
  const [mealType, setMealType] = useState("breakfast");
  const [category, setCategory] = useState("home-cooked");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [todayMeals, setTodayMeals] = useState<MealEntry[]>([]);
  const [loadingMeals, setLoadingMeals] = useState(true);

  // Ask for gallery permission once
  useEffect(() => {
    if (Platform.OS === "web") return;
    (async () => {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        alert("Permission to access gallery is required for meal photos.");
      }
    })();
  }, []);

  // Listen to today's meals for current user
  useEffect(() => {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
      setLoadingMeals(false);
      return;
    }

    const db = getFirestore();
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    );
    const startTs = Timestamp.fromDate(startOfDay);

    const q = query(
      collection(db, "MealEntry"),
      where("userId", "==", user.uid),
      where("mealTime", ">=", startTs),
      orderBy("mealTime", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: MealEntry[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as any;
          list.push({
            id: docSnap.id,
            mealType: data.mealType,
            category: data.category,
            notes: data.notes,
            photoURL: data.photoURL,
            mealTime: data.mealTime,
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

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
  };

  const saveMeal = async () => {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
      alert("Please login first.");
      return;
    }

    if (!notes.trim() && !image) {
      alert("Please enter some notes or attach a photo.");
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
        const fileName =
          "meal_" + Date.now().toString(16) + "_" + Math.random().toString(16);
        const storageRef = ref(storage, "MealEntries/" + fileName);
        const snap = await uploadBytes(storageRef, blob);
        photoURL = await getDownloadURL(snap.ref);
      }

      await addDoc(collection(db, "MealEntry"), {
        userId: user.uid,
        mealType,
        category,
        notes: notes.trim(),
        photoURL,
        mealTime: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      // Reset form but stay on page
      setImage(null);
      setNotes("");
      setMealType("breakfast");
      setCategory("home-cooked");
      alert("Meal entry saved.");
    } catch (err: any) {
      alert("Error saving meal: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (ts?: any) => {
    if (!ts || !ts.toDate) return "-";
    const d: Date = ts.toDate();
    return d.toLocaleTimeString("en-MY", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderMealItem = ({ item }: { item: MealEntry }) => {
    const mealMeta = MEAL_TYPES.find((m) => m.value === item.mealType);
    return (
      <View
        style={[
          styles.mealCard,
          {
            backgroundColor: isDarkmode ? "#111827" : "#f9fafb",
            borderColor: isDarkmode ? "#1f2937" : "#e5e7eb",
          },
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View
            style={[
              styles.mealIcon,
              { backgroundColor: isDarkmode ? "#1f2937" : "#eef2ff" },
            ]}
          >
            <Ionicons
              name={(mealMeta?.icon as any) || "fast-food"}
              size={18}
              color={themeColor.primary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text fontWeight="bold">
              {mealMeta?.label || item.mealType} · {item.category}
            </Text>
            <Text style={{ fontSize: 11, opacity: 0.7 }}>
              {formatTime(item.mealTime)}
            </Text>
          </View>
          {item.photoURL ? (
            <Image
              source={{ uri: item.photoURL }}
              style={{ width: 40, height: 40, borderRadius: 8, marginLeft: 8 }}
            />
          ) : null}
        </View>
        {item.notes ? (
          <Text style={{ marginTop: 4, fontSize: 12 }}>{item.notes}</Text>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
      <Layout>
        <TopNav
          middleContent="Log Meal Entry"
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
          {/* New meal form */}
          <View style={styles.section}>
            <Text size="h4" fontWeight="bold">
              Add a new meal
            </Text>

            {/* Meal type chips */}
            <Text style={{ marginTop: 12, fontWeight: "600" }}>Meal type</Text>
            <View style={styles.chipRow}>
              {MEAL_TYPES.map((m) => {
                const active = mealType === m.value;
                return (
                  <Button
                    key={m.value}
                    text={m.label}
                    leftContent={
                      <Ionicons
                        name={m.icon as any}
                        size={16}
                        color={active ? "#fff" : themeColor.primary}
                      />
                    }
                    outline={!active}
                    style={styles.chipButton}
                    textStyle={{
                      fontSize: 12,
                    }}
                    onPress={() => setMealType(m.value)}
                  />
                );
              })}
            </View>

            {/* Category chips */}
            <Text style={{ marginTop: 12, fontWeight: "600" }}>Category</Text>
            <View style={styles.chipRow}>
              {CATEGORIES.map((c) => {
                const active = category === c.value;
                return (
                  <Button
                    key={c.value}
                    text={c.label}
                    outline={!active}
                    style={styles.chipButton}
                    textStyle={{ fontSize: 12 }}
                    onPress={() => setCategory(c.value)}
                  />
                );
              })}
            </View>

            {/* Notes */}
            <Text style={{ marginTop: 12, fontWeight: "600" }}>Notes</Text>
            <TextInput
              containerStyle={{ marginTop: 8 }}
              placeholder="e.g. Nasi lemak with fried chicken, shared drink"
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            {/* Photo */}
            <View style={{ marginTop: 12 }}>
              <Button text="Attach photo (optional)" onPress={pickImage} />
              {image && (
                <Image
                  source={{ uri: image }}
                  style={styles.previewImage}
                  resizeMode="cover"
                />
              )}
            </View>

            <Button
              text={saving ? "Saving..." : "Save Meal"}
              onPress={saveMeal}
              style={{ marginTop: 16 }}
              disabled={saving}
            />
          </View>

          {/* Divider */}
          <View
            style={{ height: 1, backgroundColor: "#e5e7eb", marginVertical: 8 }}
          />

          {/* Today history */}
          <View style={styles.section}>
            <Text size="h4" fontWeight="bold">
              Today&apos;s meals ({todayMeals.length})
            </Text>
            {loadingMeals ? (
              <Text style={{ marginTop: 8, opacity: 0.7 }}>
                Loading your meals...
              </Text>
            ) : todayMeals.length === 0 ? (
              <Text style={{ marginTop: 8, opacity: 0.7 }}>
                No meals logged yet today. Start by adding one above.
              </Text>
            ) : (
              <FlatList
                style={{ marginTop: 8 }}
                data={todayMeals}
                keyExtractor={(item) => item.id}
                renderItem={renderMealItem}
              />
            )}
          </View>
        </View>
      </Layout>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  section: {
    marginTop: 12,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  chipButton: {
    marginRight: 6,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    height: 32,
    borderRadius: 999,
  },
  previewImage: {
    width: "100%",
    height: 150,
    borderRadius: 12,
    marginTop: 8,
  },
  mealCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  mealIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
});
