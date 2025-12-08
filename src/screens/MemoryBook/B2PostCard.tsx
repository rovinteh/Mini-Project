// src/screens/MemoryBook/B2PostCard.tsx
import React from "react";
import { View, Image, TouchableOpacity } from "react-native";
import { Text, themeColor, useTheme } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";

export type PostType = {
  id: string;
  mediaUrl: string;
  mediaType?: "image" | "video";
  caption?: string;
  likes?: string[];
  comments?: any[];
  createdAt?: any; // Firestore timestamp
  isStory?: boolean;
};

type Props = {
  post: PostType;
  onPress?: () => void;
  showMenu?: boolean;
  onPressMenu?: () => void;
};

export default function B2PostCard({
  post,
  onPress,
  showMenu,
  onPressMenu,
}: Props) {
  const { isDarkmode } = useTheme();

  const dateString = post.createdAt
    ? new Date(post.createdAt.toDate()).toLocaleDateString()
    : "";

  const cardBg = isDarkmode ? themeColor.dark100 : "#e9edf2";
  const textColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const borderColor = isDarkmode ? "#333" : "#d0d0d0";

  // detect video based on Firestore field
  const isVideo = post.mediaType === "video";

  // expo-video player (used only when isVideo === true)
  const player = useVideoPlayer(post.mediaUrl, (p) => {
    p.loop = false;   // no auto-loop
    p.pause();        // start paused; user can press play in controls
  });

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
        }}
      >
        <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
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
            }}
          >
            {isVideo ? (
              <VideoView
                style={{ width: "100%", height: "100%" }}
                player={player}
                // show basic OS controls so user can play / pause
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
          </View>

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

          {/* LIKE + COMMENT COUNT */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: 3,
            }}
          >
            <Ionicons name="heart" size={14} color={themeColor.danger} />
            <Text style={{ marginLeft: 4, fontSize: 12, color: textColor }}>
              {post.likes?.length || 0}
            </Text>

            <Ionicons
              name="chatbubble-ellipses-outline"
              size={14}
              color={isDarkmode ? "#aaa" : "#666"}
              style={{ marginLeft: 12 }}
            />
            <Text style={{ marginLeft: 4, fontSize: 12, color: textColor }}>
              {post.comments?.length || 0}
            </Text>
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
        </TouchableOpacity>

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
