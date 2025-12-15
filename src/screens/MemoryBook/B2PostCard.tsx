// src/screens/MemoryBook/B2PostCard.tsx
import React from "react";
import { View, Image, TouchableOpacity } from "react-native";
import { Text, themeColor, useTheme } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";

import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";

import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

export type PostType = {
  id: string;
  mediaUrl: string;
  mediaType?: "image" | "video";
  caption?: string;

  // ✅ NEW: hashtags support (safe optional)
  hashtags?: string[]; // e.g. ["travel", "friends", "sunset"] or ["#travel"]

  likes?: string[];
  comments?: any[];
  savedBy?: string[];
  createdAt?: any;
  isStory?: boolean;

  // 🔹 Location (optional)
  locationLabel?: string | null;
  locationCoords?: {
    latitude: number;
    longitude: number;
  } | null;

  // ✅ Mood (top-level)
  emoji?: string | null;
};

type Props = {
  post: PostType;
  onPress?: () => void;
  showMenu?: boolean;
  onPressMenu?: () => void;
};

type NavProp = NativeStackNavigationProp<MainStackParamList>;

// small helper: make emoji safe
function safeEmoji(e: any) {
  const s = String(e || "").trim();
  if (!s) return "";
  return s.slice(0, 2);
}

// ✅ helper: render hashtags in a compact, UI-safe way
function renderHashtags(tags?: string[]) {
  if (!tags || tags.length === 0) return "";
  return tags
    .filter(Boolean)
    .map((t) => String(t).trim())
    .filter((t) => t.length > 0)
    .slice(0, 3) // keep card clean
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .join(" ");
}

