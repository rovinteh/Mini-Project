// src/screens/MemoryBook/MemorySearch.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
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
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

import MemoryFloatingMenu from "./MemoryFloatingMenu";

type Props = NativeStackScreenProps<MainStackParamList, "MemorySearch">;

interface UserType {
  id: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  followers?: string[];
  following?: string[];
}

export interface PostType {
  id: string;
  imageUrl?: string;
  videoUrl?: string;
  caption?: string;
  likes?: string[];
  savedBy?: string[];
  commentsCount?: number;
  createdAt?: any;
  [key: string]: any; // allow extra fields
}

export default function MemorySearch({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const firestore = getFirestore();
  const auth = getAuth();
  const currentUser = auth.currentUser;

  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<UserType[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserType | null>(null);
  const [posts, setPosts] = useState<PostType[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);

  // hashtag search state
  const [hashtagPosts, setHashtagPosts] = useState<PostType[]>([]);
  const [activeHashtag, setActiveHashtag] = useState<string | null>(null);

  const primaryTextColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const secondaryTextColor = isDarkmode ? "#aaa" : "#555";

  const trimmed = search.trim();

  // ---------- Load all users ----------
  useEffect(() => {
    const unsub = onSnapshot(collection(firestore, "users"), (snap) => {
      const arr: UserType[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setUsers(arr);
    });

    return () => unsub();
  }, [firestore]);

  // ---------- When selectedUser changes -> load posts + follow state ----------
  useEffect(() => {
    if (!selectedUser) {
      setPosts([]);
      setIsFollowing(false);
      return;
    }

    if (currentUser) {
      setIsFollowing((selectedUser.followers || []).includes(currentUser.uid));
    } else {
      setIsFollowing(false);
    }

    const qPosts = query(
      collection(firestore, "posts"),
      where("CreatedUser.CreatedUserId", "==", selectedUser.id),
      where("isStory", "==", false),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(qPosts, (snap) => {
      const arr: PostType[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setPosts(arr);
    });

    return () => unsub();
  }, [selectedUser, firestore, currentUser?.uid]);

  const handleSelectUser = (user: UserType) => {
    setSelectedUser(user);
  };

  // ---------- Toggle follow from selected profile ----------
  const handleFollowToggle = async () => {
    if (!selectedUser || !currentUser) return;
    if (selectedUser.id === currentUser.uid) return;

    const userRef = doc(firestore, "users", selectedUser.id);
    const meRef = doc(firestore, "users", currentUser.uid);
    const currently = isFollowing;

    const newFollowers = currently
      ? (selectedUser.followers || []).filter((id) => id !== currentUser.uid)
      : [...(selectedUser.followers || []), currentUser.uid];

    try {
      await Promise.all([
        updateDoc(userRef, {
          followers: currently
            ? arrayRemove(currentUser.uid)
            : arrayUnion(currentUser.uid),
        }),
        updateDoc(meRef, {
          following: currently
            ? arrayRemove(selectedUser.id)
            : arrayUnion(selectedUser.id),
        }),
      ]);

      setIsFollowing(!currently);
      setSelectedUser((prev) =>
        prev
          ? {
              ...prev,
              followers: newFollowers,
            }
          : prev
      );
      setUsers((prev) =>
        prev.map((u) =>
          u.id === selectedUser.id ? { ...u, followers: newFollowers } : u
        )
      );
    } catch (e) {
      console.log("Failed to toggle follow:", e);
    }
  };

  // ---------- Toggle follow from user list (small heart) ----------
  const toggleFollowUser = async (user: UserType) => {
    if (!currentUser) return;
    if (user.id === currentUser.uid) return;

    const userRef = doc(firestore, "users", user.id);
    const meRef = doc(firestore, "users", currentUser.uid);

    const currentlyFollowing = (user.followers || []).includes(currentUser.uid);

    const newFollowers = currentlyFollowing
      ? (user.followers || []).filter((id) => id !== currentUser.uid)
      : [...(user.followers || []), currentUser.uid];

    try {
      await Promise.all([
        updateDoc(userRef, {
          followers: currentlyFollowing
            ? arrayRemove(currentUser.uid)
            : arrayUnion(currentUser.uid),
        }),
        updateDoc(meRef, {
          following: currentlyFollowing
            ? arrayRemove(user.id)
            : arrayUnion(user.id),
        }),
      ]);

      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, followers: newFollowers } : u))
      );

      setSelectedUser((prev) =>
        prev && prev.id === user.id
          ? { ...prev, followers: newFollowers }
          : prev
      );

      if (selectedUser && selectedUser.id === user.id) {
        setIsFollowing(!currentlyFollowing);
      }
    } catch (e) {
      console.log("Failed to toggle follow from list:", e);
    }
  };

  // ---------- Hashtag search effect ----------
  useEffect(() => {
    const text = trimmed.toLowerCase();

    if (!text) {
      setHashtagPosts([]);
      setActiveHashtag(null);
      return;
    }

    let tag = text;
    if (!tag.startsWith("#")) {
      tag = "#" + tag;
    }

    const qTag = query(
      collection(firestore, "posts"),
      where("hashtags", "array-contains", tag),
      where("isStory", "==", false),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(qTag, (snap) => {
      const arr: PostType[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setHashtagPosts(arr);
      setActiveHashtag(arr.length > 0 ? tag : null);
    });

    return () => unsub();
  }, [trimmed, firestore]);

  // ---------- User search filter ----------
  const filteredUsers: UserType[] =
    trimmed.length === 0
      ? []
      : users.filter((u) =>
          ((u.displayName || u.email || "") as string)
            .toLowerCase()
            .includes(trimmed.toLowerCase())
        );

  // ---------- LIKE & SAVE handlers ----------
  const toggleLike = async (post: PostType) => {
    if (!currentUser) return;
    const uid = currentUser.uid;
    const isLiked = (post.likes || []).includes(uid);

    try {
      const ref = doc(firestore, "posts", post.id);
      await updateDoc(ref, {
        likes: isLiked ? arrayRemove(uid) : arrayUnion(uid),
      });

      // update local state for both lists (profile posts + hashtag posts)
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                likes: isLiked
                  ? (p.likes || []).filter((id) => id !== uid)
                  : [...(p.likes || []), uid],
              }
            : p
        )
      );
      setHashtagPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                likes: isLiked
                  ? (p.likes || []).filter((id) => id !== uid)
                  : [...(p.likes || []), uid],
              }
            : p
        )
      );
    } catch (err) {
      console.log("toggleLike error", err);
    }
  };

  const toggleSave = async (post: PostType) => {
    if (!currentUser) return;
    const uid = currentUser.uid;
    const isSaved = (post.savedBy || []).includes(uid);

    try {
      const ref = doc(firestore, "posts", post.id);
      await updateDoc(ref, {
        savedBy: isSaved ? arrayRemove(uid) : arrayUnion(uid),
      });

      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                savedBy: isSaved
                  ? (p.savedBy || []).filter((id) => id !== uid)
                  : [...(p.savedBy || []), uid],
              }
            : p
        )
      );
      setHashtagPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                savedBy: isSaved
                  ? (p.savedBy || []).filter((id) => id !== uid)
                  : [...(p.savedBy || []), uid],
              }
            : p
        )
      );
    } catch (err) {
      console.log("toggleSave error", err);
    }
  };

  const openPost = (post: PostType) => {
    navigation.navigate("MemoryPostView", { postId: post.id });
  };

  const renderPostCard = (post: PostType) => {
    const uid = currentUser?.uid;
    const isLiked = uid ? (post.likes || []).includes(uid) : false;
    const isSaved = uid ? (post.savedBy || []).includes(uid) : false;
    const likesCount = post.likes ? post.likes.length : 0;
    const commentsCount = post.commentsCount || 0;

    return (
      <View
        key={post.id}
        style={{
          width: "48%",
          marginBottom: 16,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: isDarkmode ? "#111" : "#f3f4f6",
        }}
      >
        {/* image / video preview */}
        <TouchableOpacity onPress={() => openPost(post)}>
          {post.imageUrl ? (
            <Image
              source={{ uri: post.imageUrl }}
              style={{ width: "100%", height: 160 }}
            />
          ) : (
            <View
              style={{
                width: "100%",
                height: 160,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isDarkmode ? "#222" : "#e5e7eb",
              }}
            >
              <Ionicons
                name="image-outline"
                size={30}
                color={secondaryTextColor}
              />
            </View>
          )}
        </TouchableOpacity>

        {/* caption (1 line) */}
        {post.caption ? (
          <Text
            numberOfLines={1}
            style={{
              fontSize: 12,
              paddingHorizontal: 8,
              paddingTop: 6,
              color: primaryTextColor,
            }}
          >
            {post.caption}
          </Text>
        ) : null}

        {/* actions row: like, comment, save */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 8,
            paddingVertical: 6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {/* like */}
            <TouchableOpacity
              disabled={!currentUser}
              onPress={() => toggleLike(post)}
              style={{ marginRight: 6 }}
            >
              <Ionicons
                name={isLiked ? "heart" : "heart-outline"}
                size={18}
                color={isLiked ? "#ef4444" : secondaryTextColor}
              />
            </TouchableOpacity>
            <Text style={{ fontSize: 11, color: secondaryTextColor }}>
              {likesCount}
            </Text>

            {/* comment */}
            <TouchableOpacity
              onPress={() => openPost(post)}
              style={{ marginLeft: 12, marginRight: 4 }}
            >
              <Ionicons
                name="chatbubble-outline"
                size={18}
                color={secondaryTextColor}
              />
            </TouchableOpacity>
            <Text style={{ fontSize: 11, color: secondaryTextColor }}>
              {commentsCount}
            </Text>
          </View>

          {/* save */}
          <TouchableOpacity
            disabled={!currentUser}
            onPress={() => toggleSave(post)}
          >
            <Ionicons
              name={isSaved ? "bookmark" : "bookmark-outline"}
              size={18}
              color={isSaved ? themeColor.info : secondaryTextColor}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Layout>
      <TopNav
        middleContent={<Text>Search</Text>}
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

      <View style={{ flex: 1 }}>
        {/* Search bar */}
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              borderRadius: 20,
              paddingHorizontal: 12,
              paddingVertical: 6,
              backgroundColor: isDarkmode ? "#222" : "#f3f4f6",
            }}
          >
            <Ionicons
              name="search"
              size={18}
              color={secondaryTextColor}
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={{ flex: 1, color: primaryTextColor }}
              placeholder="Search users or #hashtags..."
              placeholderTextColor={secondaryTextColor}
              value={search}
              onChangeText={(text) => {
                setSearch(text);
                if (text.trim().length === 0) {
                  setSelectedUser(null);
                  setPosts([]);
                  setHashtagPosts([]);
                  setActiveHashtag(null);
                }
              }}
            />
            {search.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearch("");
                  setSelectedUser(null);
                  setPosts([]);
                  setHashtagPosts([]);
                  setActiveHashtag(null);
                }}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={secondaryTextColor}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 90,
          }}
        >
          {/* Hashtag results */}
          {trimmed.length > 0 && (
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "bold",
                  color: primaryTextColor,
                  marginBottom: 8,
                }}
              >
                Hashtag results
              </Text>

              {hashtagPosts.length === 0 ? (
                <Text style={{ fontSize: 12, color: secondaryTextColor }}>
                  No posts found for{" "}
                  {trimmed.startsWith("#") ? trimmed : `#${trimmed}`}
                </Text>
              ) : (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                  }}
                >
                  {hashtagPosts.map(renderPostCard)}
                </View>
              )}
            </View>
          )}

          {/* User list */}
          {filteredUsers.length > 0 && (
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "bold",
                  color: primaryTextColor,
                  marginBottom: 8,
                }}
              >
                Users
              </Text>

              {filteredUsers.map((user) => {
                const isMe = currentUser?.uid === user.id;
                const isFollowingUser =
                  !!currentUser &&
                  (user.followers || []).includes(currentUser.uid);

                return (
                  <View
                    key={user.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: 8,
                      borderBottomWidth: 0.3,
                      borderBottomColor: isDarkmode ? "#333" : "#e5e7eb",
                    }}
                  >
                    {/* Avatar */}
                    <TouchableOpacity
                      onPress={() => handleSelectUser(user)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        flex: 1,
                      }}
                    >
                      {user.photoURL ? (
                        <Image
                          source={{ uri: user.photoURL }}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                            backgroundColor: "#d1d5db",
                          }}
                        />
                      ) : (
                        <Ionicons
                          name="person-circle-outline"
                          size={40}
                          color={themeColor.info}
                        />
                      )}
                      <View style={{ marginLeft: 10 }}>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "bold",
                            color: primaryTextColor,
                          }}
                        >
                          {user.displayName || "No name"}
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: secondaryTextColor,
                          }}
                        >
                          {user.email}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Small heart button to follow / unfollow */}
                    <TouchableOpacity
                      disabled={!currentUser || isMe}
                      onPress={() => toggleFollowUser(user)}
                      style={{ paddingHorizontal: 4, paddingVertical: 4 }}
                    >
                      <Ionicons
                        name={isFollowingUser ? "heart" : "heart-outline"}
                        size={22}
                        color={
                          isFollowingUser ? "#ef4444" : secondaryTextColor
                        }
                      />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Selected user profile + posts */}
          {selectedUser && (
            <View style={{ marginTop: 10 }}>
              <View style={{ alignItems: "center", marginBottom: 16 }}>
                {selectedUser.photoURL ? (
                  <Image
                    source={{ uri: selectedUser.photoURL }}
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: 40,
                      backgroundColor: "#d1d5db",
                    }}
                  />
                ) : (
                  <Ionicons
                    name="person-circle-outline"
                    size={70}
                    color={themeColor.info}
                  />
                )}

                <Text
                  style={{
                    marginTop: 4,
                    fontSize: 18,
                    fontWeight: "bold",
                    color: primaryTextColor,
                  }}
                >
                  {selectedUser.displayName || "No name"}
                </Text>
                {selectedUser.email && (
                  <Text style={{ fontSize: 12, color: secondaryTextColor }}>
                    {selectedUser.email}
                  </Text>
                )}

                {/* Stats */}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-around",
                    width: "80%",
                    marginTop: 16,
                  }}
                >
                  <View style={{ alignItems: "center" }}>
                    <Text fontWeight="bold">{posts.length}</Text>
                    <Text>Posts</Text>
                  </View>
                  <View style={{ alignItems: "center" }}>
                    <Text fontWeight="bold">
                      {(selectedUser.followers || []).length}
                    </Text>
                    <Text>Followers</Text>
                  </View>
                  <View style={{ alignItems: "center" }}>
                    <Text fontWeight="bold">
                      {(selectedUser.following || []).length}
                    </Text>
                    <Text>Following</Text>
                  </View>
                </View>

                {/* Follow + Message */}
                {currentUser && currentUser.uid !== selectedUser.id && (
                  <View
                    style={{
                      flexDirection: "row",
                      marginTop: 12,
                    }}
                  >
                    <TouchableOpacity
                      onPress={handleFollowToggle}
                      style={{
                        flex: 1,
                        marginRight: 6,
                        paddingHorizontal: 20,
                        paddingVertical: 8,
                        borderRadius: 20,
                        alignItems: "center",
                        backgroundColor: isFollowing
                          ? isDarkmode
                            ? themeColor.dark100
                            : "#ccc"
                          : themeColor.info,
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "bold" }}>
                        {isFollowing ? "Following" : "Follow"}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() =>
                        navigation.navigate("MemoryChat", {
                          peerId: selectedUser.id,
                          peerName:
                            selectedUser.displayName ||
                            selectedUser.email ||
                            "User",
                        })
                      }
                      style={{
                        flex: 1,
                        marginLeft: 6,
                        paddingHorizontal: 20,
                        paddingVertical: 8,
                        borderRadius: 20,
                        alignItems: "center",
                        backgroundColor: isDarkmode ? "#222" : "#e5e7eb",
                      }}
                    >
                      <Text
                        style={{
                          color: isDarkmode
                            ? themeColor.white100
                            : themeColor.dark,
                          fontWeight: "bold",
                        }}
                      >
                        Message
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Posts grid with like / comment / save */}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                }}
              >
                {posts.map(renderPostCard)}
                {posts.length === 0 && (
                  <View
                    style={{
                      width: "100%",
                      alignItems: "center",
                      marginTop: 20,
                    }}
                  >
                    <Text style={{ fontSize: 13, color: secondaryTextColor }}>
                      No posts yet.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Bottom navigation bar */}
      <MemoryFloatingMenu navigation={navigation} />
    </Layout>
  );
}
