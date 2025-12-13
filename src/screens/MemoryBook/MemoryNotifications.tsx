// src/screens/MemoryBook/MemoryNotifications.tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, TouchableOpacity, ScrollView } from "react-native";
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
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  doc,
  writeBatch,
} from "firebase/firestore";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryNotifications">;

type NotiItem = {
  id: string;
  type?: "message" | "follow" | "mood" | string;
  text?: string;
  fromUid?: string;
  chatId?: string;
  read?: boolean;
  createdAt?: any;
};

export default function MemoryNotifications({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const firestore = getFirestore();
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || "";

  const [items, setItems] = useState<NotiItem[]>([]);

  const textColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const cardBg = isDarkmode ? themeColor.dark100 : "#eef2f7";

  useEffect(() => {
    if (!uid) return;

    const qNoti = query(
      collection(firestore, "notifications", uid, "items"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(qNoti, (snap) => {
      const list: NotiItem[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...(d.data() as any) });
      });
      setItems(list);
    });

    return () => unsub();
  }, [uid, firestore]);

  const unreadCount = useMemo(
    () => items.filter((x) => x.read === false).length,
    [items]
  );

  const iconForType = (type?: string) => {
    switch (type) {
      case "message":
        return "chatbubble-ellipses-outline";
      case "follow":
        return "person-add-outline";
      case "mood":
        return "happy-outline";
      default:
        return "notifications-outline";
    }
  };

  const openNoti = async (n: NotiItem) => {
    if (!uid) return;

    // mark read
    try {
      if (n.read === false) {
        await updateDoc(doc(firestore, "notifications", uid, "items", n.id), {
          read: true,
        });
      }
    } catch (e) {
      console.log("Failed to mark read:", e);
    }

    // basic navigation by type (customize as you want)
    if (n.type === "mood") {
      navigation.navigate("MemoryMoodCalendar");
      return;
    }

    if (n.type === "message" && n.chatId) {
      // If your chat screen route is different, change it here
      navigation.navigate("MemoryChat" as any, { chatId: n.chatId } as any);
      return;
    }
  };

  const markAllRead = async () => {
    if (!uid) return;

    try {
      const batch = writeBatch(firestore);
      items.forEach((n) => {
        if (n.read === false) {
          batch.update(doc(firestore, "notifications", uid, "items", n.id), {
            read: true,
          });
        }
      });
      await batch.commit();
    } catch (e) {
      console.log("Failed to mark all read:", e);
    }
  };

  if (!currentUser) {
    return (
      <Layout>
        <TopNav
          middleContent={<Text>Notifications</Text>}
          leftContent={
            <Ionicons
              name="chevron-back"
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
            />
          }
          leftAction={() => navigation.goBack()}
        />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text>Please sign in.</Text>
        </View>
      </Layout>
    );
  }

  return (
    <Layout>
      <TopNav
        middleContent={
          <Text>
            Notifications{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </Text>
        }
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

      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Button
          text="Mark all as read"
          onPress={markAllRead}
          size="sm"
          status="primary"
          disabled={unreadCount === 0}
        />
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={{ padding: 16 }}>
          {items.length === 0 ? (
            <Text style={{ color: textColor, opacity: 0.8 }}>
              No notifications yet.
            </Text>
          ) : (
            items.map((n) => (
              <TouchableOpacity
                key={n.id}
                onPress={() => openNoti(n)}
                style={{
                  backgroundColor: cardBg,
                  borderRadius: 14,
                  padding: 12,
                  marginBottom: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  opacity: n.read ? 0.75 : 1,
                }}
              >
                <Ionicons
                  name={iconForType(n.type) as any}
                  size={20}
                  color={textColor}
                  style={{ marginRight: 10 }}
                />

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: textColor,
                      fontWeight: n.read ? "normal" : "bold",
                    }}
                  >
                    {n.text || "Notification"}
                  </Text>
                  {n.read === false && (
                    <Text style={{ color: themeColor.danger, fontSize: 11 }}>
                      Unread
                    </Text>
                  )}
                </View>

                {n.read === false && (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      backgroundColor: themeColor.danger,
                    }}
                  />
                )}
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </Layout>
  );
}
