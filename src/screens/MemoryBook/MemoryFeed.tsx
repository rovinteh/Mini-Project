// src/screens/MyModule/MemoryFeed.tsx
import React, { useEffect, useState } from "react";

import {
  View,
  Image,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Modal,
  Dimensions,
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
  deleteDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage, ref, deleteObject } from "firebase/storage";

// ✅ new video library
import { useVideoPlayer, VideoView } from "expo-video";
import MemoryFloatingMenu from "../MemoryBook/MemoryFloatingMenu";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryFeed">;

interface Post {
  id: string;
  userId: string;
  username?: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption: string;
  isStory?: boolean;
  createdAt?: any;
  likes?: string[];
  savedBy?: string[];
  storyExpiresAt?: any;
  hashtags?: string[];
  friendTags?: string[];
  mediaUrls?: string[];
  mediaTypes?: ("image" | "video")[];
  locationLabel?: string | null;
  locationCoords?: {
    latitude: number;
    longitude: number;
  } | null;

  // ✅ Mood emoji (AI / user edited)
  emoji?: string | null;
}

// Format Firestore timestamp to readable date+time
const formatDateTime = (ts: any): string => {
  if (!ts) return "";
  try {
    const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
    return date.toLocaleString();
  } catch {
    return "";
  }
};

// ✅ Separate component so we can use hooks (useVideoPlayer) per post
type PostItemProps = {
  post: Post;
  currentUserId?: string;
  isDarkmode: boolean;
  cardStyle: any;
  onToggleLike: (post: Post) => void;
  onToggleSave: (post: Post) => void;
  onOpenComments: (post: Post) => void;
  onOpenOptions: (post: Post) => void;
  onOpenFullView: (post: Post, startIndex?: number) => void;
};

