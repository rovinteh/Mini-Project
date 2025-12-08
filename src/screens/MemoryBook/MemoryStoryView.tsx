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
  username?: string; // <--- added so we can show "{username} story"
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
          const created = story.createdAt.toDate();
          expired = now.getTime() - created.getTime() >= 24 * 60 * 60 * 1000;
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

  // Auto close like IG (6 seconds)
  useEffect(() => {
    if (!post) return;
    const timer = setTimeout(() => {
      navigation.goBack();
    }, 5000);

    return () => clearTimeout(timer);
  }, [post, navigation]);

  const isOwner = !!post && !!currentUser && post.userId === currentUser.uid;

  // DIRECT delete (works on web and native)
  const handleDelete = async () => {
    if (!post || !isOwner) return;

    try {
      // delete Firestore doc
      await deleteDoc(doc(firestore, "posts", post.id));

      // try delete image from Storage as well
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
          middleContent={<Text>{"Story"}</Text>}
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

  if (!post) {
    return null;
  }

  const titleText = post.username ? `${post.username} story` : "User story";

  return (
    <Layout>
      <TopNav
        middleContent={titleText}
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

      {/* Delete button for owner */}
      {isOwner && (
        <TouchableOpacity
          onPress={handleDelete}
          style={{
            position: "absolute",
            top: 90, // moved lower so it doesn't align with title
            right: 16, // a bit inward
            zIndex: 10,
          }}
        >
          <Ionicons name="trash" size={20} color="#fff" /> {/* smaller */}
        </TouchableOpacity>
      )}

      <TouchableWithoutFeedback onPress={() => navigation.goBack()}>
        <View
          style={{
            flex: 1,
            backgroundColor: "black",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
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
          {post.caption ? (
            <Text
              style={{
                color: "white",
                marginTop: 10,
                textAlign: "center",
              }}
            >
              {post.caption}
            </Text>
          ) : null}
          <Text style={{ color: "#aaa", marginTop: 5, fontSize: 12 }}>
            Story will close in 5 seconds. Tap to exit.
          </Text>
        </View>
      </TouchableWithoutFeedback>
    </Layout>
  );
}
