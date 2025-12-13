import React, { useEffect, useRef, useState } from "react";
import {
  View,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
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
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  doc,
  setDoc,
} from "firebase/firestore";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryChat">;

interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  createdAt?: any;
}

function buildChatId(a: string, b: string) {
  return [a, b].sort().join("_");
}

export default function MemoryChat({ route, navigation }: Props) {
  const { peerId, peerName } = route.params;
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const firestore = getFirestore();

  const currentUser = auth.currentUser;
  const meId = currentUser?.uid || "";

  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");

  const flatListRef = useRef<FlatList<ChatMessage> | null>(null);

  useEffect(() => {
    if (!meId) return;

    const id = buildChatId(meId, peerId);
    setChatId(id);

    const q = query(
      collection(firestore, "chats", id, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const arr: ChatMessage[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setMessages(arr);

      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    });

    return () => unsub();
  }, [meId, peerId, firestore]);

  const handleSend = async () => {
    if (!meId || !chatId) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    setText("");

    const chatDocRef = doc(firestore, "chats", chatId);

    // 1) add message
    await addDoc(collection(chatDocRef, "messages"), {
      text: trimmed,
      senderId: meId,
      createdAt: serverTimestamp(),
    });

    // 2) upsert chat meta
    await setDoc(
      chatDocRef,
      {
        participants: [meId, peerId].sort(),
        lastMessage: trimmed,
        lastSenderId: meId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // 3) ✅ create notification doc for receiver
    await addDoc(collection(firestore, "notifications", peerId, "items"), {
      type: "message",
      text: trimmed,
      fromUid: meId,
      chatId,
      read: false,
      createdAt: serverTimestamp(),
    });
  };

  const primary = isDarkmode ? themeColor.white100 : themeColor.dark;
  const bubbleMeBg = themeColor.info;
  const bubbleOtherBg = isDarkmode ? "#333" : "#e5e7eb";

  return (
    <Layout>
      <TopNav
        middleContent={<Text>{peerName}</Text>}
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <FlatList
          ref={flatListRef}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isMe = item.senderId === meId;
            return (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: isMe ? "flex-end" : "flex-start",
                  marginBottom: 8,
                }}
              >
                <View
                  style={{
                    maxWidth: "75%",
                    borderRadius: 16,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    backgroundColor: isMe ? bubbleMeBg : bubbleOtherBg,
                  }}
                >
                  <Text
                    style={{
                      color: isMe ? "#fff" : primary,
                      fontSize: 13,
                    }}
                  >
                    {item.text}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderTopWidth: 0.3,
            borderTopColor: isDarkmode ? "#333" : "#e5e7eb",
          }}
        >
          <View
            style={{
              flex: 1,
              marginRight: 8,
              borderRadius: 999,
              borderWidth: 0.5,
              borderColor: isDarkmode ? "#555" : "#ccc",
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}
          >
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type a message..."
              placeholderTextColor={isDarkmode ? "#888" : "#999"}
              style={{
                color: primary,
                fontSize: 14,
              }}
            />
          </View>

          <Button
            text="Send"
            size="sm"
            onPress={handleSend}
            disabled={!text.trim()}
          />
        </View>
      </KeyboardAvoidingView>
    </Layout>
  );
}
