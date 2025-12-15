// src/screens/MemoryBook/MemoryAlbum.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  Animated,
  Easing,
  FlatList,
  Modal,
  Alert,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  Button,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";

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
  doc,
  setDoc,
} from "firebase/firestore";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

import MemoryFloatingMenu from "./MemoryFloatingMenu";
import { PostType } from "./B2PostCard";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryAlbum">;

type MediaItem = {
  id: string;
  postId: string;
  uri: string;
  type: "image" | "video";
  createdAt?: any;
  caption?: string;
};

interface PersonAlbum {
  key: string;
  name: string;
  postIds: string[];
  coverPost: PostType | null;
}

interface LocationAlbum {
  id: string;
  placeTitle: string;
  rangeLabel: string;
  postIds: string[];
  coverPost: PostType | null;
  rawLabel: string;
}

const monthNames = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function getPostDate(p: PostType): Date {
  const createdAt: any = (p as any).createdAt;
  if (createdAt?.toDate) return createdAt.toDate();
  if (createdAt?.seconds) return new Date(createdAt.seconds * 1000);
  return new Date();
}

function isVideoPost(post: any): boolean {
  const mt = String(post?.mediaType || "").toLowerCase();
  const mts = Array.isArray(post?.mediaTypes) ? post.mediaTypes : [];
  if (mt === "video") return true;
  return mts.some((t: any) => String(t).toLowerCase() === "video");
}

// Return FIRST media url (image or video)
function getFirstMediaUrl(post: any): string | undefined {
  if (Array.isArray(post?.mediaUrls) && post.mediaUrls.length > 0) return post.mediaUrls[0];
  if (typeof post?.mediaUrl === "string" && post.mediaUrl) return post.mediaUrl;
  return undefined;
}

// ------------- Location grouping helpers -------------
function extractLocationRaw(p: any): string {
  return String(p?.locationLabel || p?.locationName || p?.placeName || "").trim();
}

function normalizeLocationKey(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .replace(/\s*,\s*/g, ",")
    .slice(0, 140);
}

function prettyPlaceTitle(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "Unknown place";
  const first = s.split(",")[0]?.trim();
  return first || s;
}

