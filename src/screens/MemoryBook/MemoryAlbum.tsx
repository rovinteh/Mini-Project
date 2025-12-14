// src/screens/MemoryBook/MemoryAlbum.tsx
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  Animated,
  Easing,
  FlatList,
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

function getPostDate(p: PostType): Date {
  const createdAt: any = (p as any).createdAt;
  if (createdAt?.toDate) return createdAt.toDate();
  if (createdAt?.seconds) return new Date(createdAt.seconds * 1000);
  return new Date();
}

function getPostThumb(post: any): string | undefined {
  if (Array.isArray(post.mediaUrls) && post.mediaUrls.length > 0)
    return post.mediaUrls[0];
  if (typeof post.mediaUrl === "string") return post.mediaUrl;
  return undefined;
}

// --- iOS Photos feel: treat videos same thumbnail, just show play icon in grid later.
function isVideoPost(post: any): boolean {
  const mt = String(post?.mediaType || "").toLowerCase();
  const mts = Array.isArray(post?.mediaTypes) ? post.mediaTypes : [];
  if (mt === "video") return true;
  return mts.some((t: any) => String(t).toLowerCase() === "video");
}

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
        .flatMap((p: any) => (Array.isArray(p.friendTags) ? p.friendTags : []))
        .map((n: string) => n.trim())
        .filter((n: string) => n.length > 0)
    )
  );

  const hasFriends = allFriendTags.length > 0;
  const oneFriendName = allFriendTags.length === 1 ? allFriendTags[0] : null;

  if (/birthday|bday|🎂|cake/.test(text)) return "Birthday memories";
  if (/graduation|convocation/.test(text)) return "Graduation day";
  if (/trip|travel|vacation|holiday/.test(text)) return "Trip memories";
  if (/study|exam|assignment|library|revision/.test(text)) return "Study moments";
  if (/family/.test(text)) return "Family time";

  if (hasFriends) {
    if (oneFriendName) return `Day with ${oneFriendName}`;
    return "Moments with friends";
  }

  if (/selfie|my outfit|ootd|me today/.test(text)) return "Selfie moments";
  if (/street|walk|outdoor|city|sunny|park/.test(text)) return "Outdoor day";
  if (/dinner|lunch|brunch|supper|restaurant|food|snack/.test(text))
    return "Food moments";

  return `Moments of ${dateLabel}`;
}

