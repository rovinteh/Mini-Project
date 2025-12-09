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

import { NativeStackNavigationProp } from "@react-navigation/native-stack";
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

import B2PostCard, { PostType } from "./B2PostCard";
import MemoryFloatingMenu from "./MemoryFloatingMenu";

type NavProp = NativeStackNavigationProp<MainStackParamList>;
interface Props {
  navigation: NavProp;
}

interface UserType {
  id: string;
  displayName?: string;
  email?: string;
  photoURL?: string; // ⭐ 新增：用户头像
  followers?: string[];
  following?: string[];
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

  // ---------- Toggle follow for selectedUser ----------
  const handleFollowToggle = async () => {
    if (!selectedUser || !currentUser) return;
    if (selectedUser.id === currentUser.uid) return;

    await toggleFollowUser(selectedUser);
  };

  // ---------- 通用：跟随 / 取消跟随 某一个 user ----------
  const toggleFollowUser = async (target: UserType) => {
    if (!currentUser) return;
    if (target.id === currentUser.uid) return;

    const targetRef = doc(firestore, "users", target.id);
    const meRef = doc(firestore, "users", currentUser.uid);

    const already = (target.followers || []).includes(currentUser.uid);

    try {
      await Promise.all([
        updateDoc(targetRef, {
          followers: already
            ? arrayRemove(currentUser.uid)
            : arrayUnion(currentUser.uid),
        }),
        updateDoc(meRef, {
          following: already ? arrayRemove(target.id) : arrayUnion(target.id),
        }),
      ]);

      // 更新 users 列表里的 followers
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== target.id) return u;
          const old = u.followers || [];
          const newFollowers = already
            ? old.filter((id) => id !== currentUser.uid)
            : [...old, currentUser.uid];
          return { ...u, followers: newFollowers };
        })
      );

      // 如果当前选中的刚好是这个 user，同步更新 mini profile 的状态
      if (selectedUser && selectedUser.id === target.id) {
        const newFollowers = already
          ? (selectedUser.followers || []).filter(
              (id) => id !== currentUser.uid
            )
          : [...(selectedUser.followers || []), currentUser.uid];

        setSelectedUser({ ...selectedUser, followers: newFollowers });
        setIsFollowing(!already);
      }
    } catch (e) {
      console.log("Failed to toggle follow:", e);
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
        {/* search bar */}
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
          {/* hashtag results */}
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
                  {hashtagPosts.map((post) => (
                    <B2PostCard
                      key={post.id}
                      post={post}
                      onPress={() =>
                        navigation.navigate("MemoryPostView", {
                          postId: post.id,
                        })
                      }
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* user list */}
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
                    {/* 左边头像 + 文本 ... */}

                    {/* 右边小爱心 */}
                    <TouchableOpacity
                      disabled={!currentUser || isMe} // ✅ 用 disabled
                      onPress={() => toggleFollowUser(user)}
                      style={{ paddingHorizontal: 4, paddingVertical: 4 }}
                    >
                      <Ionicons
                        name={isFollowingUser ? "heart" : "heart-outline"}
                        size={22}
                        color={isFollowingUser ? "#ef4444" : secondaryTextColor}
                      />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* selected user mini profile + Message button + posts */}
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
                      borderWidth: 2,
                      borderColor: themeColor.info,
                    }}
                    resizeMode="cover"
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

                {/* stats */}
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

              {/* posts grid (selected user's posts) */}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                }}
              >
                {posts.map((post) => (
                  <B2PostCard
                    key={post.id}
                    post={post}
                    onPress={() =>
                      navigation.navigate("MemoryPostView", { postId: post.id })
                    }
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

      {/* 底部导航条 */}
      <MemoryFloatingMenu navigation={navigation} />
    </Layout>
  );
}
