// src/screens/MyModule/MemoryReels.tsx
import React, { useEffect, useState } from "react";
import { View, FlatList, TouchableOpacity, Dimensions } from "react-native";
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

import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { useIsFocused } from "@react-navigation/native";
import MemoryFloatingMenu from "./MemoryFloatingMenu";
// ✅ new expo-video imports
import { useVideoPlayer, VideoView } from "expo-video";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryReels">;

interface ReelPost {
  id: string;
  userId?: string;
  username?: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption?: string;
  createdAt?: any;
  likes?: string[];
  savedBy?: string[];
}

const { width } = Dimensions.get("window");

// Small item component so we can use useVideoPlayer per reel
type ReelItemProps = {
  post: ReelPost;
  currentUserId: string;
  isDarkmode: boolean;
  screenIsFocused: boolean;
  cardStyle: any;
  onToggleLike: (post: ReelPost) => void;
  onToggleSave: (post: ReelPost) => void;
  onOpenComments: (post: ReelPost) => void;
};

const ReelItem: React.FC<ReelItemProps> = ({
  post,
  currentUserId,
  isDarkmode,
  screenIsFocused,
  cardStyle,
  onToggleLike,
  onToggleSave,
  onOpenComments,
}) => {
  const defaultIconColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const liked = (post.likes || []).includes(currentUserId);
  const saved = (post.savedBy || []).includes(currentUserId);

  // 🔁 useVideoPlayer for this reel
  const player = useVideoPlayer(post.mediaUrl, (p) => {
    p.loop = false; // play once by default; user can replay with controls
  });

  // pause video when screen is not focused
  useEffect(() => {
    if (!screenIsFocused) {
      player.pause();
    }
  }, [screenIsFocused, player]);

  return (
    <View style={cardStyle}>
      {/* Header: username */}
      <Text fontWeight="bold" style={{ marginBottom: 6 }}>
        {post.username || "User"}
      </Text>

      {/* Video */}
      <View
        style={{
          width: "100%",
          height: width * 0.6,
          borderRadius: 10,
          overflow: "hidden",
          backgroundColor: "black",
        }}
      >
        <VideoView
          player={player}
          style={{ width: "100%", height: "100%" }}
          nativeControls
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture
        />
      </View>

      {/* Actions: Like / Comment / Save */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginTop: 10,
        }}
      >
        {/* Like */}
        <TouchableOpacity onPress={() => onToggleLike(post)}>
          <Ionicons
            name={liked ? "heart" : "heart-outline"}
            size={24}
            color={liked ? "red" : defaultIconColor}
          />
        </TouchableOpacity>

        {/* Comment */}
        <TouchableOpacity
          style={{ marginLeft: 18 }}
          onPress={() => onOpenComments(post)}
        >
          <Ionicons
            name="chatbubble-outline"
            size={22}
            color={isDarkmode ? "#ccc" : "#666"}
          />
        </TouchableOpacity>

        {/* Save */}
        <TouchableOpacity
          style={{ marginLeft: 18 }}
          onPress={() => onToggleSave(post)}
        >
          <Ionicons
            name={saved ? "bookmark" : "bookmark-outline"}
            size={22}
            color={saved ? themeColor.info : defaultIconColor}
          />
        </TouchableOpacity>
      </View>

      {/* Likes count */}
      {post.likes && post.likes.length > 0 && (
        <Text style={{ marginTop: 4 }}>{post.likes.length} likes</Text>
      )}

      {/* Caption */}
      {post.caption ? (
        <Text style={{ marginTop: 8 }}>{post.caption}</Text>
      ) : null}
    </View>
  );
};

export default function MemoryReels({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const firestore = getFirestore();
  const auth = getAuth();
  const currentUserId = auth.currentUser?.uid || "";
  const isFocused = useIsFocused();

  const [reels, setReels] = useState<ReelPost[]>([]);

  const cardBg = isDarkmode ? themeColor.dark100 : "#dfe3eb";
  const borderColor = isDarkmode ? "#333" : "#d0d0d0";

  const cardStyle = {
    backgroundColor: cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor,
    marginBottom: 16,
    padding: 8,
    shadowColor: "#000" as const,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  };

  useEffect(() => {
    const q = query(
      collection(firestore, "posts"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const list: ReelPost[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as any;
        if (d.mediaType === "video") {
          const created = d.CreatedUser || {};
          list.push({
            id: docSnap.id,
            userId: created.CreatedUserId || d.userId,
            username: created.CreatedUserName || d.username || "User",
            mediaUrl: d.mediaUrl,
            mediaType: d.mediaType,
            caption: d.caption || "",
            createdAt: d.createdAt,
            likes: d.likes || [],
            savedBy: d.savedBy || [],
          });
        }
      });
      setReels(list);
    });

    return () => {
      unsub();
    };
  }, [firestore]);

  // ====== LIKE / SAVE HANDLERS ======
  const handleToggleLike = async (post: ReelPost) => {
    if (!currentUserId) return;
    const refDoc = doc(firestore, "posts", post.id);
    const alreadyLiked = (post.likes || []).includes(currentUserId);

    try {
      await updateDoc(refDoc, {
        likes: alreadyLiked
          ? arrayRemove(currentUserId)
          : arrayUnion(currentUserId),
      });
    } catch (e) {
      console.log("Failed to toggle like in Reels:", e);
    }
  };

  const handleToggleSave = async (post: ReelPost) => {
    if (!currentUserId) return;
    const refDoc = doc(firestore, "posts", post.id);
    const alreadySaved = (post.savedBy || []).includes(currentUserId);

    try {
      await updateDoc(refDoc, {
        savedBy: alreadySaved
          ? arrayRemove(currentUserId)
          : arrayUnion(currentUserId),
      });
    } catch (e) {
      console.log("Failed to toggle save in Reels:", e);
    }
  };

  const renderReel = ({ item }: { item: ReelPost }) => (
    <ReelItem
      post={item}
      currentUserId={currentUserId}
      isDarkmode={!!isDarkmode}
      screenIsFocused={isFocused}
      cardStyle={cardStyle}
      onToggleLike={handleToggleLike}
      onToggleSave={handleToggleSave}
      onOpenComments={(p) =>
        navigation.navigate("MemoryComments", { postId: p.id } as any)
      }
    />
  );

  return (
    <Layout>
      <TopNav
        middleContent={<Text>Reels</Text>}
        leftContent={
          <Ionicons
            name="chevron-back"
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        leftAction={() => navigation.popToTop()}
        rightContent={
          <Ionicons
            name={isDarkmode ? "sunny" : "moon"}
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />

      {/* Reels list */}
      <FlatList
        data={reels}
        keyExtractor={(item) => item.id}
        renderItem={renderReel}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      />
      <MemoryFloatingMenu navigation={navigation as any} />
    </Layout>
  );
}