// -------- Trip hashtag grouping helpers --------
function normalizeTag(t: string) {
  return String(t || "")
    .trim()
    .replace(/^#/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// Accept: TripGenting, trip_kl, trip-penang, tripcameronhighlands
function isTripTag(raw: string) {
  const t = normalizeTag(raw);
  return t.startsWith("trip");
}

function prettyTripTitleFromKey(key: string) {
  // key example: "tripgenting" / "trip_kl" / "trip-penang"
  const raw = key.replace(/^trip[-_]?/i, "");
  if (!raw) return "Trip";
  const words = raw
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([0-9])/gi, "$1 $2")
    .trim();
  const titled = words
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `Trip: ${titled}`;
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
  const [tripAlbums, setTripAlbums] = useState<MomentItem[]>([]);

  const primaryTextColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const subTextColor = isDarkmode ? "#cbd5e1" : "#64748b";
  const cardBg = isDarkmode ? themeColor.dark100 : "#e9edf2";

  const timelineLineColor = "#facc15";
  const timelineDotColor = "#fb923c";

  const timelineAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(timelineAnim, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [posts.length]);

  // ✅ CHANGE THIS to your laptop LAN IP when testing on phone
  // If you run app on same laptop emulator, 127.0.0.1 is ok.
  const AI_BASE_URL = "http://192.168.1.74:3000";

  // 1) LOAD POSTS
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

  // 2) PEOPLE ALBUMS
  useEffect(() => {
    if (!posts.length) {
      setPersonAlbums([]);
      return;
    }

    type PersonBucket = { displayName: string; posts: PostType[] };
    const buckets: Record<string, PersonBucket> = {};

    posts.forEach((p) => {
      const tags: string[] = Array.isArray((p as any).friendTags)
        ? (p as any).friendTags
        : [];
      tags.forEach((rawName) => {
        const name = (rawName || "").trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!buckets[key]) buckets[key] = { displayName: name, posts: [] };
        buckets[key].posts.push(p);
      });
    });

    // always include "Me" (like iOS Photos people)
    const meName = currentUser?.displayName?.trim() || "Me";
    const meKey = meName.toLowerCase();

    if (!buckets[meKey]) {
      buckets[meKey] = { displayName: meName, posts: [...posts] };
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

  // 3) DAILY GROUPS (yyyy-mm-dd)
  useEffect(() => {
    if (!posts.length) {
      setMemoryGroups([]);
      return;
    }

    const groupMap: Record<string, PostType[]> = {};

    posts.forEach((p) => {
      const d = getPostDate(p);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(d.getDate()).padStart(2, "0")}`;

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

  // ✅ 4) AI RANDOM MEMORY (ONLY THIS PART IS AI)
  useEffect(() => {
    const pickAiRandom = async () => {
      if (!memoryGroups.length) {
        setRandomMemory(null);
        return;
      }

      try {
        const payloadGroups = memoryGroups.slice(0, 80).map((g) => {
          const samplePost = posts.find((p) => p.id === g.postIds[0]);
          const sampleCaption = String((samplePost as any)?.caption || "");
          const hashtags = Array.isArray((samplePost as any)?.hashtags)
            ? (samplePost as any).hashtags
            : [];
          const friendTags = Array.isArray((samplePost as any)?.friendTags)
            ? (samplePost as any).friendTags
            : [];

          return {
            id: g.id,
            postCount: g.postIds.length,
            sampleCaption,
            hashtags,
            friendTags,
          };
        });

        const resp = await fetch(`${AI_BASE_URL}/ai/random-memory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groups: payloadGroups }),
        });

        const data = await resp.json();
        const selectedId = String(data?.selectedGroupId || "");

        const found = memoryGroups.find((g) => g.id === selectedId);
        if (found) {
          setRandomMemory(found);
          return;
        }

        setRandomMemory(
          memoryGroups[Math.floor(Math.random() * memoryGroups.length)]
        );
      } catch (e) {
        setRandomMemory(
          memoryGroups[Math.floor(Math.random() * memoryGroups.length)]
        );
      }
    };

    pickAiRandom();
  }, [memoryGroups, posts]);

  // ✅ NEW: 4.5) TRIPS (group by hashtags like #TripGenting, #trip_kl)
  useEffect(() => {
    if (!posts.length) {
      setTripAlbums([]);
      return;
    }

    const map: Record<string, PostType[]> = {};

    posts.forEach((p: any) => {
      const tags: string[] = Array.isArray(p.hashtags) ? p.hashtags : [];
      tags.forEach((raw) => {
        if (!isTripTag(raw)) return;
        const key = normalizeTag(raw); // "tripgenting"
        if (!map[key]) map[key] = [];
        map[key].push(p);
      });
    });

    const albums: MomentItem[] = Object.entries(map)
      .map(([key, arr]) => {
        const sorted = [...arr].sort(
          (a, b) => getPostDate(b).getTime() - getPostDate(a).getTime()
        );
        return {
          id: `trip-${key}`,
          title: prettyTripTitleFromKey(key),
          postIds: sorted.map((p) => p.id),
          coverPost: sorted[0] || null,
        };
      })
      .sort((a, b) => b.postIds.length - a.postIds.length);

    setTripAlbums(albums);
  }, [posts]);

  // 5) MOMENTS + ON THIS DAY
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
          const loc = (data.locationName || data.placeName || "").toLowerCase();
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

      if (
        /trip|travel|vacation|holiday/.test(allText) &&
        title === `${baseTitle} memories`
      ) {
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
            <Ionicons name="chevron-back" size={20} color={primaryTextColor} />
          }
          leftAction={() => navigation.popToTop()}
          rightContent={
            <Ionicons
              name={isDarkmode ? "sunny" : "moon"}
              size={20}
              color={primaryTextColor}
            />
          }
          rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
        />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
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

  // ✅ NEW: iOS-like "All Photos" grid (3 columns)
  const gridData = sortedPosts.filter((p) => !!getPostThumb(p));
  const numColumns = 3;
  const gap = 4;
  const thumbSize = 110; // simple fixed size (works fine for most phones)

  const GridItem = ({ item }: { item: PostType }) => {
    const thumb = getPostThumb(item);
    if (!thumb) return null;

    const video = isVideoPost(item);

    return (
      <TouchableOpacity
        onPress={() => navigation.navigate("MemoryPostView", { postId: item.id })}
        style={{
          width: thumbSize,
          height: thumbSize,
          margin: gap,
          borderRadius: 10,
          overflow: "hidden",
          backgroundColor: cardBg,
        }}
      >
        <Image
          source={{ uri: thumb }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />

        {video && (
          <View
            style={{
              position: "absolute",
              right: 6,
              bottom: 6,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: "rgba(0,0,0,0.55)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="play" size={14} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Layout>
      <TopNav
        middleContent={<Text>Memory Album</Text>}
        leftContent={
          <Ionicons name="chevron-back" size={20} color={primaryTextColor} />
        }
        leftAction={() => navigation.popToTop()}
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
          {/* 0) RANDOM TODAY (big card like iOS Memories) */}
          {randomMemory?.coverPost && (
            <TouchableOpacity
              onPress={() =>
                navigation.navigate("MemoryPostView", {
                  postId: randomMemory.coverPost!.id,
                })
              }
              style={{
                borderRadius: 18,
                overflow: "hidden",
                backgroundColor: cardBg,
                marginBottom: 18,
              }}
            >
              <Image
                source={{ uri: getPostThumb(randomMemory.coverPost!) }}
                style={{ width: "100%", height: 190 }}
                resizeMode="cover"
              />
              <View style={{ padding: 12 }}>
                <Text style={{ fontSize: 12, color: subTextColor, marginBottom: 4 }}>
                  Random today • {randomMemory.postIds.length} media
                </Text>
                <Text style={{ fontSize: 16, fontWeight: "800", color: primaryTextColor }} numberOfLines={1}>
                  {randomMemory.title || "Memory"}
                </Text>
                <Text style={{ fontSize: 12, color: subTextColor, marginTop: 2 }} numberOfLines={1}>
                  {randomMemory.dateLabel}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* 1) ON THIS DAY */}
          {onThisDayPosts.length > 0 && (
            <View style={{ marginBottom: 22 }}>
              <Text style={{ fontSize: 18, fontWeight: "bold", color: primaryTextColor, marginBottom: 12 }}>
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
                      onPress={() => navigation.navigate("MemoryPostView", { postId: p.id })}
                    >
                      {thumb && (
                        <Image
                          source={{ uri: thumb }}
                          style={{ width: "100%", height: 110 }}
                          resizeMode="cover"
                        />
                      )}
                      <View style={{ padding: 10 }}>
                        <Text style={{ fontSize: 12, color: subTextColor, marginBottom: 2 }}>
                          {d.getDate()} {monthNames[d.getMonth()]} {d.getFullYear()}
                        </Text>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: primaryTextColor }} numberOfLines={2}>
                          {(p as any).caption || "Memory from past years"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* 2) TRIPS (hashtag albums like #TripGenting) */}
          {tripAlbums.length > 0 && (
            <View style={{ marginBottom: 22 }}>
              <Text style={{ fontSize: 18, fontWeight: "bold", color: primaryTextColor, marginBottom: 12 }}>
                Trips
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {tripAlbums.map((t) => {
                  const coverUrl = t.coverPost ? getPostThumb(t.coverPost) : undefined;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={{
                        marginRight: 16,
                        borderRadius: 16,
                        overflow: "hidden",
                        backgroundColor: cardBg,
                        width: 220,
                      }}
                      onPress={() => {
                        if (t.coverPost) navigation.navigate("MemoryPostView", { postId: t.coverPost.id });
                      }}
                    >
                      {coverUrl ? (
                        <Image source={{ uri: coverUrl }} style={{ width: "100%", height: 130 }} resizeMode="cover" />
                      ) : (
                        <View style={{ width: "100%", height: 130, alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="airplane" size={28} color={subTextColor} />
                        </View>
                      )}
                      <View style={{ padding: 10 }}>
                        <Text style={{ fontSize: 14, fontWeight: "800", color: primaryTextColor }} numberOfLines={1}>
                          {t.title}
                        </Text>
                        <Text style={{ fontSize: 12, color: subTextColor }}>{t.postIds.length} media</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* 3) PEOPLE (iOS-like row) */}
          <View style={{ marginBottom: 22 }}>
            <Text style={{ fontSize: 18, fontWeight: "bold", color: primaryTextColor, marginBottom: 12 }}>
              People
            </Text>

            {personAlbums.length === 0 ? (
              <Text style={{ color: subTextColor }}>No people tags yet. Try tagging friends.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {personAlbums.map((pa) => {
                  const coverUrl = pa.coverPost ? getPostThumb(pa.coverPost) : undefined;
                  return (
                    <TouchableOpacity
                      key={pa.name.toLowerCase()}
                      style={{ marginRight: 16, alignItems: "center" }}
                      onPress={() => {
                        if (pa.coverPost) navigation.navigate("MemoryPostView", { postId: pa.coverPost.id });
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
                          <Ionicons name="person" size={32} color={subTextColor} />
                        )}
                      </View>
                      <Text style={{ marginTop: 6, fontSize: 14, fontWeight: "700", color: primaryTextColor }} numberOfLines={1}>
                        {pa.name}
                      </Text>
                      <Text style={{ fontSize: 12, color: subTextColor }}>{pa.postIds.length} media</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* 4) MOMENTS (monthly smart groups) */}
          {moments.length > 0 && (
            <View style={{ marginBottom: 22 }}>
              <Text style={{ fontSize: 18, fontWeight: "bold", color: primaryTextColor, marginBottom: 12 }}>
                Moments
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {moments.map((m) => {
                  const coverUrl = m.coverPost ? getPostThumb(m.coverPost) : undefined;
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
                        if (m.coverPost) navigation.navigate("MemoryPostView", { postId: m.coverPost.id });
                      }}
                    >
                      {coverUrl && (
                        <Image source={{ uri: coverUrl }} style={{ width: "100%", height: 130 }} resizeMode="cover" />
                      )}
                      <View style={{ padding: 10 }}>
                        <Text style={{ fontSize: 14, fontWeight: "800", color: primaryTextColor, marginBottom: 4 }} numberOfLines={2}>
                          {m.title}
                        </Text>
                        <Text style={{ fontSize: 12, color: subTextColor }}>{m.postIds.length} media</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* 5) ALL PHOTOS (iOS grid) */}
          <View style={{ marginBottom: 22 }}>
            <Text style={{ fontSize: 18, fontWeight: "bold", color: primaryTextColor, marginBottom: 12 }}>
              All Photos
            </Text>

            {!gridData.length ? (
              <Text style={{ color: subTextColor }}>No memories yet. Try uploading a few photos first.</Text>
            ) : (
              <FlatList
                data={gridData}
                keyExtractor={(item) => item.id}
                numColumns={numColumns}
                scrollEnabled={false} // IMPORTANT: keep it inside ScrollView
                renderItem={({ item }) => <GridItem item={item} />}
                contentContainerStyle={{ paddingBottom: 6 }}
              />
            )}
          </View>

          {/* 6) TIMELINE (keep your existing timeline) */}
          <View style={{ marginTop: 6 }}>
            <Text style={{ fontSize: 18, fontWeight: "bold", color: primaryTextColor, marginBottom: 12 }}>
              Memories timeline
            </Text>

            {!sortedPosts.length ? (
              <Text style={{ color: subTextColor }}>No memories yet. Try uploading a few photos first.</Text>
            ) : (
              <View style={{ position: "relative", paddingLeft: 40 }}>
                <View
                  style={{
                    position: "absolute",
                    left: 18,
                    top: 0,
                    bottom: 0,
                    width: 4,
                    backgroundColor: timelineLineColor,
                    borderRadius: 2,
                  }}
                />

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
                            <Text style={{ fontSize: 16, fontWeight: "700", color: primaryTextColor, marginBottom: 4 }}>
                              {year}
                            </Text>
                          )}

                          {showMonth && (
                            <Text style={{ marginBottom: 6, fontSize: 14, fontWeight: "600", color: primaryTextColor }}>
                              {monthLabel}
                            </Text>
                          )}

                          <View style={{ flexDirection: "row" }}>
                            <View style={{ width: 40, alignItems: "center" }}>
                              <View
                                style={{
                                  width: 16,
                                  height: 16,
                                  backgroundColor: timelineDotColor,
                                  borderRadius: 8,
                                  borderWidth: 3,
                                  borderColor: isDarkmode ? "#0f172a" : "#e5e7eb",
                                }}
                              />
                            </View>

                            <TouchableOpacity
                              onPress={() => navigation.navigate("MemoryPostView", { postId: p.id })}
                              style={{
                                flex: 1,
                                borderRadius: 18,
                                overflow: "hidden",
                                backgroundColor: cardBg,
                              }}
                            >
                              <View style={{ position: "relative" }}>
                                {thumb && (
                                  <Image source={{ uri: thumb }} style={{ width: "100%", height: 190 }} resizeMode="cover" />
                                )}

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
                                  <Text style={{ fontSize: 11, color: "#e5e7eb", marginBottom: 2 }}>
                                    {d.getDate()} {monthNames[d.getMonth()]} {d.getFullYear()}
                                  </Text>
                                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#f9fafb" }} numberOfLines={1}>
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
