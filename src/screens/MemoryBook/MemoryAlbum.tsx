// src/screens/MemoryBook/MemoryAlbum.tsx
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  Animated,
  Easing,
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

import { getAuth } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import MemoryFloatingMenu from "./MemoryFloatingMenu";
import { PostType } from "./B2PostCard";


type Props = NativeStackScreenProps<MainStackParamList, "MemoryAlbum">;

interface PersonAlbum {
  name: string;
  postIds: string[];
  coverPost: PostType | null;
}

interface MemoryGroup {
  id: string; // yyyy-mm-dd
  title: string;
  dateLabel: string;
  postIds: string[];
  coverPost: PostType | null;
}

interface MomentItem {
  id: string; // key
  title: string;
  postIds: string[];
  coverPost: PostType | null;
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Helper: get JS Date from Firestore timestamp-ish field
function getPostDate(p: PostType): Date {
  const createdAt: any = (p as any).createdAt;
  if (createdAt?.toDate) {
    return createdAt.toDate();
  } else if (createdAt?.seconds) {
    return new Date(createdAt.seconds * 1000);
  }
  return new Date();
}

// Helper: pick first media thumbnail URL
function getPostThumb(post: any): string | undefined {
  if (Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0) {
    return post.mediaUrls[0];
  }
  if (typeof post.mediaUrl === "string") {
    return post.mediaUrl;
  }
  return undefined;
}

// Title used for daily memory groups (for random + moments)
function buildMemoryTitle(groupPosts: PostType[], dateLabel: string): string {
  if (!groupPosts.length) return `Moments of ${dateLabel}`;

  const allCaptions = groupPosts
    .map((p: any) => p.caption || "")
    .join(" ")
    .toLowerCase();

  const allHashtags = groupPosts
    .map((p: any) =>
      Array.isArray(p.hashtags) ? p.hashtags.join(" ") : ""
    )
    .join(" ")
    .toLowerCase()
    .replace(/#/g, "");

  const text = `${allCaptions} ${allHashtags}`;

  const allFriendTags: string[] = Array.from(
    new Set(
      groupPosts
        .flatMap((p: any) =>
          Array.isArray(p.friendTags) ? p.friendTags : []
        )
        .map((n: string) => n.trim())
        .filter((n: string) => n.length > 0)
    )
  );

  const hasFriends = allFriendTags.length > 0;
  const oneFriendName = allFriendTags.length === 1 ? allFriendTags[0] : null;

  if (/birthday|bday|🎂|cake/.test(text)) {
    return "Birthday memories";
  }

  if (/graduation|convocation/.test(text)) {
    return "Graduation day";
  }

  if (/trip|travel|vacation|holiday/.test(text)) {
    return "Trip memories";
  }

  if (/study|exam|assignment|library|revision/.test(text)) {
    return "Study moments";
  }

  if (/family/.test(text)) {
    return "Family time";
  }

  if (hasFriends) {
    if (oneFriendName) {
      return `Day with ${oneFriendName}`;
    }
    return "Moments with friends";
  }

  if (/selfie|my outfit|ootd|me today/.test(text)) {
    return "Selfie moments";
  }

  if (/street|walk|outdoor|city|sunny|park/.test(text)) {
    return "Outdoor day";
  }

  if (/dinner|lunch|brunch|supper|restaurant|food|snack/.test(text)) {
    return "Food moments";
  }

  return `Moments of ${dateLabel}`;
}

export default function MemoryAlbum({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const firestore = getFirestore();
  const auth = getAuth();
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || "";

  const [posts, setPosts] = useState<PostType[]>([]);
  const [personAlbums, setPersonAlbums] = useState<PersonAlbum[]>([]);
  const [memoryGroups, setMemoryGroups] = useState<MemoryGroup[]>([]);
  const [randomMemory, setRandomMemory] = useState<MemoryGroup | null>(null);
  const [moments, setMoments] = useState<MomentItem[]>([]);
  const [onThisDayPosts, setOnThisDayPosts] = useState<PostType[]>([]);

  const primaryTextColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const sectionTitleColor = primaryTextColor;
  const subTextColor = isDarkmode ? "#ccc" : "#666";
  const cardBg = isDarkmode ? themeColor.dark100 : "#e9edf2";

  const timelineLineColor = "#facc15"; // vertical line
  const timelineDotColor = "#fb923c"; // orange dot

  // timeline animation
  const timelineAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(timelineAnim, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [posts.length]);

  // 1. LOAD POSTS CREATED BY THIS USER
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

  // 2. BUILD "PEOPLE" ALBUMS
  useEffect(() => {
    if (!posts.length) {
      setPersonAlbums([]);
      return;
    }

    type PersonBucket = {
      displayName: string;
      posts: PostType[];
    };

    const buckets: Record<string, PersonBucket> = {};

    posts.forEach((p) => {
      const tags: string[] = Array.isArray((p as any).friendTags)
        ? (p as any).friendTags
        : [];
      tags.forEach((rawName) => {
        const name = (rawName || "").trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!buckets[key]) {
          buckets[key] = { displayName: name, posts: [] };
        }
        buckets[key].posts.push(p);
      });
    });

    const meName = currentUser?.displayName?.trim() || "Me";
    const meKey = meName.toLowerCase();

    if (!buckets[meKey]) {
      buckets[meKey] = {
        displayName: meName,
        posts: [...posts],
      };
    } else {
      const existingIds = new Set(buckets[meKey].posts.map((p) => p.id));
      posts.forEach((p) => {
        if (!existingIds.has(p.id)) buckets[meKey].posts.push(p);
      });
    }

    const albums: PersonAlbum[] = Object.values(buckets)
      .map((b) => ({
        name: b.displayName,
        postIds: b.posts.map((p) => p.id),
        coverPost: b.posts[0] || null,
      }))
      .sort((a, b) => b.postIds.length - a.postIds.length);

    setPersonAlbums(albums);
  }, [posts, currentUser]);

  // 3. DAILY MEMORY GROUPS (for random memories / moments)
  useEffect(() => {
    if (!posts.length) {
      setMemoryGroups([]);
      return;
    }

    const groupMap: Record<string, PostType[]> = {};

    posts.forEach((p) => {
      const d = getPostDate(p);
      const y = d.getFullYear();
      const m = d.getMonth();
      const day = d.getDate();

      const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(
        day
      ).padStart(2, "0")}`;

      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(p);
    });

    const groups: MemoryGroup[] = Object.entries(groupMap)
      .map(([key, arr]) => {
        const sorted = [...arr].sort(
          (a, b) => getPostDate(b).getTime() - getPostDate(a).getTime()
        );
        const cover = sorted[0] || null;
        const sampleDate = cover ? getPostDate(cover) : new Date();
        const label = `${sampleDate.getDate()} ${
          monthNames[sampleDate.getMonth()]
        } ${sampleDate.getFullYear()}`;

        const title = buildMemoryTitle(sorted, label);

        return {
          id: key,
          title,
          dateLabel: label,
          postIds: sorted.map((p) => p.id),
          coverPost: cover,
        };
      })
      .sort((a, b) => (a.id < b.id ? 1 : -1));

    setMemoryGroups(groups);
  }, [posts]);

  // 4. RANDOM MEMORY
  useEffect(() => {
    if (!memoryGroups.length) {
      setRandomMemory(null);
      return;
    }
    const today = new Date();
    const seed =
      today.getFullYear() * 10000 +
      (today.getMonth() + 1) * 100 +
      today.getDate();
    const idx = seed % memoryGroups.length;
    setRandomMemory(memoryGroups[idx]);
  }, [memoryGroups]);

  // 5. MOMENTS + ON THIS DAY
  useEffect(() => {
    if (!posts.length) {
      setMoments([]);
      setOnThisDayPosts([]);
      return;
    }

    const today = new Date();
    const tMonth = today.getMonth();
    const tDate = today.getDate();

    const onThisDay: PostType[] = [];
    const monthMap: Record<string, PostType[]> = {};

    posts.forEach((p) => {
      const d = getPostDate(p);

      if (
        d.getMonth() === tMonth &&
        d.getDate() === tDate &&
        d.getFullYear() !== today.getFullYear()
      ) {
        onThisDay.push(p);
      }

      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
      if (!monthMap[monthKey]) monthMap[monthKey] = [];
      monthMap[monthKey].push(p);
    });

    onThisDay.sort(
      (a, b) => getPostDate(b).getTime() - getPostDate(a).getTime()
    );
    setOnThisDayPosts(onThisDay);

    const momentItems: MomentItem[] = [];
    const cityTitles: { key: string; title: string }[] = [
      { key: "kuala lumpur", title: "Trip to Kuala Lumpur" },
      { key: " kl ", title: "Trip to KL" },
      { key: "penang", title: "Penang memories" },
      { key: "ipoh", title: "Ipoh day" },
      { key: "cameron", title: "Cameron Highlands trip" },
      { key: "genting", title: "Genting trip" },
      { key: "melaka", title: "Melaka trip" },
      { key: "langkawi", title: "Langkawi escape" },
    ];

    Object.entries(monthMap).forEach(([key, arr]) => {
      if (arr.length < 5) return;

      const [yearStr, monthIndexStr] = key.split("-");
      const year = parseInt(yearStr, 10);
      const mIndex = parseInt(monthIndexStr, 10);

      const baseTitle = `${monthNames[mIndex]} ${year}`;

      const allText = arr
        .map((p) => {
          const data: any = p;
          const caption = (data.caption || "").toLowerCase();
          const hashtags = Array.isArray(data.hashtags)
            ? data.hashtags.join(" ").toLowerCase()
            : "";
          const loc = (
            data.locationName ||
            data.placeName ||
            ""
          ).toLowerCase();
          return `${caption} ${hashtags} ${loc}`;
        })
        .join(" ");

      let title = `${baseTitle} memories`;

      for (const c of cityTitles) {
        if (allText.includes(c.key)) {
          title = c.title;
          break;
        }
      }

      if (/trip|travel|vacation|holiday/.test(allText) && title === `${baseTitle} memories`) {
        title = `${monthNames[mIndex]} ${year} trip`;
      }

      const sortedArr = [...arr].sort(
        (a, b) => getPostDate(b).getTime() - getPostDate(a).getTime()
      );

      momentItems.push({
        id: key,
        title,
        coverPost: sortedArr[0] || null,
        postIds: sortedArr.map((p) => p.id),
      });
    });

    momentItems.sort((a, b) => (a.id < b.id ? 1 : -1));
    setMoments(momentItems);
  }, [posts]);

  if (!currentUser) {
    return (
      <Layout>
        <TopNav
          middleContent={<Text>Memory Album</Text>}
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
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Text>Please sign in to view your album.</Text>
        </View>
      </Layout>
    );
  }

  const sortedPosts = posts
    .slice()
    .sort((a, b) => getPostDate(b).getTime() - getPostDate(a).getTime());

  const timelineTranslateY = timelineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  return (
    <Layout>
      <TopNav
        middleContent={<Text>Memory Album</Text>}
        leftContent={
          <Ionicons name="chevron-back" size={20} color={primaryTextColor} />
        }
        leftAction={() => navigation.goBack()}
        rightContent={
          <Ionicons
            name={isDarkmode ? "sunny" : "moon"}
            size={20}
            color={primaryTextColor}
          />
        }
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />

      <View
        style={{
          flex: 1,
          backgroundColor: isDarkmode ? "#050608" : themeColor.white100,
        }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        >
          {/* PEOPLE + RANDOM MEMORIES */}
          <View style={{ marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 18,
                fontWeight: "bold",
                color: sectionTitleColor,
                marginBottom: 12,
              }}
            >
              People & memories
            </Text>

            {personAlbums.length === 0 && !randomMemory ? (
              <Text style={{ color: subTextColor }}>
                No memories yet. Try uploading a few photos first.
              </Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {personAlbums.map((pa) => {
                  const coverUrl = pa.coverPost
                    ? getPostThumb(pa.coverPost)
                    : undefined;
                  return (
                    <TouchableOpacity
                      key={pa.name.toLowerCase()}
                      style={{ marginRight: 16, alignItems: "center" }}
                      onPress={() => {
                        if (pa.coverPost) {
                          navigation.navigate("MemoryPostView", {
                            postId: pa.coverPost.id,
                          });
                        }
                      }}
                    >
                      <View
                        style={{
                          width: 80,
                          height: 80,
                          borderRadius: 40,
                          overflow: "hidden",
                          backgroundColor: cardBg,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {coverUrl ? (
                          <Image
                            source={{ uri: coverUrl }}
                            style={{ width: "100%", height: "100%" }}
                            resizeMode="cover"
                          />
                        ) : (
                          <Ionicons
                            name="person"
                            size={32}
                            color={subTextColor}
                          />
                        )}
                      </View>
                      <Text
                        style={{
                          marginTop: 6,
                          fontSize: 14,
                          fontWeight: "600",
                          color: primaryTextColor,
                        }}
                        numberOfLines={1}
                      >
                        {pa.name}
                      </Text>
                      <Text style={{ fontSize: 12, color: subTextColor }}>
                        {pa.postIds.length} memories
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {randomMemory && randomMemory.coverPost && (
                  <TouchableOpacity
                    style={{ marginRight: 16, alignItems: "center" }}
                    onPress={() => {
                      navigation.navigate("MemoryPostView", {
                        postId: randomMemory.coverPost!.id,
                      });
                    }}
                  >
                    <View
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: 40,
                        overflow: "hidden",
                        backgroundColor: cardBg,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Image
                        source={{
                          uri: getPostThumb(randomMemory.coverPost!),
                        }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                      />
                    </View>
                    <Text
                      style={{
                        marginTop: 6,
                        fontSize: 14,
                        fontWeight: "600",
                        color: primaryTextColor,
                      }}
                      numberOfLines={1}
                    >
                      Memories
                    </Text>
                    <Text style={{ fontSize: 12, color: subTextColor }}>
                      Random today
                    </Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </View>

          {/* ON THIS DAY */}
          {onThisDayPosts.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: "bold",
                  color: sectionTitleColor,
                  marginBottom: 12,
                }}
              >
                On this day
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {onThisDayPosts.map((p) => {
                  const d = getPostDate(p);
                  const thumb = getPostThumb(p);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={{
                        marginRight: 16,
                        borderRadius: 16,
                        overflow: "hidden",
                        backgroundColor: cardBg,
                        width: 200,
                      }}
                      onPress={() =>
                        navigation.navigate("MemoryPostView", { postId: p.id })
                      }
                    >
                      {thumb && (
                        <Image
                          source={{ uri: thumb }}
                          style={{ width: "100%", height: 110 }}
                          resizeMode="cover"
                        />
                      )}
                      <View style={{ padding: 10 }}>
                        <Text
                          style={{
                            fontSize: 12,
                            color: subTextColor,
                            marginBottom: 2,
                          }}
                        >
                          {d.getDate()} {monthNames[d.getMonth()]}{" "}
                          {d.getFullYear()}
                        </Text>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "600",
                            color: primaryTextColor,
                          }}
                          numberOfLines={2}
                        >
                          {(p as any).caption || "Memory from past years"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* MOMENTS */}
          {moments.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: "bold",
                  color: sectionTitleColor,
                  marginBottom: 12,
                }}
              >
                Moments
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {moments.map((m) => {
                  const coverUrl = m.coverPost
                    ? getPostThumb(m.coverPost)
                    : undefined;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={{
                        marginRight: 16,
                        borderRadius: 16,
                        overflow: "hidden",
                        backgroundColor: cardBg,
                        width: 220,
                      }}
                      onPress={() => {
                        if (m.coverPost) {
                          navigation.navigate("MemoryPostView", {
                            postId: m.coverPost.id,
                          });
                        }
                      }}
                    >
                      {coverUrl && (
                        <Image
                          source={{ uri: coverUrl }}
                          style={{ width: "100%", height: 130 }}
                          resizeMode="cover"
                        />
                      )}
                      <View style={{ padding: 10 }}>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "700",
                            color: primaryTextColor,
                            marginBottom: 4,
                          }}
                          numberOfLines={2}
                        >
                          {m.title}
                        </Text>
                        <Text style={{ fontSize: 12, color: subTextColor }}>
                          {m.postIds.length} photos
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* MEMORIES TIMELINE */}
          <View style={{ marginTop: 10 }}>
            <Text
              style={{
                fontSize: 18,
                fontWeight: "bold",
                color: sectionTitleColor,
                marginBottom: 12,
              }}
            >
              Memories timeline
            </Text>

            {!sortedPosts.length ? (
              <Text style={{ color: subTextColor }}>
                No memories yet. Try uploading a few photos first.
              </Text>
            ) : (
              // container for vertical line + all items
              <View
                style={{
                  position: "relative",
                  paddingLeft: 40, // space for dots and line
                }}
              >
                {/* vertical timeline line (now has full height) */}
                <View
                  style={{
                    position: "absolute",
                    left: 18, // roughly center under 16px dot
                    top: 0,
                    bottom: 0,
                    width: 4,
                    backgroundColor: timelineLineColor,
                    borderRadius: 2,
                  }}
                />

                {/* RIGHT COLUMN WITH ANIMATION */}
                <Animated.View
                  style={{
                    opacity: timelineAnim,
                    transform: [{ translateY: timelineTranslateY }],
                  }}
                >
                  {(() => {
                    let lastYear = -1;
                    let lastMonthKey = "";
                    return sortedPosts.map((p) => {
                      const d = getPostDate(p);
                      const year = d.getFullYear();
                      const monthKey = `${year}-${d.getMonth()}`;
                      const monthLabel = `${monthNames[d.getMonth()]} ${year}`;

                      const showYear = year !== lastYear;
                      const showMonth = monthKey !== lastMonthKey;

                      lastYear = year;
                      lastMonthKey = monthKey;

                      const thumb = getPostThumb(p);

                      return (
                        <View key={p.id} style={{ marginBottom: 26 }}>
                          {showYear && (
                            <Text
                              style={{
                                fontSize: 16,
                                fontWeight: "700",
                                color: sectionTitleColor,
                                marginBottom: 4,
                              }}
                            >
                              {year}
                            </Text>
                          )}

                          {showMonth && (
                            <Text
                              style={{
                                marginBottom: 6,
                                fontSize: 14,
                                fontWeight: "600",
                                color: sectionTitleColor,
                              }}
                            >
                              {monthLabel}
                            </Text>
                          )}

                          <View style={{ flexDirection: "row" }}>
                            {/* DOT column */}
                            <View
                              style={{
                                width: 40,
                                alignItems: "center",
                              }}
                            >
                              <View
                                style={{
                                  width: 16,
                                  height: 16,
                                  backgroundColor: timelineDotColor,
                                  borderRadius: 8,
                                  borderWidth: 3,
                                  borderColor: isDarkmode
                                    ? "#0f172a"
                                    : "#e5e7eb",
                                }}
                              />
                            </View>

                            {/* CARD: image + bottom overlay bar */}
                            <TouchableOpacity
                              onPress={() =>
                                navigation.navigate("MemoryPostView", {
                                  postId: p.id,
                                })
                              }
                              style={{
                                flex: 1,
                                borderRadius: 18,
                                overflow: "hidden",
                                backgroundColor: cardBg,
                              }}
                            >
                              <View style={{ position: "relative" }}>
                                {thumb && (
                                  <Image
                                    source={{ uri: thumb }}
                                    style={{
                                      width: "100%",
                                      height: 190,
                                    }}
                                    resizeMode="cover"
                                  />
                                )}

                                {/* bottom semi-transparent caption bar */}
                                <View
                                  style={{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    paddingHorizontal: 14,
                                    paddingVertical: 10,
                                    backgroundColor: "rgba(15,23,42,0.92)",
                                  }}
                                >
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      color: "#e5e7eb",
                                      marginBottom: 2,
                                    }}
                                  >
                                    {d.getDate()} {monthNames[d.getMonth()]}{" "}
                                    {d.getFullYear()}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 14,
                                      fontWeight: "700",
                                      color: "#f9fafb",
                                    }}
                                    numberOfLines={1}
                                  >
                                    {(p as any).caption || "Memory"}
                                  </Text>
                                </View>
                              </View>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    });
                  })()}
                </Animated.View>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
      <MemoryFloatingMenu navigation={navigation as any} />
    </Layout>
  );
}