const PostItem: React.FC<PostItemProps> = ({
  post,
  currentUserId,
  isDarkmode,
  cardStyle,
  onToggleLike,
  onToggleSave,
  onOpenComments,
  onOpenOptions,
  onOpenFullView,
}) => {
  const defaultIconColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const liked = post.likes?.includes(currentUserId || "");
  const saved = post.savedBy?.includes(currentUserId || "");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [post.id]);

  // ✅ emoji helper (safe)
  const safeEmoji = (e?: string | null) => {
    const s = String(e || "").trim();
    return s ? s.slice(0, 2) : "";
  };
  const emoji = safeEmoji(post.emoji);

  // ✅ useVideoPlayer for videos
  const player =
    post.mediaType === "video"
      ? useVideoPlayer(post.mediaUrl, (playerInstance) => {
          playerInstance.loop = false;
        })
      : null;

  const containerWidth = Dimensions.get("window").width - 48;
  const mediaHeight = containerWidth; // square-ish

  const EmojiBadge = () => {
    if (!emoji) return null;
    return (
      <View
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 999,
          backgroundColor: "rgba(0,0,0,0.55)",
          zIndex: 20,
        }}
      >
        <Text style={{ fontSize: 16, color: "#fff" }}>{emoji}</Text>
      </View>
    );
  };

  return (
    <View style={cardStyle}>
      {/* header: username + location + 3-dot menu for own post */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text fontWeight="bold">{post.username || "User"}</Text>
          {post.locationLabel && (
            <Text
              style={{
                marginTop: 2,
                fontSize: 12,
                color: isDarkmode ? "#9ca3af" : "#6b7280",
              }}
              numberOfLines={1}
            >
              {post.locationLabel}
            </Text>
          )}
        </View>

        {post.userId === currentUserId && (
          <TouchableOpacity
            onPress={() => onOpenOptions(post)}
            style={{ padding: 8, marginRight: 4 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name="ellipsis-vertical"
              size={22}
              color={defaultIconColor}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* MEDIA */}
      {(() => {
        const urls =
          post.mediaUrls && post.mediaUrls.length > 0
            ? post.mediaUrls
            : [post.mediaUrl];

        const normalizeType = (t?: string) => {
          if (!t) return "image";
          if ((t as string).startsWith("image")) return "image";
          if ((t as string).startsWith("video")) return "video";
          return t === "video" ? "video" : "image";
        };

        const typesRaw =
          post.mediaTypes && post.mediaTypes.length === urls.length
            ? post.mediaTypes
            : urls.map(() => post.mediaType);

        const types = typesRaw.map((t) => normalizeType(t));

        // check if we can show multi-image carousel
        const allImages = types.every((t) => t === "image");
        const hasMultipleImages = allImages && urls.length > 1;

        // if we have multiple images → horizontal swipe
        if (hasMultipleImages) {
          return (
            <View
              style={{
                width: "100%",
                height: mediaHeight,
                borderRadius: 10,
                overflow: "hidden",
                backgroundColor: "black",
              }}
            >
              {/* ✅ emoji overlay */}
              <EmojiBadge />

              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                style={{ flex: 1 }}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(
                    e.nativeEvent.contentOffset.x / containerWidth
                  );
                  setActiveIndex(idx);
                }}
                scrollEventThrottle={16}
              >
                {urls.map((u, idx) => (
                  <View
                    key={`${u}-${idx}`}
                    style={{ width: containerWidth, height: "100%" }}
                  >
                    <Image
                      source={{ uri: u }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="contain"
                    />
                  </View>
                ))}
              </ScrollView>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onOpenFullView(post, activeIndex)}
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  backgroundColor: "rgba(0,0,0,0.45)",
                  padding: 8,
                  borderRadius: 16,
                  zIndex: 15,
                }}
              >
                <Ionicons name="expand" size={18} color="#fff" />
              </TouchableOpacity>

              <View
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 0,
                  right: 0,
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                {urls.map((_, idx) => (
                  <View
                    key={idx}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor:
                        idx === activeIndex
                          ? themeColor.info
                          : "rgba(255,255,255,0.4)",
                    }}
                  />
                ))}
              </View>
            </View>
          );
        }

        // else: single media (image OR video)
        const singleType = types[0] || post.mediaType || "image";
        const singleUrl = urls[0];

        if (singleType === "image") {
          return (
            <View
              style={{
                width: "100%",
                height: mediaHeight,
                borderRadius: 10,
                overflow: "hidden",
                backgroundColor: "black",
              }}
            >
              {/* ✅ emoji overlay */}
              <EmojiBadge />

              <Image
                source={{ uri: singleUrl }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="contain"
              />

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onOpenFullView(post, 0)}
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  backgroundColor: "rgba(0,0,0,0.45)",
                  padding: 8,
                  borderRadius: 16,
                }}
              >
                <Ionicons name="expand" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          );
        }

        return (
          <View
            style={{
              width: "100%",
              height: mediaHeight,
              borderRadius: 10,
              overflow: "hidden",
              backgroundColor: "black",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* ✅ emoji overlay */}
            <EmojiBadge />

            {player && (
              <VideoView
                player={player}
                style={{ width: "100%", height: "100%" }}
                fullscreenOptions={{ enable: true }}
                allowsPictureInPicture
                nativeControls
              />
            )}

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => onOpenFullView(post, 0)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                backgroundColor: "rgba(0,0,0,0.45)",
                padding: 8,
                borderRadius: 16,
              }}
            >
              <Ionicons name="expand" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* actions */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginTop: 10,
        }}
      >
        <TouchableOpacity onPress={() => onToggleLike(post)}>
          <Ionicons
            name={liked ? "heart" : "heart-outline"}
            size={24}
            color={liked ? "red" : defaultIconColor}
          />
        </TouchableOpacity>

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

      {post.likes && post.likes.length > 0 && (
        <Text style={{ marginTop: 4 }}>{post.likes.length} likes</Text>
      )}

      {/* caption */}
      <Text style={{ marginTop: 6 }}>{post.caption}</Text>

      {/* hashtags */}
      {post.hashtags && post.hashtags.length > 0 && (
        <Text
          style={{
            marginTop: 4,
            fontSize: 12,
            color: isDarkmode ? "#d1d5db" : "#4b5563",
          }}
        >
          {post.hashtags.join(" ")}
        </Text>
      )}

      {/* friend tags */}
      {post.friendTags && post.friendTags.length > 0 && (
        <Text
          style={{
            marginTop: 4,
            fontSize: 12,
            color: isDarkmode ? "#9ca3af" : "#6b7280",
          }}
        >
          with {post.friendTags.join(", ")}
        </Text>
      )}

      {/* date */}
      {post.createdAt && (
        <Text style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
          {formatDateTime(post.createdAt)}
        </Text>
      )}
    </View>
  );
};

