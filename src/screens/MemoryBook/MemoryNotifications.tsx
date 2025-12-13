// src/screens/MemoryBook/MemoryNotifications.tsx
import React, { useEffect, useState } from "react";
import { View, TouchableOpacity, FlatList } from "react-native";
import { Layout, TopNav, Text, useTheme, themeColor } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
} from "firebase/firestore";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryNotifications">;

type NotifItem = {
  id: string;
  type?: "message" | "follow" | string;
  text?: string;
  fromUid?: string;
  chatId?: string;
  read?: boolean;
  createdAt?: any;
};

export default function MemoryNotifications({ navigation }: Props) {
  const { isDarkmode } = useTheme();
  const auth = getAuth();
  const firestore = getFirestore();
  const [items, setItems] = useState<NotifItem[]>([]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setItems([]);
      return;
    }

    const q = query(
      collection(firestore, "notifications", uid, "items"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, async (snap) => {
      const arr: NotifItem[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setItems(arr);

      // ✅ mark all unread as read (so bell red dot disappears)
      for (const d of snap.docs) {
        const data: any = d.data();
        if (data?.read === false) {
          await updateDoc(
            doc(firestore, "notifications", uid, "items", d.id),
            { read: true }
          );
        }
      }
    });

    return () => unsub();
  }, []);

  const primaryTextColor = isDarkmode ? themeColor.white100 : themeColor.dark;

  const renderRow = ({ item }: { item: NotifItem }) => {
    const iconName =
      item.type === "message"
        ? "chatbubble-ellipses-outline"
        : item.type === "follow"
        ? "person-add-outline"
        : "notifications-outline";

    return (
      <TouchableOpacity
        style={{
          padding: 14,
          borderBottomWidth: 1,
          borderColor: isDarkmode ? "#222" : "#eee",
          flexDirection: "row",
          alignItems: "center",
        }}
        activeOpacity={0.8}
      >
        <Ionicons
          name={iconName as any}
          size={18}
          color={isDarkmode ? themeColor.white100 : themeColor.dark}
          style={{ marginRight: 10 }}
        />

        <View style={{ flex: 1 }}>
          <Text style={{ color: primaryTextColor }}>
            {item.text || "New notification"}
          </Text>
          <Text style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
            {item.type || "notification"}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Layout>
      <TopNav
        middleContent="Notifications"
        leftContent={
          <Ionicons
            name="chevron-back"
            size={22}
            color={isDarkmode ? themeColor.white : themeColor.dark}
          />
        }
        leftAction={() => navigation.goBack()}
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        ListEmptyComponent={
          <View style={{ padding: 18 }}>
            <Text style={{ color: isDarkmode ? "#aaa" : "#666" }}>
              No notifications yet.
            </Text>
          </View>
        }
      />
    </Layout>
  );
}
