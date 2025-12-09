// src/screens/MemoryBook/MemoryProfile.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  FlatList,
  TouchableOpacity,
  Image,
  Modal,
  ScrollView,
  Alert,
  TextInput,
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
import MemoryFloatingMenu from "./MemoryFloatingMenu";
import { getAuth, updateProfile } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  deleteDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  deleteObject,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

import * as ImagePicker from "expo-image-picker";

import B2PostCard, { PostType } from "./B2PostCard";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryProfile">;

interface UserInfo {
  id: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  followers?: string[];
  following?: string[];
}

type BasicUser = {
  id: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
};

type TabKey = "posts" | "saved";

export default function MemoryProfile({ navigation }: Props) {
  const currentScreen = "MemoryProfile";

  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const firestore = getFirestore();
  const storage = getStorage();
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || "";

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [posts, setPosts] = useState<PostType[]>([]);
  const [savedPosts, setSavedPosts] = useState<PostType[]>([]);
  const [selectedTab, setSelectedTab] = useState<TabKey>("posts");

  // 3-dot options
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState<PostType | null>(null);

  // follower / following modals
  const [followersVisible, setFollowersVisible] = useState(false);
  const [followingVisible, setFollowingVisible] = useState(false);
  const [followersUsers, setFollowersUsers] = useState<BasicUser[]>([]);
  const [followingUsers, setFollowingUsers] = useState<BasicUser[]>([]);
  const [loadingFollowers, setLoadingFollowers] = useState(false);
  const [loadingFollowing, setLoadingFollowing] = useState(false);

  // edit profile modal
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const primaryTextColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const cardBg = isDarkmode ? themeColor.dark100 : "#e9edf2";

  const avatarSource =
    userInfo?.photoURL && userInfo.photoURL !== "-"
      ? { uri: userInfo.photoURL }
      : undefined;

  // keep editName synced with latest userInfo
  useEffect(() => {
    if (userInfo?.displayName) {
      setEditName(userInfo.displayName);
    } else {
      setEditName("");
    }
  }, [userInfo?.displayName]);

  // --------- load user info ----------
  useEffect(() => {
    if (!uid) return;

    const load = async () => {
      try {
        const snap = await getDoc(doc(firestore, "users", uid));
        if (snap.exists()) {
          setUserInfo({ id: snap.id, ...(snap.data() as any) });
        }
      } catch (e) {
        console.log("Failed to load user info:", e);
      }
    };

    load();
  }, [uid, firestore]);

  // --------- posts created by me ----------
  useEffect(() => {
    if (!uid) return;

    const q = query(
      collection(firestore, "posts"),
      where("CreatedUser.CreatedUserId", "==", uid),
      where("isStory", "==", false),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const arr: PostType[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setPosts(arr);
    });

    return () => unsub();
  }, [uid, firestore]);

  // --------- saved posts ----------
  useEffect(() => {
    if (!uid) return;

    const q = query(
      collection(firestore, "posts"),
      where("savedBy", "array-contains", uid),
      where("isStory", "==", false),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const arr: PostType[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setSavedPosts(arr);
    });

    return () => unsub();
  }, [uid, firestore]);

  const dataToShow: PostType[] =
    selectedTab === "posts" ? posts : savedPosts;

  // =========================
  // follower / following helpers
  // =========================

  const fetchUsersByIds = async (ids: string[]): Promise<BasicUser[]> => {
    if (!ids || ids.length === 0) return [];
    const unique = Array.from(new Set(ids));
    const result: BasicUser[] = [];

    await Promise.all(
      unique.map(async (id) => {
        try {
          const snap = await getDoc(doc(firestore, "users", id));
          if (snap.exists()) {
            const d = snap.data() as any;
            result.push({
              id: snap.id,
              displayName: d.displayName || d.name || "",
              email: d.email || "",
              photoURL: d.photoURL || "-",
            });
          }
        } catch (e) {
          console.log("Failed to fetch user", id, e);
        }
      })
    );

    result.sort((a, b) =>
      (a.displayName || "").localeCompare(b.displayName || "")
    );
    return result;
  };

  const openFollowersList = async () => {
    if (!userInfo?.followers || userInfo.followers.length === 0) {
      Alert.alert("Followers", "You don't have any followers yet.");
      return;
    }
    try {
      setLoadingFollowers(true);
      const list = await fetchUsersByIds(userInfo.followers);
      setFollowersUsers(list);
      setFollowersVisible(true);
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Failed to load followers.");
    } finally {
      setLoadingFollowers(false);
    }
  };

  const openFollowingList = async () => {
    if (!userInfo?.following || userInfo.following.length === 0) {
      Alert.alert("Following", "You are not following anyone yet.");
      return;
    }
    try {
      setLoadingFollowing(true);
      const list = await fetchUsersByIds(userInfo.following);
      setFollowingUsers(list);
      setFollowingVisible(true);
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Failed to load following list.");
    } finally {
      setLoadingFollowing(false);
    }
  };

  const toggleFollowUserFromList = async (
    targetUserId: string,
    currentlyFollowing: boolean
  ) => {
    if (!uid || uid === targetUserId) return;

    const meRef = doc(firestore, "users", uid);
    const otherRef = doc(firestore, "users", targetUserId);

    try {
      await Promise.all([
        updateDoc(otherRef, {
          followers: currentlyFollowing ? arrayRemove(uid) : arrayUnion(uid),
        }),
        updateDoc(meRef, {
          following: currentlyFollowing
            ? arrayRemove(targetUserId)
            : arrayUnion(targetUserId),
        }),
      ]);

      // update local following list
      setUserInfo((prev) => {
        if (!prev) return prev;
        const oldFollowing = prev.following || [];
        const newFollowing = currentlyFollowing
          ? oldFollowing.filter((id) => id !== targetUserId)
          : [...oldFollowing, targetUserId];
        return { ...prev, following: newFollowing };
      });

      // update modal following list (for following modal)
      setFollowingUsers((prev) => {
        if (currentlyFollowing) {
          return prev.filter((u) => u.id !== targetUserId);
        }
        return prev;
      });
    } catch (e) {
      console.log("toggleFollowUserFromList error", e);
      Alert.alert("Error", "Unable to update follow status.");
    }
  };

  const removeFollowerFromList = async (targetUserId: string) => {
    if (!uid || uid === targetUserId) return;

    const meRef = doc(firestore, "users", uid); // me
    const otherRef = doc(firestore, "users", targetUserId); // follower

    try {
      await Promise.all([
        // They no longer follow me
        updateDoc(otherRef, {
          following: arrayRemove(uid),
        }),
        // My followers array no longer contains them
        updateDoc(meRef, {
          followers: arrayRemove(targetUserId),
        }),
      ]);

      // update local followers list in userInfo
      setUserInfo((prev) => {
        if (!prev) return prev;
        const oldFollowers = prev.followers || [];
        const newFollowers = oldFollowers.filter((id) => id !== targetUserId);
        return { ...prev, followers: newFollowers };
      });

      // update local modal list
      setFollowersUsers((prev) => prev.filter((u) => u.id !== targetUserId));
    } catch (e) {
      console.log("removeFollowerFromList error", e);
      Alert.alert("Error", "Unable to remove follower.");
    }
  };

  // --------- edit / delete post helpers ----------

  const openOptionsForPost = (post: PostType) => {
    setSelectedPost(post);
    setOptionsVisible(true);
  };

  const deletePostWithMedia = async (postId: string, mediaUrl: string) => {
    try {
      // optimistic UI update
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setSavedPosts((prev) => prev.filter((p) => p.id !== postId));

      await deleteDoc(doc(firestore, "posts", postId));
      console.log("Post deleted:", postId);

      if (mediaUrl) {
        const mediaRef = ref(storage, mediaUrl);
        try {
          await deleteObject(mediaRef);
          console.log("Media deleted");
        } catch (err) {
          console.log("Failed to delete media file:", err);
        }
      }
    } catch (err) {
      console.log("Delete post error:", err);
    }
  };

  const handleEditPost = (post: PostType) => {
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
    deletePostWithMedia(post.id, post.mediaUrl);
  };

  // =========================
  // Edit profile helpers
  // =========================

  const openEditProfileModal = () => {
    setEditName(userInfo?.displayName || "");
    setEditProfileVisible(true);
  };

  const handleChangePhoto = async () => {
    if (!uid) return;

    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission required",
        "Please allow access to your photos to change profile picture."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return;
    }

    const uri = result.assets[0].uri;
    try {
      setUploadingAvatar(true);
      const response = await fetch(uri);
      const blob: any = await response.blob();

      const photoRef = ref(storage, `profilePhotos/${uid}.jpg`);
      await uploadBytes(photoRef, blob);
      const url = await getDownloadURL(photoRef);

      // update user doc & auth profile
      const meRef = doc(firestore, "users", uid);
      await updateDoc(meRef, { photoURL: url });
      if (currentUser) {
        await updateProfile(currentUser, { photoURL: url });
      }

      setUserInfo((prev) =>
        prev ? { ...prev, photoURL: url } : prev
      );
    } catch (e) {
      console.log("Change photo error", e);
      Alert.alert("Error", "Failed to update profile picture.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!uid) return;

    const trimmedName = editName.trim();
    if (!trimmedName) {
      Alert.alert("Validation", "Display name cannot be empty.");
      return;
    }

    try {
      setSavingProfile(true);
      const meRef = doc(firestore, "users", uid);
      await updateDoc(meRef, { displayName: trimmedName });
      if (currentUser) {
        await updateProfile(currentUser, { displayName: trimmedName });
      }

      setUserInfo((prev) =>
        prev ? { ...prev, displayName: trimmedName } : prev
      );
      setEditProfileVisible(false);
    } catch (e) {
      console.log("Save profile error", e);
      Alert.alert("Error", "Failed to save profile changes.");
    } finally {
      setSavingProfile(false);
    }
  };

  // --------- render screen ----------
  if (!currentUser) {
    return (
      <Layout>
        <TopNav
          middleContent={<Text>My Profile</Text>}
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
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Text>Please log in to view your profile.</Text>
        </View>
      </Layout>
    );
  }

  // Counts – prefer modal lists when loaded, otherwise use arrays
  const followersCount =
    followersUsers.length > 0
      ? followersUsers.length
      : userInfo?.followers
      ? new Set(
          (userInfo.followers || []).filter((id) => id && id !== uid)
        ).size
      : 0;

  const followingCount =
    followingUsers.length > 0
      ? followingUsers.length
      : userInfo?.following
      ? new Set(
          (userInfo.following || []).filter((id) => id && id !== uid)
        ).size
      : 0;

  return (
    <Layout>
      <TopNav
        middleContent={<Text>My Profile</Text>}
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
        <FlatList
          data={dataToShow}
          numColumns={3}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <B2PostCard
              post={item}
              onPress={() =>
                navigation.navigate("MemoryPostView", { postId: item.id })
              }
              showMenu={selectedTab === "posts"}
              onPressMenu={() => openOptionsForPost(item)}
            />
          )}
          contentContainerStyle={{ paddingBottom: 90 }}
          ListHeaderComponent={
            <View style={{ paddingVertical: 20 }}>
              {/* profile header */}
              <View style={{ alignItems: "center" }}>
                <TouchableOpacity onPress={openEditProfileModal}>
                  {avatarSource ? (
                    <Image
                      source={avatarSource}
                      style={{
                        width: 90,
                        height: 90,
                        borderRadius: 45,
                        borderWidth: 2,
                        borderColor: themeColor.info,
                      }}
                    />
                  ) : (
                    <Ionicons
                      name="person-circle-outline"
                      size={90}
                      color={themeColor.info}
                    />
                  )}
                </TouchableOpacity>

                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: "bold",
                    marginTop: 6,
                    color: primaryTextColor,
                  }}
                >
                  {userInfo?.displayName || "My Account"}
                </Text>
                {userInfo?.email && (
                  <Text
                    style={{
                      opacity: 0.7,
                      color: isDarkmode ? "#ccc" : "#555",
                    }}
                  >
                    {userInfo.email}
                  </Text>
                )}

                {/* small edit profile button */}
                <TouchableOpacity
                  onPress={openEditProfileModal}
                  style={{
                    marginTop: 8,
                    paddingHorizontal: 16,
                    paddingVertical: 6,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: themeColor.info,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "bold",
                      color: themeColor.info,
                    }}
                  >
                    Edit profile
                  </Text>
                </TouchableOpacity>

                {/* stats */}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-around",
                    width: "80%",
                    marginTop: 20,
                  }}
                >
                  <View style={{ alignItems: "center" }}>
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: "bold",
                        color: primaryTextColor,
                      }}
                    >
                      {posts.length}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        color: isDarkmode ? "#ccc" : "#555",
                      }}
                    >
                      Posts
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={{ alignItems: "center" }}
                    onPress={openFollowersList}
                  >
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: "bold",
                        color: primaryTextColor,
                      }}
                    >
                      {followersCount}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        color: isDarkmode ? "#ccc" : "#555",
                      }}
                    >
                      Followers
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{ alignItems: "center" }}
                    onPress={openFollowingList}
                  >
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: "bold",
                        color: primaryTextColor,
                      }}
                    >
                      {followingCount}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        color: isDarkmode ? "#ccc" : "#555",
                      }}
                    >
                      Following
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Messages button */}
                <TouchableOpacity
                  onPress={() => navigation.navigate("MemoryChatsList")}
                  style={{
                    marginTop: 16,
                    paddingHorizontal: 26,
                    paddingVertical: 8,
                    borderRadius: 24,
                    backgroundColor: themeColor.info,
                    flexDirection: "row",
                    alignItems: "center",
                  }}
                >
                  <Ionicons name="chatbubbles-outline" size={18} color="#fff" />
                  <Text
                    style={{
                      marginLeft: 6,
                      color: "#fff",
                      fontWeight: "bold",
                      fontSize: 13,
                    }}
                  >
                    Messages
                  </Text>
                </TouchableOpacity>
              </View>

              {/* tabs */}
              <View
                style={{
                  flexDirection: "row",
                  marginTop: 24,
                  marginHorizontal: 20,
                  borderRadius: 999,
                  overflow: "hidden",
                  backgroundColor: cardBg,
                }}
              >
                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: "center",
                    backgroundColor:
                      selectedTab === "posts"
                        ? themeColor.info
                        : "transparent",
                  }}
                  onPress={() => setSelectedTab("posts")}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "bold",
                      color:
                        selectedTab === "posts"
                          ? "#fff"
                          : isDarkmode
                          ? themeColor.white100
                          : themeColor.dark,
                    }}
                  >
                    My Posts
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: "center",
                    backgroundColor:
                      selectedTab === "saved"
                        ? themeColor.info
                        : "transparent",
                  }}
                  onPress={() => setSelectedTab("saved")}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "bold",
                      color:
                        selectedTab === "saved"
                          ? "#fff"
                          : isDarkmode
                          ? themeColor.white100
                          : themeColor.dark,
                    }}
                  >
                    Saved
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          }
        />
      </View>


      {/* Followers Modal */}
      <Modal
        visible={followersVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFollowersVisible(false)}
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
              width: "85%",
              maxHeight: "75%",
              borderRadius: 16,
              padding: 16,
              backgroundColor: isDarkmode
                ? themeColor.dark100
                : themeColor.white100,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "bold",
                marginBottom: 12,
                color: primaryTextColor,
              }}
            >
              Followers
            </Text>

            {loadingFollowers ? (
              <Text style={{ color: isDarkmode ? "#ccc" : "#555" }}>
                Loading...
              </Text>
            ) : followersUsers.length === 0 ? (
              <Text style={{ color: isDarkmode ? "#ccc" : "#555" }}>
                You don't have any followers yet.
              </Text>
            ) : (
              <ScrollView>
                {followersUsers.map((u) => {
                  const iFollow = (userInfo?.following || []).includes(u.id);

                  return (
                    <View
                      key={u.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginBottom: 10,
                      }}
                    >
                      {u.photoURL && u.photoURL !== "-" ? (
                        <Image
                          source={{ uri: u.photoURL }}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            marginRight: 10,
                          }}
                        />
                      ) : (
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            marginRight: 10,
                            backgroundColor: isDarkmode ? "#111" : "#e5e7eb",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons
                            name="person-outline"
                            size={18}
                            color={isDarkmode ? "#ccc" : "#555"}
                          />
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "bold",
                            color: primaryTextColor,
                          }}
                        >
                          {u.displayName || "User"}
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: isDarkmode ? "#ccc" : "#555",
                          }}
                        >
                          {u.email}
                        </Text>
                      </View>

                      {u.id !== uid && (
                        <TouchableOpacity
                          onPress={() =>
                            iFollow
                              ? removeFollowerFromList(u.id)
                              : toggleFollowUserFromList(u.id, false)
                          }
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 999,
                            backgroundColor: iFollow
                              ? "#ef4444"
                              : themeColor.info,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: "bold",
                              color: "#fff",
                            }}
                          >
                            {iFollow ? "Remove follower" : "Follow back"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity
              onPress={() => setFollowersVisible(false)}
              style={{ marginTop: 10, alignSelf: "flex-end" }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: themeColor.gray300,
                  textAlign: "right",
                }}
              >
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Following Modal */}
      <Modal
        visible={followingVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFollowingVisible(false)}
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
              width: "85%",
              maxHeight: "75%",
              borderRadius: 16,
              padding: 16,
              backgroundColor: isDarkmode
                ? themeColor.dark100
                : themeColor.white100,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "bold",
                marginBottom: 12,
                color: primaryTextColor,
              }}
            >
              Following
            </Text>

            {loadingFollowing ? (
              <Text style={{ color: isDarkmode ? "#ccc" : "#555" }}>
                Loading...
              </Text>
            ) : followingUsers.length === 0 ? (
              <Text style={{ color: isDarkmode ? "#ccc" : "#555" }}>
                You're not following anyone yet.
              </Text>
            ) : (
              <ScrollView>
                {followingUsers.map((u) => (
                  <View
                    key={u.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    {u.photoURL && u.photoURL !== "-" ? (
                      <Image
                        source={{ uri: u.photoURL }}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          marginRight: 10,
                        }}
                      />
                    ) : (
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          marginRight: 10,
                          backgroundColor: isDarkmode ? "#111" : "#e5e7eb",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name="person-outline"
                          size={18}
                          color={isDarkmode ? "#ccc" : "#555"}
                        />
                      </View>
                    )}

                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: "bold",
                          color: primaryTextColor,
                        }}
                      >
                        {u.displayName || "User"}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          color: isDarkmode ? "#ccc" : "#555",
                        }}
                      >
                        {u.email}
                      </Text>
                    </View>

                    {u.id !== uid && (
                      <TouchableOpacity
                        onPress={() =>
                          toggleFollowUserFromList(u.id, true)
                        }
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: "#ef4444",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "bold",
                            color: "#fff",
                          }}
                        >
                          Unfollow
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity
              onPress={() => setFollowingVisible(false)}
              style={{ marginTop: 10, alignSelf: "flex-end" }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: themeColor.gray300,
                  textAlign: "right",
                }}
              >
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal
        visible={editProfileVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditProfileVisible(false)}
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
              width: "85%",
              borderRadius: 16,
              padding: 16,
              backgroundColor: isDarkmode
                ? themeColor.dark100
                : themeColor.white100,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "bold",
                marginBottom: 12,
                color: primaryTextColor,
              }}
            >
              Edit profile
            </Text>

            {/* preview avatar */}
            <View
              style={{
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              {avatarSource ? (
                <Image
                  source={avatarSource}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 40,
                    borderWidth: 2,
                    borderColor: themeColor.info,
                    marginBottom: 8,
                  }}
                />
              ) : (
                <Ionicons
                  name="person-circle-outline"
                  size={80}
                  color={themeColor.info}
                />
              )}

              <TouchableOpacity
                onPress={handleChangePhoto}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 20,
                  backgroundColor: themeColor.info,
                }}
                disabled={uploadingAvatar}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "bold",
                    color: "#fff",
                  }}
                >
                  {uploadingAvatar ? "Updating..." : "Change photo"}
                </Text>
              </TouchableOpacity>
            </View>

            {/* display name input */}
            <Text
              style={{
                fontSize: 13,
                marginBottom: 4,
                color: primaryTextColor,
              }}
            >
              Display name
            </Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Enter display name"
              placeholderTextColor={isDarkmode ? "#777" : "#999"}
              style={{
                borderWidth: 1,
                borderColor: isDarkmode ? "#555" : "#ccc",
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 8,
                color: primaryTextColor,
                marginBottom: 16,
              }}
            />

            {/* buttons */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
              }}
            >
              <TouchableOpacity
                onPress={() => setEditProfileVisible(false)}
                style={{ paddingVertical: 8, paddingHorizontal: 10 }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    color: themeColor.gray300,
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSaveProfile}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 20,
                  backgroundColor: themeColor.info,
                  marginLeft: 4,
                }}
                disabled={savingProfile}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "bold",
                    color: "#fff",
                  }}
                >
                  {savingProfile ? "Saving..." : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit/Delete Post modal */}
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
              backgroundColor: isDarkmode
                ? themeColor.dark100
                : themeColor.white100,
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

            <TouchableOpacity
              onPress={handleDeletePressed}
              style={{ paddingVertical: 10 }}
            >
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