export default function MemoryFeed({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const firestore = getFirestore();
  const auth = getAuth();
  const storage = getStorage();
  const currentUserId = auth.currentUser?.uid;

  const [posts, setPosts] = useState<Post[]>([]);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  // unified card style
  const cardBg = isDarkmode ? themeColor.dark100 : "#dfe3eb";
  const borderColor = isDarkmode ? "#333" : "#d0d0d0";

  const cardStyle = {
    backgroundColor: cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: borderColor,
    marginBottom: 16,
    padding: 8,
    shadowColor: "#000" as const,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  };

  useEffect(() => {
    const q = query(collection(firestore, "posts"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(q, (snapshot) => {
      const data: Post[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as any;
        const created = d.CreatedUser || {};
        const userId: string = created.CreatedUserId || d.userId || "";
        const username: string = created.CreatedUserName || d.username || "User";

        // ✅ emoji: prefer top-level emoji, fallback to mood.emoji
        const emoji =
          typeof d.emoji === "string"
            ? d.emoji
            : typeof d.mood?.emoji === "string"
            ? d.mood.emoji
            : "";

        data.push({
          id: docSnap.id,
          userId,
          username,
          mediaUrl: d.mediaUrl,
          mediaType: d.mediaType || "image",
          caption: d.caption || "",
          emoji, // ✅ add emoji
          isStory: d.isStory || false,
          createdAt: d.createdAt,
          storyExpiresAt: d.storyExpiresAt || null,
          likes: d.likes || [],
          savedBy: d.savedBy || [],
          hashtags: d.hashtags || [],
          friendTags: d.friendTags || [],
          mediaUrls: d.mediaUrls || (d.mediaUrl ? [d.mediaUrl] : []),
          mediaTypes: d.mediaTypes || (d.mediaType ? [d.mediaType] : []),
          locationLabel: d.locationLabel || null,
          locationCoords: d.locationCoords || null,
        });
      });
      setPosts(data);
    });

    return () => unsub();
  }, [firestore]);

  const handleToggleLike = async (post: Post) => {
    if (!currentUserId) return;
    const refDoc = doc(firestore, "posts", post.id);
    const alreadyLiked = post.likes?.includes(currentUserId);

    await updateDoc(refDoc, {
      likes: alreadyLiked ? arrayRemove(currentUserId) : arrayUnion(currentUserId),
    });
  };

  const handleToggleSave = async (post: Post) => {
    if (!currentUserId) return;
    const refDoc = doc(firestore, "posts", post.id);
    const alreadySaved = post.savedBy?.includes(currentUserId);

    await updateDoc(refDoc, {
      savedBy: alreadySaved ? arrayRemove(currentUserId) : arrayUnion(currentUserId),
    });
  };

  // delete document + media from Storage
  const deletePostWithMedia = async (post: Post) => {
    try {
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      await deleteDoc(doc(firestore, "posts", post.id));

      const urls =
        post.mediaUrls && post.mediaUrls.length > 0
          ? post.mediaUrls
          : post.mediaUrl
          ? [post.mediaUrl]
          : [];

      for (const url of urls) {
        try {
          const desertRef = ref(storage, url);
          await deleteObject(desertRef);
        } catch (error) {
          console.log("Error deleting media:", error);
        }
      }
    } catch (err: any) {
      console.error("Delete post error:", err);
    }
  };

  const handleEditPost = (post: Post) => {
    setOptionsVisible(false);
    navigation.navigate("MemoryUpload", {
      editMode: true,
      postId: post.id,
      postData: post,
    } as any);
  };

  const handleDeletePressed = () => {
    if (!selectedPost) return;
    const post = selectedPost;
    setOptionsVisible(false);
    deletePostWithMedia(post);
  };

  const isStoryActive = (p: Post) => {
    if (!p.isStory) return false;
    const now = new Date();

    if (p.storyExpiresAt?.toDate) {
      return p.storyExpiresAt.toDate() > now;
    }

    if (p.createdAt?.toDate) {
      const created = p.createdAt.toDate();
      return now.getTime() - created.getTime() < 24 * 60 * 60 * 1000;
    }

    return false;
  };

  const stories = posts.filter(isStoryActive);
  const memoryPosts = posts.filter((p) => !p.isStory);

  const openOptionsForPost = (post: Post) => {
    setSelectedPost(post);
    setOptionsVisible(true);
  };

  const handleOpenFullView = (post: Post, _startIndex?: number) => {
    navigation.navigate("MemoryPostView", { postId: post.id } as any);
  };

  return (
    <Layout>
      <TopNav
        middleContent={<Text>Memory Feed</Text>}
        leftContent={
          <Ionicons
            name="chevron-back"
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        leftAction={() => navigation.popToTop()}
        rightContent={
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons
              name={isDarkmode ? "sunny" : "moon"}
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
              onPress={() => setTheme(isDarkmode ? "light" : "dark")}
            />
          </View>
        }
      />

      {/* Stories row */}
      <View style={{ paddingVertical: 10 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            alignItems: "center",
          }}
        >
          {/* New Story bubble */}
          <View style={{ alignItems: "center", marginRight: 12 }}>
            <TouchableOpacity
              onPress={() => navigation.navigate("MemoryUpload" as never)}
              style={{
                width: 70,
                height: 70,
                borderRadius: 35,
                backgroundColor: themeColor.info,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="add" size={32} color="#fff" />
            </TouchableOpacity>
            <Text style={{ marginTop: 4, fontSize: 12 }}>New Story</Text>
          </View>

          {/* Existing stories */}
          {stories.map((story) => (
            <View key={story.id} style={{ alignItems: "center", marginRight: 12 }}>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("MemoryStoryView", { postId: story.id } as any)
                }
                style={{
                  width: 70,
                  height: 70,
                  borderRadius: 35,
                  borderWidth: 2,
                  borderColor: themeColor.info,
                  overflow: "hidden",
                }}
              >
                <Image
                  source={{ uri: story.mediaUrl }}
                  style={{ width: "100%", height: "100%" }}
                />
              </TouchableOpacity>
              <Text style={{ marginTop: 4, fontSize: 12 }}>
                {story.username || "Story"}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Feed posts */}
      <FlatList
        data={memoryPosts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostItem
            post={item}
            currentUserId={currentUserId}
            isDarkmode={!!isDarkmode}
            cardStyle={cardStyle}
            onToggleLike={handleToggleLike}
            onToggleSave={handleToggleSave}
            onOpenComments={(p) =>
              navigation.navigate("MemoryComments", { postId: p.id } as any)
            }
            onOpenOptions={openOptionsForPost}
            onOpenFullView={handleOpenFullView}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      />

      {/* POP-UP OPTIONS MODAL */}
      <Modal
        visible={optionsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setOptionsVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.4)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: 260,
              borderRadius: 16,
              padding: 16,
              backgroundColor: isDarkmode ? themeColor.dark100 : themeColor.white100,
            }}
          >
            <Text fontWeight="bold" style={{ marginBottom: 12, fontSize: 16 }}>
              Post options
            </Text>

            <TouchableOpacity
              onPress={() => selectedPost && handleEditPost(selectedPost)}
              style={{ paddingVertical: 10 }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: isDarkmode ? themeColor.white100 : themeColor.dark,
                }}
              >
                Edit
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleDeletePressed} style={{ paddingVertical: 10 }}>
              <Text style={{ fontSize: 14, color: "red" }}>Delete</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setOptionsVisible(false)}
              style={{ paddingVertical: 10, marginTop: 4 }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: themeColor.gray300,
                  textAlign: "right",
                }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <MemoryFloatingMenu navigation={navigation as any} />
    </Layout>
  );
}
