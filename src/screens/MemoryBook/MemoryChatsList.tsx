// src/screens/MemoryBook/MemoryChatsList.tsx
import React, { useEffect, useState } from "react";
import { View, TouchableOpacity, FlatList, Image } from "react-native";
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
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
} from "firebase/firestore";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryChatsList">;

interface ChatMeta {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastSenderId?: string;
  updatedAt?: any;
}

interface UserDoc {
  id: string;
  displayName?: string;
  email?: string;
  photoURL?: string; // ✅ from users/{uid}.photoURL
}

export default function MemoryChatsList({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const firestore = getFirestore();
  const currentUser = auth.currentUser;

  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, UserDoc>>({});

  // ---- load all users for name / photo display ----
  useEffect(() => {
    const unsub = onSnapshot(collection(firestore, "users"), (snap) => {
      const map: Record<string, UserDoc> = {};
      snap.forEach((d) => {
        map[d.id] = { id: d.id, ...(d.data() as any) };
      });
      setUsersMap(map);
    });
    return () => unsub();
  }, [firestore]);

  // ---- load all chats for current user ----
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(firestore, "chats"),
      where("participants", "array-contains", currentUser.uid),
      orderBy("updatedAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const arr: ChatMeta[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setChats(arr);
    });

    return () => unsub();
  }, [firestore, currentUser]);

  const primary = isDarkmode ? themeColor.white100 : themeColor.dark;
  const secondary = isDarkmode ? "#aaa" : "#555";

  const renderAvatar = (photoURL?: string) => {
    const ok = !!photoURL && photoURL !== "-" && photoURL.startsWith("http");
    if (!ok) {
      return (
        <Ionicons
          name="person-circle-outline"
          size={42}
          color={themeColor.info}
        />
      );
    }

    return (
      <Image
        source={{ uri: photoURL }}
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          borderWidth: 1,
          borderColor: isDarkmode ? "#333" : "#e5e7eb",
          backgroundColor: isDarkmode ? "#111" : "#f3f4f6",
        }}
      />
    );
  };

  const renderItem = ({ item }: { item: ChatMeta }) => {
    if (!currentUser) return null;

    const otherId =
      item.participants.find((p) => p !== currentUser.uid) || currentUser.uid;

    const otherUser = usersMap[otherId];
    const name = otherUser?.displayName || otherUser?.email || "Unknown user";

    const lastMsg =
      item.lastMessage && item.lastMessage.length > 80
        ? item.lastMessage.slice(0, 80) + "..."
        : item.lastMessage || "Say hi 👋";

    return (
      <TouchableOpacity
        onPress={() =>
          navigation.navigate("MemoryChat", {
            peerId: otherId,
            peerName: name,
          })
        }
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderBottomWidth: 0.3,
          borderBottomColor: isDarkmode ? "#333" : "#e5e7eb",
        }}
      >
        {renderAvatar(otherUser?.photoURL)}

        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "bold",
              color: primary,
            }}
            numberOfLines={1}
          >
            {name}
          </Text>

          <Text
            style={{
              marginTop: 2,
              fontSize: 12,
              color: secondary,
            }}
            numberOfLines={1}
          >
            {lastMsg}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Layout>
      <TopNav
        middleContent={<Text>Messages</Text>}
        leftContent={
          <Ionicons
            name="chevron-back"
            size={22}
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

      <View style={{ flex: 1 }}>
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                marginTop: 40,
              }}
            >
              <Text style={{ color: secondary }}>
                No messages yet. Start a chat from Search 👉
              </Text>
            </View>
          }
        />
      </View>
    </Layout>
  );
}
