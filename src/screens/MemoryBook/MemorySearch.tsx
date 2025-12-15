// src/screens/MemoryBook/MemorySearch.tsx
import React, { useEffect, useMemo, useState } from "react";
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
  addDoc,
  serverTimestamp,
  orderBy,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

import MemoryFloatingMenu from "./MemoryFloatingMenu";
import B2PostCard, { PostType } from "./B2PostCard";

type Props = NativeStackScreenProps<MainStackParamList, "MemorySearch">;

interface UserType {
  id: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  followers?: string[];
  following?: string[];
}

function normalizeTagInput(input: string) {
  const raw = (input || "").trim();
  if (!raw) return { tagNoHashLower: "", tagWithHashLower: "" };

  const noHash = raw.startsWith("#") ? raw.slice(1) : raw;
  const tagNoHashLower = noHash.trim().toLowerCase();
  const tagWithHashLower = tagNoHashLower ? `#${tagNoHashLower}` : "";
  return { tagNoHashLower, tagWithHashLower };
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

      // ✅ Only create notification when FOLLOW (not unfollow)
      if (!currently) {
        await addDoc(
          collection(firestore, "notifications", selectedUser.id, "items"),
          {
            type: "follow",
            text: `${
              currentUser.displayName || currentUser.email || "Someone"
            } started following you`,
            fromUid: currentUser.uid,
            read: false,
            createdAt: serverTimestamp(),
          }
        );
      }

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

  // ---------- Hashtag search effect (FIXED: support #tag, tag, and hashtagsNorm) ----------
  useEffect(() => {
    const { tagNoHashLower, tagWithHashLower } = normalizeTagInput(trimmed);

    if (!tagNoHashLower) {
      setHashtagPosts([]);
      setActiveHashtag(null);
      return;
    }

    // We run 3 queries and merge results by doc.id
    const col = collection(firestore, "posts");

    const qHash = query(
      col,
      where("hashtags", "array-contains", tagWithHashLower), // e.g. "#travel"
      where("isStory", "==", false),
      orderBy("createdAt", "desc")
    );

    const qNoHash = query(
      col,
      where("hashtags", "array-contains", tagNoHashLower), // e.g. "travel"
      where("isStory", "==", false),
      orderBy("createdAt", "desc")
    );

    const qNorm = query(
      col,
      where("hashtagsNorm", "array-contains", tagNoHashLower), // recommended normalized field
      where("isStory", "==", false),
      orderBy("createdAt", "desc")
    );

    const mergeAndSet = (lists: PostType[][]) => {
      const map = new Map<string, PostType>();

      // preserve ordering somewhat: first lists earlier
      for (const list of lists) {
        for (const p of list) {
          if (!map.has(p.id)) map.set(p.id, p);
        }
      }

      const merged = Array.from(map.values());
      setHashtagPosts(merged);
      setActiveHashtag(merged.length > 0 ? tagWithHashLower : null);
    };

    let list1: PostType[] = [];
    let list2: PostType[] = [];
    let list3: PostType[] = [];

    const unsub1 = onSnapshot(qHash, (snap) => {
      list1 = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      mergeAndSet([list1, list2, list3]);
    });

    const unsub2 = onSnapshot(qNoHash, (snap) => {
      list2 = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      mergeAndSet([list1, list2, list3]);
    });

    const unsub3 = onSnapshot(qNorm, (snap) => {
      list3 = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      mergeAndSet([list1, list2, list3]);
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
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

  const openPost = (post: PostType) => {
    navigation.navigate("MemoryPostView", { postId: post.id });
  };

  const displayHashtagLabel = useMemo(() => {
    const { tagNoHashLower } = normalizeTagInput(trimmed);
    return tagNoHashLower ? `#${tagNoHashLower}` : trimmed;
  }, [trimmed]);

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
                  No posts found for {displayHashtagLabel}
                </Text>
              ) : (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                  }}
                >
                  {hashtagPosts.map((post) => (
                    <B2PostCard
                      key={post.id}
                      post={post}
                      onPress={() => openPost(post)}
                    />
                  ))}
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

              {filteredUsers.map((user) => (
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
                </View>
              ))}
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
                  <View style={{ flexDirection: "row", marginTop: 12 }}>
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

              {/* Posts grid (B2PostCard) */}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  justifyContent: "flex-start",
                }}
              >
                {posts.map((post) => (
                  <B2PostCard
                    key={post.id}
                    post={post}
                    onPress={() => openPost(post)}
                  />
                ))}
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
      <MemoryFloatingMenu navigation={navigation as any} />
    </Layout>
  );
}