function fmtDayMonthYear(d: Date) {
  return `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtRange(minD: Date, maxD: Date) {
  if (
    minD.getFullYear() === maxD.getFullYear() &&
    minD.getMonth() === maxD.getMonth() &&
    minD.getDate() === maxD.getDate()
  ) {
    return fmtDayMonthYear(minD);
  }
  return `${fmtDayMonthYear(minD)} – ${fmtDayMonthYear(maxD)}`;
}

// ✅ Build swipe media list from posts (supports multi & single)
function buildMediaFromPosts(posts: PostType[]): MediaItem[] {
  const out: MediaItem[] = [];

  posts.forEach((p: any) => {
    const postId = p.id;
    const caption = p.caption || "";
    const createdAt = p.createdAt;

    // multi
    if (Array.isArray(p.mediaUrls) && p.mediaUrls.length > 0) {
      const types = Array.isArray(p.mediaTypes) ? p.mediaTypes : [];
      p.mediaUrls.forEach((u: string, idx: number) => {
        const rawT = String(types[idx] || p.mediaType || "image").toLowerCase();
        out.push({
          id: `${postId}_${idx}`,
          postId,
          uri: u,
          type: rawT === "video" ? "video" : "image",
          createdAt,
          caption,
        });
      });
      return;
    }

    // single
    if (typeof p.mediaUrl === "string" && p.mediaUrl) {
      const rawT = String(p.mediaType || "image").toLowerCase();
      out.push({
        id: `${postId}_0`,
        postId,
        uri: p.mediaUrl,
        type: rawT === "video" ? "video" : "image",
        createdAt,
        caption,
      });
    }
  });

  return out;
}

// ---------------- Thumbnail helpers ----------------
async function safeGetVideoThumbnail(videoUrl: string) {
  // try multiple timestamps because some videos have black first frame
  const times = [200, 800, 1500];
  for (const t of times) {
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(videoUrl, { time: t });
      if (uri) return uri;
    } catch {}
  }
  return "";
}

export default function MemoryAlbum({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const firestore = getFirestore();
  const storage = getStorage();
  const auth = getAuth();
  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || "";

  const [posts, setPosts] = useState<PostType[]>([]);
  const [personAlbums, setPersonAlbums] = useState<PersonAlbum[]>([]);
  const [onThisDayPosts, setOnThisDayPosts] = useState<PostType[]>([]);
  const [locationAlbums, setLocationAlbums] = useState<LocationAlbum[]>([]);

  const [peopleCoverCustom, setPeopleCoverCustom] = useState<Record<string, string>>({});
  const [peopleCoverMap, setPeopleCoverMap] = useState<Record<string, string>>({});

  // ensure video covers have thumbs when no custom cover
  useEffect(() => {
    personAlbums.forEach((pa) => {
      if (!peopleCoverCustom[pa.key] && pa.coverPost && isVideoPost(pa.coverPost)) {
        ensureThumbForPost(pa.coverPost);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personAlbums, peopleCoverCustom]);

  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const [coverTarget, setCoverTarget] = useState<PersonAlbum | null>(null);

  // ✅ thumbnail cache (postId -> thumbUri)
  const [videoThumbMap, setVideoThumbMap] = useState<Record<string, string>>({});
  const pendingThumbsRef = useRef<Set<string>>(new Set());

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

  // ✅ ensure thumb for a post (only first media)
  const ensureThumbForPost = async (p: any) => {
    const postId = String(p?.id || "");
    if (!postId) return;

    if (videoThumbMap[postId]) return;
    if (pendingThumbsRef.current.has(postId)) return;

    const isVideo = isVideoPost(p);
    if (!isVideo) return;

    const url = getFirstMediaUrl(p);
    if (!url) return;

    pendingThumbsRef.current.add(postId);

    const thumb = await safeGetVideoThumbnail(url);

    pendingThumbsRef.current.delete(postId);

    if (!thumb) return;

    setVideoThumbMap((prev) => {
      if (prev[postId]) return prev;
      return { ...prev, [postId]: thumb };
    });
  };

  // ✅ unified cover uri for ANY post (image or video)
  const getCoverUriForPost = (p: any): string | undefined => {
    if (!p) return undefined;
    if (isVideoPost(p)) {
      return videoThumbMap[String(p.id || "")] || undefined;
    }
    return getFirstMediaUrl(p);
  };

  // ✅ OPEN SWIPE VIEWER
  const openSwipeViewer = (
    postsForViewer: PostType[],
    startPostId?: string,
    title?: string
  ) => {
    const media = buildMediaFromPosts(postsForViewer);
    if (!media.length) return;

    let startIndex = 0;
    if (startPostId) {
      const found = media.findIndex((m) => m.postId === startPostId);
      startIndex = found >= 0 ? found : 0;
    }

    navigation.navigate("MemoryMediaViewer", {
      media,
      startIndex,
      title: title || "Memory",
    } as any);
  };

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

  // 1.5) LOAD people cover map from user doc
  useEffect(() => {
    if (!uid) return;

    const userRef = doc(firestore, "users", uid);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        const data: any = snap.data() || {};
        const map = data?.peopleCoverPostIds;
        if (map && typeof map === "object") setPeopleCoverMap(map);
        else setPeopleCoverMap({});

        const customMap = data?.peopleCoverCustomUrls;
        if (customMap && typeof customMap === "object") setPeopleCoverCustom(customMap);
        else setPeopleCoverCustom({});
      },
      () => {
        setPeopleCoverMap({});
        setPeopleCoverCustom({});
      }
    );

    return () => unsub();
  }, [uid, firestore]);

  // ✅ Pre-generate thumbnails for visible sections (so no more grey)
  useEffect(() => {
    if (!posts.length) return;
    const videos = posts.filter((p: any) => isVideoPost(p));
    // limit to avoid heavy work
    videos.slice(0, 35).forEach((p: any) => {
      ensureThumbForPost(p);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts.length]);

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

    const albums: PersonAlbum[] = Object.entries(buckets)
      .map(([key, b]) => {
        const sorted = [...b.posts].sort(
          (a, c) => getPostDate(c).getTime() - getPostDate(a).getTime()
        );

        const overridePostId = peopleCoverMap?.[key];
        const override = overridePostId ? sorted.find((p) => p.id === overridePostId) : null;

        return {
          key,
          name: b.displayName,
          postIds: sorted.map((p) => p.id),
          coverPost: override || sorted[0] || null,
        };
      })
      .sort((a, b) => b.postIds.length - a.postIds.length);

    setPersonAlbums(albums);
  }, [posts, currentUser, peopleCoverMap]);

  // 3) LOCATION ALBUMS
  useEffect(() => {
    if (!posts.length) {
      setLocationAlbums([]);
      return;
    }

    const map: Record<string, { raw: string; posts: PostType[] }> = {};

    posts.forEach((p: any) => {
      const raw = extractLocationRaw(p);
      if (!raw) return;
      const key = normalizeLocationKey(raw);
      if (!key) return;

      if (!map[key]) map[key] = { raw, posts: [] };
      map[key].posts.push(p);
    });

    const albums: LocationAlbum[] = Object.entries(map)
      .map(([key, v]) => {
        const sorted = [...v.posts].sort(
          (a, b) => getPostDate(b).getTime() - getPostDate(a).getTime()
        );

        const newest = sorted[0] || null;
        const times = sorted.map((p) => getPostDate(p).getTime()).sort((a, b) => a - b);

        const minD = new Date(times[0]);
        const maxD = new Date(times[times.length - 1]);

        return {
          id: key,
          rawLabel: v.raw,
          placeTitle: prettyPlaceTitle(v.raw),
          rangeLabel: fmtRange(minD, maxD),
          postIds: sorted.map((p) => p.id),
          coverPost: newest,
        };
      })
      .sort((a, b) => b.postIds.length - a.postIds.length);

    setLocationAlbums(albums);
  }, [posts]);

  // 4) ON THIS DAY
  useEffect(() => {
    if (!posts.length) {
      setOnThisDayPosts([]);
      return;
    }

    const today = new Date();
    const tMonth = today.getMonth();
    const tDate = today.getDate();

    const onThisDay: PostType[] = [];

    posts.forEach((p) => {
      const d = getPostDate(p);
      if (d.getMonth() === tMonth && d.getDate() === tDate && d.getFullYear() !== today.getFullYear()) {
        onThisDay.push(p);
      }
    });

    onThisDay.sort((a, b) => getPostDate(b).getTime() - getPostDate(a).getTime());
    setOnThisDayPosts(onThisDay);
  }, [posts]);

  // Save new people cover
  const savePeopleCover = async (personKey: string, postId: string) => {
    if (!uid) return;
    try {
      const userRef = doc(firestore, "users", uid);
      await setDoc(userRef, { peopleCoverPostIds: { [personKey]: postId } }, { merge: true });
    } catch (e) {
      console.log("savePeopleCover error:", e);
      Alert.alert("Save failed", "Could not save people cover. Please check Firestore rules.");
    }
  };

  const savePeopleCoverCustom = async (personKey: string, url: string) => {
    if (!uid) return;
    try {
      const userRef = doc(firestore, "users", uid);
      await setDoc(userRef, { peopleCoverCustomUrls: { [personKey]: url } }, { merge: true });
    } catch (e) {
      console.log("savePeopleCoverCustom error:", e);
      Alert.alert("Save failed", "Could not save people cover. Please check Firestore rules.");
    }
  };

  // Local-only cover from gallery
  const pickCoverFromGallery = async (personKey: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo access to choose a cover.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.length) return;
    const uri = result.assets[0].uri;
    if (!uri) return;

    try {
      const blob = await (await fetch(uri)).blob();
      const filename = `people_covers/${uid}/${personKey}-${Date.now()}.jpg`;
      const ref = storageRef(storage, filename);
      await uploadBytes(ref, blob);
      const downloadURL = await getDownloadURL(ref);

      setPeopleCoverCustom((prev) => ({ ...prev, [personKey]: downloadURL }));
      await savePeopleCoverCustom(personKey, downloadURL);
    } catch (e: any) {
      console.log("pickCoverFromGallery upload error:", e);
      Alert.alert("Upload failed", "Could not upload cover image.");
    }
  };

  if (!currentUser) {
    return (
      <Layout>
        <TopNav
          middleContent={<Text>Memory Album</Text>}
          leftContent={<Ionicons name="chevron-back" size={20} color={themeColor.white100} />}
          leftAction={() => navigation.popToTop()}
          rightContent={<Ionicons name={isDarkmode ? "sunny" : "moon"} size={20} color={themeColor.white100} />}
          rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
        />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text>Please sign in to view your album.</Text>
        </View>
      </Layout>
    );
  }

  const sortedPosts = posts.slice().sort((a, b) => getPostDate(b).getTime() - getPostDate(a).getTime());

  const timelineTranslateY = timelineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  // All Photos grid
  const gridData = sortedPosts.filter((p: any) => !!getFirstMediaUrl(p));
  const numColumns = 3;
  const screenW = Dimensions.get("window").width;
  const gridSidePadding = 14;
  const gridGap = 6;
  const thumbSize =
    (screenW - gridSidePadding * 2 - gridGap * (numColumns - 1)) / numColumns;

  // media list for viewer
  const mediaList = useMemo(() => {
    return gridData.flatMap((p: any) => {
      const urls =
        Array.isArray(p.mediaUrls) && p.mediaUrls.length ? p.mediaUrls :
        p.mediaUrl ? [p.mediaUrl] : [];

      const typesRaw =
        Array.isArray(p.mediaTypes) && p.mediaTypes.length === urls.length
          ? p.mediaTypes
          : urls.map(() => p.mediaType || "image");

      return urls.map((uri: string, idx: number) => {
        const t = typesRaw[idx] || "image";
        const normType =
          typeof t === "string" && t.toLowerCase().startsWith("video") ? "video" : "image";
        return {
          id: `${p.id}-${idx}`,
          postId: p.id,
          uri,
          type: normType as "image" | "video",
          createdAt: p.createdAt,
          caption: p.caption || "",
        };
      });
    });
  }, [gridData]);

  const mediaStartIndexByPost = useMemo(() => {
    const map: Record<string, number> = {};
    mediaList.forEach((m, idx) => {
      if (map[m.postId] === undefined) map[m.postId] = idx;
    });
    return map;
  }, [mediaList]);

  const openInViewer = (postId: string, title?: string) => {
    const startIndex = mediaStartIndexByPost[postId] !== undefined ? mediaStartIndexByPost[postId] : 0;
    navigation.navigate("MemoryMediaViewer", { media: mediaList, startIndex, title } as any);
  };

  // ---------- Reusable card thumb ----------
  const MediaCover = ({
    post,
    style,
  }: {
    post: any;
    style: any;
  }) => {
    const isVideo = isVideoPost(post);
    const coverUri = getCoverUriForPost(post);

    useEffect(() => {
      if (isVideo) ensureThumbForPost(post);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [post?.id]);

    return (
      <View style={[{ backgroundColor: cardBg, overflow: "hidden" }, style]}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            {isVideo ? (
              <ActivityIndicator />
            ) : (
              <Ionicons name="image" size={26} color={subTextColor} />
            )}
          </View>
        )}

        {isVideo && (
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
      </View>
    );
  };

  const GridItem = ({ item }: { item: PostType }) => {
    return (
      <TouchableOpacity
        style={{
          width: thumbSize,
          height: thumbSize,
          borderRadius: 10,
          marginBottom: gridGap,
        }}
        activeOpacity={0.9}
        onPress={() => openInViewer(item.id, "All Photos")}
      >
        <MediaCover post={item} style={{ width: "100%", height: "100%", borderRadius: 10 }} />
      </TouchableOpacity>
    );
  };

  // cover picker modal grid
  const coverPickerPosts: PostType[] = useMemo(() => {
    if (!coverTarget) return [];
    const setIds = new Set(coverTarget.postIds);
    return posts
      .filter((p) => setIds.has(p.id))
      .filter((p: any) => !!getFirstMediaUrl(p))
      .sort((a, b) => getPostDate(b).getTime() - getPostDate(a).getTime());
  }, [coverTarget, posts]);

  return (
    <Layout>
      <TopNav
        middleContent={<Text>Memory Album</Text>}
        leftContent={<Ionicons name="chevron-back" size={20} color={primaryTextColor} />}
        leftAction={() => navigation.popToTop()}
        rightContent={<Ionicons name={isDarkmode ? "sunny" : "moon"} size={20} color={primaryTextColor} />}
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />

      <View style={{ flex: 1, backgroundColor: isDarkmode ? "#050608" : themeColor.white100 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
          {/* 1) ON THIS DAY */}
          {onThisDayPosts.length > 0 && (
            <View style={{ marginBottom: 22 }}>
              <Text style={{ fontSize: 18, fontWeight: "bold", color: primaryTextColor, marginBottom: 12 }}>
                On this day
              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {onThisDayPosts.map((p) => {
                  const d = getPostDate(p);
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
                      onPress={() => openSwipeViewer(onThisDayPosts, p.id, "On this day")}
                      activeOpacity={0.9}
                    >
                      <MediaCover post={p} style={{ width: "100%", height: 110 }} />

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

          {/* 2) PLACES */}
          {locationAlbums.length > 0 && (
            <View style={{ marginBottom: 22 }}>
              <Text style={{ fontSize: 18, fontWeight: "bold", color: primaryTextColor, marginBottom: 12 }}>
                Places
              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {locationAlbums.map((a) => {
                  const placeSet = new Set(a.postIds);
                  const placePosts = posts
                    .filter((p) => placeSet.has(p.id))
                    .sort((x, y) => getPostDate(y).getTime() - getPostDate(x).getTime());

                  const coverPost = a.coverPost;

                  return (
                    <TouchableOpacity
                      key={a.id}
                      style={{
                        marginRight: 16,
                        borderRadius: 18,
                        overflow: "hidden",
                        backgroundColor: cardBg,
                        width: 260,
                        height: 320,
                      }}
                      onPress={() => openSwipeViewer(placePosts, coverPost?.id, a.placeTitle)}
                      activeOpacity={0.9}
                    >
                      {coverPost ? (
                        <MediaCover post={coverPost} style={{ width: "100%", height: "100%" }} />
                      ) : (
                        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="location" size={30} color={subTextColor} />
                        </View>
                      )}

                      <View
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: 0,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          backgroundColor: "rgba(0,0,0,0.45)",
                        }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: "800", color: "#fff" }} numberOfLines={1}>
                          {a.placeTitle}
                        </Text>
                        <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 }} numberOfLines={1}>
                          {a.rangeLabel}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* 3) PEOPLE */}
          <View style={{ marginBottom: 22 }}>
            <Text style={{ fontSize: 18, fontWeight: "bold", color: primaryTextColor, marginBottom: 12 }}>
              People
            </Text>

            {personAlbums.length === 0 ? (
              <Text style={{ color: subTextColor }}>No people tags yet. Try tagging friends.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {personAlbums.map((pa) => {
                  const coverUrl =
                    peopleCoverCustom[pa.key] ||
                    (pa.coverPost ? getCoverUriForPost(pa.coverPost) : undefined);

                  const idSet = new Set(pa.postIds);
                  const personPosts = posts
                    .filter((p) => idSet.has(p.id))
                    .sort((x, y) => getPostDate(y).getTime() - getPostDate(x).getTime());

                    return (
                      <TouchableOpacity
                        key={pa.key}
                        style={{ marginRight: 16, alignItems: "center" }}
                      onPress={() => openSwipeViewer(personPosts, pa.coverPost?.id, pa.name)}
                      onLongPress={() => {
                        Alert.alert("Change cover", `Choose cover for ${pa.name}`, [
                          { text: "Pick from gallery", onPress: () => pickCoverFromGallery(pa.key) },
                          {
                            text: "Choose from posts",
                            onPress: () => {
                              setCoverTarget(pa);
                              setCoverModalOpen(true);
                            },
                          },
                          { text: "Cancel", style: "cancel" },
                        ]);
                      }}
                      delayLongPress={320}
                      activeOpacity={0.9}
                    >
                      <View
                        style={{
                          width: 82,
                          height: 82,
                          borderRadius: 41,
                          overflow: "hidden",
                          backgroundColor: cardBg,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {coverUrl ? (
                          <Image source={{ uri: coverUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                        ) : (
                          <Ionicons name="person" size={34} color={subTextColor} />
                        )}
                      </View>

                      <Text
                        style={{
                          marginTop: 8,
                          fontSize: 14,
                          fontWeight: "700",
                          color: primaryTextColor,
                          maxWidth: 92,
                          textAlign: "center",
                        }}
                        numberOfLines={1}
                      >
                        {pa.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {personAlbums.length > 0 && (
              <Text style={{ marginTop: 8, fontSize: 12, color: subTextColor }}>
                Long press a person to change cover.
              </Text>
            )}
          </View>

          {/* 4) ALL PHOTOS */}
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
                scrollEnabled={false}
                renderItem={({ item }) => <GridItem item={item} />}
                contentContainerStyle={{ paddingHorizontal: gridSidePadding, paddingBottom: 6 }}
                columnWrapperStyle={{ justifyContent: "space-between" }}
              />
            )}
          </View>

          {/* 5) TIMELINE */}
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

                <Animated.View style={{ opacity: timelineAnim, transform: [{ translateY: timelineTranslateY }] }}>
                  {(() => {
                    let lastYear = -1;
                    let lastMonthKey = "";

                    return sortedPosts.map((p: any) => {
                      const d = getPostDate(p);
                      const year = d.getFullYear();
                      const monthKey = `${year}-${d.getMonth()}`;
                      const monthLabel = `${monthNames[d.getMonth()]} ${year}`;

                      const showYear = year !== lastYear;
                      const showMonth = monthKey !== lastMonthKey;

                      lastYear = year;
                      lastMonthKey = monthKey;

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
                              onPress={() => openSwipeViewer(sortedPosts, p.id, "Timeline")}
                              style={{
                                flex: 1,
                                borderRadius: 18,
                                overflow: "hidden",
                                backgroundColor: cardBg,
                              }}
                              activeOpacity={0.9}
                            >
                              <View style={{ position: "relative" }}>
                                <MediaCover post={p} style={{ width: "100%", height: 190 }} />

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

      {/* People cover picker modal */}
      <Modal
        visible={coverModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCoverModalOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", padding: 16, justifyContent: "center" }}>
          <View
            style={{
              borderRadius: 16,
              backgroundColor: isDarkmode ? "#0b1220" : "#fff",
              padding: 12,
              maxHeight: "80%",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "800", color: isDarkmode ? "#fff" : "#111" }}>
              Change cover
            </Text>
            <Text style={{ fontSize: 12, marginTop: 6, color: isDarkmode ? "#cbd5e1" : "#64748b" }}>
              {coverTarget?.name || "Person"} • Tap a photo to set as cover
            </Text>

            <View style={{ marginTop: 12, flex: 1 }}>
              {coverPickerPosts.length === 0 ? (
                <Text style={{ color: subTextColor }}>No photos available for cover.</Text>
              ) : (
                <FlatList
                  data={coverPickerPosts}
                  keyExtractor={(it) => it.id}
                  numColumns={3}
                  renderItem={({ item }) => {
                    const isVideo = isVideoPost(item);

                    useEffect(() => {
                      if (isVideo) ensureThumbForPost(item);
                      // eslint-disable-next-line react-hooks/exhaustive-deps
                    }, [item.id]);

                    const coverUri = getCoverUriForPost(item);

                    return (
                      <TouchableOpacity
                        onPress={async () => {
                          if (!coverTarget) return;
                          await savePeopleCover(coverTarget.key, item.id);
                          setCoverModalOpen(false);
                        }}
                        style={{
                          width: "32%",
                          aspectRatio: 1,
                          margin: "1%",
                          borderRadius: 10,
                          overflow: "hidden",
                          backgroundColor: cardBg,
                        }}
                        activeOpacity={0.9}
                      >
                        {coverUri ? (
                          <Image source={{ uri: coverUri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                        ) : (
                          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                            {isVideo ? <ActivityIndicator /> : <Ionicons name="image" size={22} color={subTextColor} />}
                          </View>
                        )}

                        {isVideo && (
                          <View
                            style={{
                              position: "absolute",
                              right: 6,
                              bottom: 6,
                              width: 22,
                              height: 22,
                              borderRadius: 11,
                              backgroundColor: "rgba(0,0,0,0.55)",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Ionicons name="play" size={12} color="#fff" />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </View>

            <View style={{ flexDirection: "row", marginTop: 10 }}>
              <Button text="Close" status="info" style={{ flex: 1 }} onPress={() => setCoverModalOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>

      <MemoryFloatingMenu navigation={navigation as any} />
    </Layout>
  );
}
