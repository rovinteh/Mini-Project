// src/screens/MyModule/MemoryComments.tsx
import React, { useEffect, useState } from "react";
import { View, FlatList } from "react-native";
import {
  Layout,
  TopNav,
  Text,
  Section,
  SectionContent,
  TextInput,
  Button,
  useTheme,
  themeColor,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryComments">;

interface Comment {
  id: string;
  text: string;
  userId: string;
  username?: string;
  createdAt?: any;
}

export default function MemoryComments({ route, navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const { postId } = route.params;
  const firestore = getFirestore();
  const auth = getAuth();

  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    const q = query(
      collection(firestore, "posts", postId, "comments"),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const arr: Comment[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as any;
        arr.push({
          id: docSnap.id,
          text: d.text,
          userId: d.userId,
          username: d.username || "User",
          createdAt: d.createdAt,
        });
      });
      setComments(arr);
    });

    return () => unsub();
  }, [postId]);

  const handleSend = async () => {
    const user = auth.currentUser;
    if (!user || !text.trim()) return;

    await addDoc(collection(firestore, "posts", postId, "comments"), {
      userId: user.uid,
      username: user.displayName || "User",
      text: text.trim(),
      createdAt: serverTimestamp(),
    });

    setText("");
  };

  return (
    <Layout>
      <TopNav
        middleContent={<Text>{"Comments"}</Text>}
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

      <Section style={{ flex: 1 }}>
        <SectionContent>
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={{ marginBottom: 10 }}>
                <Text fontWeight="bold">{item.username || "User"}</Text>
                <Text>{item.text}</Text>
              </View>
            )}
          />
        </SectionContent>
      </Section>

      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 16,
          paddingBottom: 16,
          alignItems: "center",
        }}
      >
        <View style={{ flex: 1, marginRight: 8 }}>
          <TextInput
            placeholder="Add a comment..."
            value={text}
            onChangeText={setText}
          />
        </View>
        <Button text="Send" onPress={handleSend} disabled={!text.trim()} />
      </View>
    </Layout>
  );
}