export default function B2PostCard({
  post,
  onPress,
  showMenu,
  onPressMenu,
}: Props) {
  const { isDarkmode } = useTheme();
  const navigation = useNavigation<NavProp>();

  const auth = getAuth();
  const firestore = getFirestore();
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || null;

  const dateString = post.createdAt
    ? new Date(post.createdAt.toDate()).toLocaleDateString()
    : "";

  const cardBg = isDarkmode ? themeColor.dark100 : "#e9edf2";
  const textColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const borderColor = isDarkmode ? "#333" : "#d0d0d0";

  const isVideo = post.mediaType === "video";

  // expo-video player (used only when isVideo === true)
  const player = useVideoPlayer(post.mediaUrl, (p) => {
    p.loop = false;
    p.pause();
  });

  const isLiked = uid ? (post.likes || []).includes(uid) : false;
  const isSaved = uid ? (post.savedBy || []).includes(uid) : false;

  const likesCount = post.likes?.length || 0;
  const commentsCount = post.comments?.length || 0;

  const openPost = () => {
    if (onPress) onPress();
    else navigation.navigate("MemoryPostView", { postId: post.id });
  };

  const handleToggleLike = async () => {
    if (!uid) return;
    try {
      const ref = doc(firestore, "posts", post.id);
      await updateDoc(ref, {
        likes: isLiked ? arrayRemove(uid) : arrayUnion(uid),
      });
    } catch (err) {
      console.log("Error toggling like:", err);
    }
  };

  const handleToggleSave = async () => {
    if (!uid) return;
    try {
      const ref = doc(firestore, "posts", post.id);
      await updateDoc(ref, {
        savedBy: isSaved ? arrayRemove(uid) : arrayUnion(uid),
      });
    } catch (err) {
      console.log("Error toggling save:", err);
    }
  };

  const handleOpenComments = () => {
    navigation.navigate("MemoryPostView", { postId: post.id });
  };

  const locationColor = isDarkmode ? "#b5c4ff" : "#555";

  // ✅ emoji badge (top-level emoji)
  const emoji = safeEmoji(post.emoji);

  // ✅ hashtags text
  const hashtagsText = renderHashtags(post.hashtags);

  return (
    <View style={{ width: "33.33%", padding: 4 }}>
      <View
        style={{
          backgroundColor: cardBg,
          borderRadius: 12,
          padding: 6,
          borderWidth: 1,
          borderColor,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 3,
          elevation: 3,
          position: "relative",
          height: 295,
        }}
      >
        {/* Whole card tap → open post */}
        <TouchableOpacity activeOpacity={0.85} onPress={openPost}>
          {/* MEDIA */}
          <View
            style={{
              width: "100%",
              height: 180,
              borderRadius: 8,
              overflow: "hidden",
              backgroundColor: "#000",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            {isVideo ? (
              <VideoView
                style={{ width: "100%", height: "100%" }}
                player={player}
                nativeControls
                fullscreenOptions={{ enable: true }}
                allowsPictureInPicture
              />
            ) : (
              <Image
                source={{ uri: post.mediaUrl }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
              />
            )}

            {/* ✅ Emoji badge */}
            {!!emoji && (
              <View
                style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 999,
                  backgroundColor: "rgba(0,0,0,0.55)",
                }}
              >
                <Text style={{ fontSize: 14, color: "#fff" }}>{emoji}</Text>
              </View>
            )}
          </View>

          {/* 📍 Location (optional) */}
          {post.locationLabel ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginTop: 4,
              }}
            >
              <Ionicons
                name="location-outline"
                size={12}
                color={locationColor}
              />
              <Text
                numberOfLines={1}
                style={{
                  marginLeft: 4,
                  fontSize: 10,
                  flex: 1,
                  color: locationColor,
                }}
              >
                {post.locationLabel}
              </Text>
            </View>
          ) : null}

          {/* CAPTION */}
          <Text
            numberOfLines={2}
            style={{
              marginTop: 4,
              fontSize: 12,
              color: textColor,
            }}
          >
            {post.caption || ""}
          </Text>

          {/* ✅ HASHTAGS (display under caption) */}
          {!!hashtagsText && (
            <Text
              numberOfLines={1}
              style={{
                marginTop: 2,
                fontSize: 11,
                color: isDarkmode ? "#9db7ff" : "#3b5bdb",
              }}
            >
              {hashtagsText}
            </Text>
          )}
        </TouchableOpacity>

        {/* ACTIONS: like, comment, save */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 4,
          }}
        >
          {/* Like */}
          <TouchableOpacity
            disabled={!uid}
            onPress={handleToggleLike}
            style={{ flexDirection: "row", alignItems: "center" }}
          >
            <Ionicons
              name={isLiked ? "heart" : "heart-outline"}
              size={18}
              color={isLiked ? themeColor.danger : textColor}
            />
            <Text style={{ marginLeft: 4, fontSize: 12, color: textColor }}>
              {likesCount}
            </Text>
          </TouchableOpacity>

          {/* Comment */}
          <TouchableOpacity
            onPress={handleOpenComments}
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginLeft: 12,
            }}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={18}
              color={isDarkmode ? "#aaa" : "#666"}
            />
            <Text style={{ marginLeft: 4, fontSize: 12, color: textColor }}>
              {commentsCount}
            </Text>
          </TouchableOpacity>

          {/* Save */}
          <TouchableOpacity
            disabled={!uid}
            onPress={handleToggleSave}
            style={{ marginLeft: 12 }}
          >
            <Ionicons
              name={isSaved ? "bookmark" : "bookmark-outline"}
              size={18}
              color={isSaved ? themeColor.info : textColor}
            />
          </TouchableOpacity>
        </View>

        {/* DATE */}
        <Text
          style={{
            marginTop: 2,
            fontSize: 10,
            color: textColor,
            opacity: 0.6,
          }}
        >
          {dateString}
        </Text>

        {/* 3-dot menu */}
        {showMenu && (
          <TouchableOpacity
            onPress={onPressMenu}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              padding: 4,
              borderRadius: 999,
              backgroundColor: "rgba(0,0,0,0.45)",
            }}
          >
            <Ionicons name="ellipsis-vertical" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
