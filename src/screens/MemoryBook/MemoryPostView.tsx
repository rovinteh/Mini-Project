// src/screens/MemoryBook/MemoryPostView.tsx
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Image,
  Alert,
  ActivityIndicator,
  Dimensions,
  ScrollView,
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

import { getFirestore, doc, getDoc } from "firebase/firestore";
import { useIsFocused } from "@react-navigation/native";

// ✅ expo-video
import { useVideoPlayer, VideoView } from "expo-video";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryPostView">;

interface VideoItemProps {
  uri: string;
  isActive: boolean; // 当前是否在这个 index
  isScreenFocused: boolean;
}

/**
 * 单个视频组件（基于 expo-video）
 */
function PostVideoItem({ uri, isActive, isScreenFocused }: VideoItemProps) {
  const player = useVideoPlayer(uri, (player) => {
    player.loop = false; // 播完就停
  });

  // 屏幕失焦时暂停
  useEffect(() => {
    if (!isScreenFocused) {
      player.pause();
    }
  }, [isScreenFocused, player]);

  // 滑到别张时暂停
  useEffect(() => {
    if (!isActive) {
      player.pause();
    }
  }, [isActive, player]);

  return (
    <VideoView
      style={{ width: "100%", height: "100%" }}
      player={player}
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture
      nativeControls
      contentFit="contain" // 等同以前的 resizeMode="contain"
    />
  );
}

