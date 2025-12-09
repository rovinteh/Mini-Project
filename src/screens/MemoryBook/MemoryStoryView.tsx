// src/screens/MemoryBook/MemoryStoryView.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Image,
  TouchableWithoutFeedback,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
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
import { getFirestore, doc, getDoc, deleteDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage, ref, deleteObject } from "firebase/storage";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryStoryView">;

type StoryPost = {
  id: string;
  mediaUrl: string;
  caption?: string;
  userId?: string;
  username?: string;
  isStory?: boolean;
  createdAt?: any;
  storyExpiresAt?: any;
};

export default function MemoryStoryView({ route, navigation }: Props) {
  const { postId } = route.params;
  const { isDarkmode, setTheme } = useTheme();
  const firestore = getFirestore();
  const auth = getAuth();
  const storage = getStorage();
  const currentUser = auth.currentUser;

  const [post, setPost] = useState<StoryPost | null>(null);
  const [loading, setLoading] = useState(true);

  // Load story
  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(firestore, "posts", postId));
        if (!snap.exists()) {
          Alert.alert("Story not found", "This story no longer exists.", [
            { text: "OK", onPress: () => navigation.goBack() },
          ]);
          return;
        }

        const data = snap.data() as any;
        const created = data.CreatedUser || {};

        const story: StoryPost = {
          id: snap.id,
          mediaUrl: data.mediaUrl,
          caption: data.caption,
          userId: created.CreatedUserId || data.userId,
          username: created.CreatedUserName || data.username,
          isStory: data.isStory,
          createdAt: data.createdAt,
          storyExpiresAt: data.storyExpiresAt,
        };

        const now = new Date();

        // Check if expired
        let expired = false;
        if (story.storyExpiresAt?.toDate) {
          expired = story.storyExpiresAt.toDate() <= now;
        } else if (story.createdAt?.toDate && story.isStory) {
          const createdTime = story.createdAt.toDate();
          expired =
            now.getTime() - createdTime.getTime() >= 24 * 60 * 60 * 1000;
        }

        if (story.isStory && expired) {
          Alert.alert("Story expired", "This story is no longer available.", [
            { text: "OK", onPress: () => navigation.goBack() },
          ]);
          return;
        }

        setPost(story);
      } catch (e) {
        console.log(e);
        Alert.alert("Error", "Unable to load story.", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [firestore, postId, navigation]);

  // Auto close like IG (5 seconds)
  useEffect(() => {
    if (!post) return;
    const timer = setTimeout(() => {
      navigation.goBack();
    }, 5000);

    return () => clearTimeout(timer);
  }, [post, navigation]);

  const isOwner = !!post && !!currentUser && post.userId === currentUser.uid;

  const handleDelete = async () => {
    if (!post || !isOwner) return;

    try {
      await deleteDoc(doc(firestore, "posts", post.id));

      if (post.mediaUrl) {
        try {
          const fileRef = ref(storage, post.mediaUrl);
          await deleteObject(fileRef);
        } catch (e) {
          console.log("Failed to delete image from storage", e);
        }
      }

      Alert.alert("Deleted", "Your story has been deleted.");
      navigation.goBack();
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Failed to delete story.");
    }
  };

  if (loading) {
    return (
      <Layout>
        <TopNav
          middleContent={<Text>Story</Text>}
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
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "black",
          }}
        >
          <ActivityIndicator />
        </View>
      </Layout>
    );
  }

  if (!post) return null;

  const username = post.username || "User";
  const initial = username.charAt(0).toUpperCase();
  const titleText = `${username}'s story`;

  return (
    <Layout style={{ backgroundColor: "black" }}>
      {/* Top bar styled more like a story header */}
      <TopNav
        backgroundColor="transparent"
        borderColor="transparent"
        middleContent={
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: "rgba(255,255,255,0.15)",
                justifyContent: "center",
                alignItems: "center",
                marginRight: 8,
              }}
            >
              <Text style={{ color: "white", fontWeight: "bold" }}>
                {initial}
              </Text>
            </View>
            <View>
              <Text style={{ color: "white", fontWeight: "600" }}>
                {username}
              </Text>
              <Text style={{ color: "#bbbbbb", fontSize: 11 }}>Story</Text>
            </View>
          </View>
        }
        leftContent={
          <Ionicons
            name="chevron-back"
            size={22}
            color={isDarkmode ? themeColor.white100 : themeColor.white100}
          />
        }
        leftAction={() => navigation.goBack()}
        rightContent={
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {isOwner && (
              <TouchableOpacity
                onPress={handleDelete}
                style={{ marginRight: 14 }}
              >
                <Ionicons name="trash-outline" size={20} color="#ff6b6b" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => setTheme(isDarkmode ? "light" : "dark")}
            >
              <Ionicons
                name={isDarkmode ? "sunny" : "moon"}
                size={20}
                color={themeColor.white100}
              />
            </TouchableOpacity>
          </View>
        }
      />

      {/* Story content */}
      <TouchableWithoutFeedback onPress={() => navigation.goBack()}>
        <View
          style={{
            flex: 1,
            backgroundColor: "black",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Image
            source={{ uri: post.mediaUrl }}
            style={{
              width: "100%",
              height: "80%",
              resizeMode: "contain",
            }}
          />

          {/* Caption card at the bottom */}
          {post.caption ? (
            <View
              style={{
                position: "absolute",
                bottom: 60,
                left: 16,
                right: 16,
                backgroundColor: "rgba(0,0,0,0.55)",
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Text
                style={{
                  color: "white",
                  textAlign: "left",
                  fontSize: 14,
                  lineHeight: 18,
                }}
              >
                {post.caption}
              </Text>
            </View>
          ) : null}

          {/* Hint text */}
          <Text
            style={{
              position: "absolute",
              bottom: 24,
              color: "#aaaaaa",
              fontSize: 11,
            }}
          >
            Story will close in 5 seconds · Tap anywhere to exit
          </Text>
        </View>
      </TouchableWithoutFeedback>
    </Layout>
  );
}