export default function MemoryPostView({ route, navigation }: Props) {
  const { postId, startIndex = 0 } = route.params;
  const firestore = getFirestore();
  const { isDarkmode, setTheme } = useTheme();
  const isFocused = useIsFocused();

  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(startIndex || 0);

  const scrollRef = useRef<ScrollView | null>(null);
  const screenWidth = Dimensions.get("window").width;

  // 小工具：格式化日期
  const formatDate = (value: any) => {
    try {
      if (!value) return "";
      if (value.toDate) {
        const d = value.toDate();
        return d.toLocaleString();
      }
      const d = new Date(value);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString();
    } catch {
      return "";
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(firestore, "posts", postId));
        if (!snap.exists()) {
          Alert.alert("Post not found", "This post no longer exists.", [
            { text: "OK", onPress: () => navigation.goBack() },
          ]);
          return;
        }
        const data = snap.data() as any;
        const created = data.CreatedUser || {};

        const mediaUrls =
          data.mediaUrls && data.mediaUrls.length > 0
            ? data.mediaUrls
            : data.mediaUrl
            ? [data.mediaUrl]
            : [];

        const mediaTypes =
          data.mediaTypes && data.mediaTypes.length === mediaUrls.length
            ? data.mediaTypes
            : mediaUrls.map(() => data.mediaType || "image");

        setPost({
          ...data,
          username: created.CreatedUserName || data.username || "User",
          mediaUrls,
          mediaTypes,
          createdAtText: formatDate(data.createdAt || data.timestamp),
        });

        if (startIndex > 0 && scrollRef.current) {
          scrollRef.current.scrollTo({
            x: startIndex * screenWidth,
            animated: false,
          });
        }
      } catch (e) {
        console.log(e);
        Alert.alert("Error", "Unable to load post.", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return (
      <Layout>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#020617",
          }}
        >
          <ActivityIndicator />
          <Text style={{ marginTop: 8, color: themeColor.gray200 }}>
            Loading memory...
          </Text>
        </View>
      </Layout>
    );
  }

  if (!post) return null;

  const mediaUrls: string[] = post.mediaUrls || [];
  const mediaTypes: string[] =
    post.mediaTypes && post.mediaTypes.length === mediaUrls.length
      ? post.mediaTypes
      : mediaUrls.map(() => "image");

  const isVideo = (idx: number) => {
    const t = mediaTypes[idx] || "";
    return t === "video" || t.startsWith("video");
  };

  const bgColor = "#020617";
  const captionBg = "rgba(15,23,42,0.92)";

  return (
    <Layout>
      <TopNav
        middleContent={
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: isDarkmode ? themeColor.white100 : themeColor.dark,
            }}
          >
            Memory by {post.username || "User"}
          </Text>
        }
        leftContent={
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: "rgba(15,23,42,0.7)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Ionicons
              name="close"
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.white100}
            />
          </View>
        }
        leftAction={() => navigation.goBack()}
        rightContent={
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: "rgba(15,23,42,0.7)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Ionicons
              name={isDarkmode ? "sunny" : "moon"}
              size={18}
              color={themeColor.white100}
            />
          </View>
        }
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
        backgroundColor={bgColor}
      />

      <View
        style={{
          flex: 1,
          backgroundColor: bgColor,
        }}
      >
        {/* 顶部用户信息条 */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 4,
            paddingBottom: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: "#1f2937",
                justifyContent: "center",
                alignItems: "center",
                marginRight: 10,
              }}
            >
              <Text style={{ color: "#e5e7eb", fontWeight: "600" }}>
                {(post.username || "U").charAt(0).toUpperCase()}
              </Text>
            </View>
            <View>
              <Text
                style={{
                  color: "#f9fafb",
                  fontSize: 15,
                  fontWeight: "600",
                }}
              >
                {post.username || "User"}
              </Text>
              {post.createdAtText ? (
                <Text
                  style={{
                    color: "#9ca3af",
                    fontSize: 11,
                    marginTop: 1,
                  }}
                >
                  {post.createdAtText}
                </Text>
              ) : null}
            </View>
          </View>

          {mediaUrls.length > 1 && (
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: "rgba(15,23,42,0.75)",
              }}
            >
              <Text
                style={{
                  color: "#e5e7eb",
                  fontSize: 12,
                  fontWeight: "500",
                }}
              >
                {currentIndex + 1}/{mediaUrls.length}
              </Text>
            </View>
          )}
        </View>

        {/* 中间媒体区域 */}
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: startIndex * screenWidth, y: 0 }}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(
                e.nativeEvent.contentOffset.x / screenWidth
              );
              setCurrentIndex(idx);
            }}
          >
            {mediaUrls.map((url, idx) => {
              const video = isVideo(idx);
              return (
                <View
                  key={`${url}-${idx}`}
                  style={{
                    width: screenWidth,
                    height: "100%",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  {video ? (
                    <PostVideoItem
                      uri={url}
                      isActive={idx === currentIndex}
                      isScreenFocused={!!isFocused}
                    />
                  ) : (
                    <Image
                      source={{ uri: url }}
                      style={{
                        width: "100%",
                        height: "100%",
                        resizeMode: "contain",
                      }}
                    />
                  )}
                </View>
              );
            })}
          </ScrollView>

          {/* 多图时显示左右滑动小提示 */}
          {mediaUrls.length > 1 && (
            <View
              style={{
                position: "absolute",
                bottom: 110,
                alignSelf: "center",
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "rgba(15,23,42,0.7)",
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
              }}
            >
              <Ionicons name="swap-horizontal" size={16} color="#e5e7eb" />
              <Text
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  color: "#e5e7eb",
                }}
              >
                Swipe to view more memories
              </Text>
            </View>
          )}
        </View>

        {/* 底部 caption 卡片 */}
        {post.caption || (post.hashtags && post.hashtags.length > 0) ? (
          <View
            style={{
              paddingHorizontal: 16,
              paddingBottom: 18,
              paddingTop: 4,
            }}
          >
            <View
              style={{
                backgroundColor: captionBg,
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: "rgba(148,163,184,0.3)",
              }}
            >
              {post.caption ? (
                <Text
                  style={{
                    color: "#f9fafb",
                    fontSize: 15,
                    lineHeight: 20,
                  }}
                >
                  {post.caption}
                </Text>
              ) : null}

              {post.hashtags && post.hashtags.length > 0 && (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    marginTop: 8,
                  }}
                >
                  {post.hashtags.map((tag: string, i: number) => (
                    <View
                      key={`${tag}-${i}`}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: "rgba(56,189,248,0.12)",
                        marginRight: 6,
                        marginBottom: 4,
                      }}
                    >
                      <Text
                        style={{
                          color: "#38bdf8",
                          fontSize: 12,
                        }}
                      >
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {post.friendTags && post.friendTags.length > 0 && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginTop: 8,
                  }}
                >
                  <Ionicons name="people" size={14} color="#9ca3af" />
                  <Text
                    style={{
                      color: "#9ca3af",
                      fontSize: 12,
                      marginLeft: 4,
                    }}
                  >
                    with {post.friendTags.join(", ")}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : null}
      </View>
    </Layout>
  );
}
