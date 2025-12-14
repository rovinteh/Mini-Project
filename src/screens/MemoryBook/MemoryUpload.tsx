// src/screens/MyModule/MemoryUpload.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Image,
  Alert,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Modal,
} from "react-native";
import {
  Layout,
  TopNav,
  Text,
  Button,
  TextInput,
  useTheme,
  themeColor,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import MemoryFloatingMenu from "./MemoryFloatingMenu";
import { TextInput as RNTextInput } from "react-native";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  Timestamp,
  doc,
  updateDoc,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

// ✅ expo-video (new API)
import { useVideoPlayer, VideoView } from "expo-video";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryUpload">;

// For multiple selection
type SelectedMedia = {
  uri: string;
  type: "image" | "video";
  base64?: string | null;
};

// For place search (IG-style location search)
type PlaceOption = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

// ----- Face-recognition types -----
type FaceMatch = {
  name: string;
  distance: number;
};

type FaceMatchesPerFace = {
  faceIndex: number;
  matches: FaceMatch[];
};

type FaceRecognizeResponse = {
  ok?: boolean;
  faces: FaceMatchesPerFace[];
};

type FaceBatchItem = {
  index: number;
  ok?: boolean;
  faces: FaceMatchesPerFace[];
  error?: string;
};

type FaceBatchResponse = {
  ok: boolean;
  count: number;
  results: FaceBatchItem[];
};

// ✅ Album info stored under posts
type AlbumInfo = {
  id: string;
  name: string;
};

// ✅ Mood fields (still optional)
type MoodLabel = "happy" | "neutral" | "tired" | "sad" | "angry";
type MoodSource =
  | "ai"
  | "user"
  | "face"
  | "caption"
  | "face+caption"
  | "unknown";

function emojiFromMoodLabel(lbl: any): string {
  const x = String(lbl || "").toLowerCase();
  if (x === "happy") return "😊";
  if (x === "neutral") return "😐";
  if (x === "tired") return "😴";
  if (x === "sad") return "😢";
  if (x === "angry") return "😡";
  return "😐";
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    try {
      p.play();
    } catch {}
  });

  return (
    <View style={{ width: "100%", height: "100%", backgroundColor: "#000" }}>
      <VideoView
        player={player}
        style={{ width: "100%", height: "100%" }}
        allowsFullscreen
      />
      <View
        style={{
          position: "absolute",
          bottom: 10,
          left: 10,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 999,
          backgroundColor: "rgba(0,0,0,0.5)",
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Ionicons name="videocam" size={14} color="#fff" />
        <Text style={{ marginLeft: 6, fontSize: 11, color: "#fff" }}>
          Video
        </Text>
      </View>
    </View>
  );
}

// ✅ Small reusable "AI pill" (no image file needed)
function AIPill({ compact }: { compact?: boolean }) {
  return (
    <View
      style={[
        styles.aiPill,
        compact ? { paddingHorizontal: 8, paddingVertical: 4 } : null,
      ]}
    >
      <Ionicons
        name="sparkles-outline"
        size={compact ? 14 : 16}
        color="#fff"
        style={{ marginRight: 6 }}
      />
      <Text style={styles.aiText}>AI</Text>
    </View>
  );
}

// ✅ Label row with AI pill at right
function LabelWithAIPill({ label }: { label: string }) {
  return (
    <View style={styles.labelRow}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <AIPill compact />
    </View>
  );
}

export default function MemoryUpload({ navigation, route }: Props) {
  const theme = useTheme();
  const isDarkmode = !!theme.isDarkmode;

  const auth = getAuth();
  const firestore = getFirestore();
  const storage = getStorage();

  // ---- read params ----
  const params: any = route?.params || {};
  const editMode = params.editMode || false;
  const editingPostId: string | undefined = params.postId;
  const postData: any = params.postData || {};

  // ✅ albums passed in from Album screen (optional)
  const selectedAlbums: AlbumInfo[] = Array.isArray(params.selectedAlbums)
    ? params.selectedAlbums
    : [];

  // draft/keywords
  const [draft, setDraft] = useState("");

  // initial values if editing
  const initialCaption = editMode ? postData.caption || "" : "";
  const initialMediaUrls: string[] = editMode
    ? postData.mediaUrls || (postData.mediaUrl ? [postData.mediaUrl] : [])
    : [];
  const initialMediaTypes: ("image" | "video")[] = editMode
    ? postData.mediaTypes ||
      (postData.mediaType ? [postData.mediaType] : ["image"])
    : [];
  const initialIsStory = editMode ? !!postData.isStory : false;

  const initialHashtagsText = editMode
    ? Array.isArray(postData.hashtags)
      ? postData.hashtags.join(" ")
      : ""
    : "";

  const initialFriendTagsText = editMode
    ? Array.isArray(postData.friendTags)
      ? postData.friendTags.join(", ")
      : ""
    : "";

  // ✅ initial albums if editing
  const initialAlbumIds: string[] = editMode
    ? Array.isArray(postData.albumIds)
      ? postData.albumIds
      : []
    : [];
  const initialAlbums: AlbumInfo[] = editMode
    ? Array.isArray(postData.albums)
      ? postData.albums
      : []
    : [];

  // ✅ mood initial values (optional)
  const initialMoodLabel: MoodLabel = editMode
    ? (String(postData.moodLabel || "neutral").toLowerCase() as MoodLabel)
    : "neutral";
  const initialMoodSource: MoodSource = editMode
    ? (String(postData.moodSource || "unknown") as MoodSource)
    : "unknown";

  // ✅ IMPORTANT: emoji is now stored at TOP-LEVEL: postData.emoji
  const initialPostEmoji = editMode
    ? String(postData?.emoji || emojiFromMoodLabel(initialMoodLabel) || "😐")
    : emojiFromMoodLabel(initialMoodLabel);

  const [postEmoji, setPostEmoji] = useState<string>(initialPostEmoji);
  const [emojiEdited, setEmojiEdited] = useState<boolean>(editMode);

  // emoji picker modal
const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);

const emojiOptions = useMemo(
  () => [
    { emoji: "😊", label: "Happy" },
    { emoji: "😐", label: "Neutral" },
    { emoji: "😴", label: "Tired" },
    { emoji: "😢", label: "Sad" },
    { emoji: "😡", label: "Angry" },
  ],
  []
);


  // store ALL selected media here
  const [mediaItems, setMediaItems] = useState<SelectedMedia[]>(() =>
    initialMediaUrls.length
      ? initialMediaUrls.map((uri: string, idx: number) => ({
          uri,
          type: initialMediaTypes[idx] || "image",
          base64: null,
        }))
      : []
  );

  const [caption, setCaption] = useState(initialCaption);
  const [hashtagsText, setHashtagsText] = useState(initialHashtagsText);
  const [friendTagsText, setFriendTagsText] = useState(initialFriendTagsText);

  const [isStory, setIsStory] = useState(initialIsStory);
  const [isUploading, setIsUploading] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  // ✅ mood state (optional)
  const [moodLabel, setMoodLabel] = useState<MoodLabel>(initialMoodLabel);
  const [moodSource, setMoodSource] = useState<MoodSource>(initialMoodSource);

  // ✅ albums state
  const [albumIds, setAlbumIds] = useState<string[]>(
    selectedAlbums.length ? selectedAlbums.map((a) => a.id) : initialAlbumIds
  );
  const [albums, setAlbums] = useState<AlbumInfo[]>(
    selectedAlbums.length ? selectedAlbums : initialAlbums
  );

  // face-learning UI state
  const [faceName, setFaceName] = useState("");
  const [isSavingFace, setIsSavingFace] = useState(false);

  // 🔹 Location state
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Search state for IG-style place search
  const [locationQuery, setLocationQuery] = useState("");
  const [placeOptions, setPlaceOptions] = useState<PlaceOption[]>([]);
  const [isSearchingPlace, setIsSearchingPlace] = useState(false);

  // On real phone, change to "http://<YOUR_PC_IP>:3000"
  const LOCAL_AI_SERVER =
    ((process as any)?.env?.EXPO_PUBLIC_AI_SERVER as string) ||
    ((process as any)?.env?.AI_SERVER_URL as string) ||
    "http://192.168.1.74:3000";

  // -------------------------------------------------------
  // Location: auto-detect
  // -------------------------------------------------------
  const autoDetectLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Permission to access location was denied");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      const latitude = loc.coords.latitude;
      const longitude = loc.coords.longitude;

      setLocationCoords({ latitude, longitude });

      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1&accept-language=en`;
        const resp = await fetch(url, {
          headers: { "User-Agent": "memorybook-app" },
        });

        if (resp.ok) {
          const data = await resp.json();
          const addr = data.address || {};
          const parts = [
            addr.amenity,
            addr.road,
            addr.neighbourhood || addr.suburb,
            addr.city || addr.town || addr.village,
            addr.state,
            addr.country,
          ].filter(Boolean);
          const label =
            (parts.length ? parts.slice(0, 3).join(", ") : "") ||
            data.display_name ||
            null;
          setLocationLabel(label);
          setLocationError(null);
          return;
        }
      } catch (e) {
        console.log("Nominatim reverse error:", e);
      }

      try {
        const places = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });
        if (places && places.length > 0) {
          const p = places[0];
          const parts = [
            p.name,
            p.street,
            (p as any).subregion || (p as any).city,
            p.region,
            p.country,
          ].filter(Boolean);
          const label = parts.slice(0, 3).join(", ");
          setLocationLabel(label || null);
          setLocationError(null);
        }
      } catch (e) {
        console.log("Expo reverseGeocode error:", e);
        setLocationError("Could not fetch location.");
      }
    } catch (e) {
      console.log("Location error:", e);
      setLocationError("Could not fetch location.");
    }
  };

  useEffect(() => {
    autoDetectLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------
  // Search address
  // -------------------------------------------------------
  const searchAddress = async () => {
    const q = locationQuery.trim();
    if (!q) return;

    try {
      setIsSearchingPlace(true);
      setPlaceOptions([]);

      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        q
      )}&limit=5&addressdetails=1&accept-language=en`;

      const resp = await fetch(url, {
        headers: { "User-Agent": "memorybook-app" },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      const options: PlaceOption[] = data.map((item: any) => ({
        id: String(item.place_id),
        label: item.display_name || q,
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon),
      }));

      setPlaceOptions(options);
    } catch (e) {
      console.log("searchAddress error:", e);
      setLocationError("Failed to search address");
    } finally {
      setIsSearchingPlace(false);
    }
  };

  const handleSelectPlace = (place: PlaceOption) => {
    setLocationLabel(place.label);
    setLocationCoords({ latitude: place.latitude, longitude: place.longitude });
    setLocationQuery(place.label);
    setPlaceOptions([]);
  };

  // -------------------------------------------------------
  // Helper: call AI server
  // -------------------------------------------------------
  const callAiForPostMeta = async (
    captionDraft: string,
    imageBase64List: string[]
  ) => {
    const url = `${LOCAL_AI_SERVER}/generatePostMeta`;
    console.log("[CLIENT] calling:", url, "images:", imageBase64List.length);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captionDraft, imageBase64List }),
    });

    const text = await response.text();
    console.log(
      "[CLIENT] status:",
      response.status,
      "body:",
      text.slice(0, 300)
    );

    if (!response.ok) {
      throw new Error(`AI HTTP ${response.status}: ${text.slice(0, 120)}`);
    }

    const data = JSON.parse(text);
    return data as {
      caption: string;
      hashtags: string[];
      friendTags: string[];
      moodLabel?: MoodLabel | string;
      moodSource?: MoodSource | string;
      // (your server also returns moodScore but we don't need it anymore)
      moodScore?: number;
    };
  };

  // -------------------------------------------------------
  // Face calls
  // -------------------------------------------------------
  const callFaceRecognize = async (
    imageBase64: string,
    threshold?: number
  ): Promise<FaceRecognizeResponse | null> => {
    try {
      const resp = await fetch(`${LOCAL_AI_SERVER}/faces/recognize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, threshold }),
      });

      if (!resp.ok) {
        console.log("Face recognize HTTP error:", resp.status);
        return null;
      }

      const data = (await resp.json()) as FaceRecognizeResponse;
      return data;
    } catch (err) {
      console.log("Face recognize error:", err);
      return null;
    }
  };

  const callFaceRecognizeBatch = async (
    imageBase64List: string[],
    threshold?: number
  ): Promise<FaceBatchResponse | null> => {
    try {
      const resp = await fetch(`${LOCAL_AI_SERVER}/faces/recognize_batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64List, threshold }),
      });

      if (!resp.ok) {
        console.log("Face batch HTTP error:", resp.status);
        return null;
      }

      const data = (await resp.json()) as FaceBatchResponse;
      return data;
    } catch (err) {
      console.log("Face batch error:", err);
      return null;
    }
  };

  const callFaceRegister = async (name: string, imageBase64: string) => {
    const personId = name.trim().toLowerCase().replace(/\s+/g, "_");

    const resp = await fetch(`${LOCAL_AI_SERVER}/faces/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId, name, imageBase64 }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.log("Face register error body:", text);
      throw new Error(`Face register HTTP ${resp.status}`);
    }

    return await resp.json();
  };

  // -------------------------------------------------------
  // Remember-this-face handler
  // -------------------------------------------------------
  const handleRememberFace = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Error", "You need to be logged in.");
      return;
    }

    const name = faceName.trim();
    if (!name) {
      Alert.alert("Name needed", "Please type a name for this person first.");
      return;
    }

    const firstImage = mediaItems.find((m) => m.type === "image" && m.base64);
    if (!firstImage || !firstImage.base64) {
      Alert.alert(
        "No image data",
        "Please select a photo again so we can read the face."
      );
      return;
    }

    const FACE_THRESHOLD = 0.37;
    const recognize = await callFaceRecognize(
      firstImage.base64,
      FACE_THRESHOLD
    );
    const faces = Array.isArray(recognize?.faces) ? recognize.faces : [];

    if (faces.length === 0) {
      Alert.alert(
        "No face found",
        "Please choose a clearer photo with one person."
      );
      return;
    }

    if (faces.length > 1) {
      Alert.alert(
        "Multiple people detected",
        "Please choose a photo with ONLY one person to remember."
      );
      return;
    }

    try {
      setIsSavingFace(true);
      await callFaceRegister(name, firstImage.base64);

      setFriendTagsText((prev: string) => {
        const existingNames: string[] = prev
          .split(/[,@\s]+/)
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0);

        if (!existingNames.includes(name)) {
          const updated = [...existingNames, name];
          return updated.join(", ");
        }
        return prev;
      });

      Alert.alert("Saved", `I'll try to recognize "${name}" in future photos.`);
    } catch (err) {
      console.log("handleRememberFace error:", err);
      Alert.alert(
        "Face learning failed",
        "Could not save this face. Please check the face service / server."
      );
    } finally {
      setIsSavingFace(false);
    }
  };

  // -------------------------------------------------------
  // Remove media
  // -------------------------------------------------------
  const removeMediaAt = (indexToRemove: number) => {
    setMediaItems((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // -------------------------------------------------------
  // Media picking
  // -------------------------------------------------------
  const pickPhotosFromLibrary = async () => {
    if (Platform.OS !== "web") {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your photos to upload memories."
        );
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: true,
      base64: true,
    });

    if (result.canceled) return;

    const selected: SelectedMedia[] = result.assets.map((asset) => ({
      uri: asset.uri,
      type: "image",
      base64: asset.base64 ?? null,
    }));

    setMediaItems((prev) => [...prev, ...selected]);
  };

  const pickVideoFromLibrary = async () => {
    if (Platform.OS !== "web") {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your videos to upload memories."
        );
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
      allowsMultipleSelection: false,
      base64: false,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setMediaItems((prev) => [
      ...prev,
      { uri: asset.uri, type: "video", base64: null },
    ]);
  };

  const captureWithCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "We need access to your camera to capture memories."
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85,
      base64: true,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setMediaItems((prev) => [
      ...prev,
      {
        uri: asset.uri,
        type: asset.type === "video" ? "video" : "image",
        base64: asset.type === "video" ? null : asset.base64 ?? null,
      },
    ]);
  };

  const pickMedia = async () => {
    if (editMode) {
      Alert.alert(
        "Edit mode",
        "Right now you can only edit the caption and story setting, not the media."
      );
      return;
    }

    Alert.alert("Add Media", "Choose photo / video from:", [
      { text: "Camera", onPress: () => captureWithCamera() },
      { text: "Pick Photos (multi)", onPress: () => pickPhotosFromLibrary() },
      { text: "Pick Video (single)", onPress: () => pickVideoFromLibrary() },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // -------------------------------------------------------
  // AI generate
  // -------------------------------------------------------
  const handleGenerateWithAI = async (options?: { useDraft?: boolean }) => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Error", "You need to be logged in.");
      return;
    }

    if (!mediaItems.length) {
      Alert.alert("No media", "Please select at least one photo or video.");
      return;
    }

    try {
      setIsGeneratingAI(true);

      const imageBase64List = mediaItems
        .filter((m) => m.type === "image" && m.base64)
        .map((m) => m.base64 as string);

      if (!imageBase64List.length) {
        Alert.alert(
          "Need photo data",
          "To use AI + face recognition, please select at least 1 photo (not only video)."
        );
        return;
      }

      const captionDraft = options?.useDraft ? draft || "" : caption || "";
      const aiResult = await callAiForPostMeta(captionDraft, imageBase64List);

      const stripHashtags = (text: string) =>
        (text || "")
          .replace(/(^|\s)#\S+/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      if (aiResult.caption) setCaption(stripHashtags(aiResult.caption));

      if (Array.isArray(aiResult.hashtags)) {
        const formatted = aiResult.hashtags
          .map((h) => String(h || "").trim())
          .filter((h) => h.length > 0)
          .map((h) => (h.startsWith("#") ? h : `#${h}`));
        setHashtagsText(formatted.join(" "));
      }

      if (Array.isArray(aiResult.friendTags) && aiResult.friendTags.length) {
        setFriendTagsText(aiResult.friendTags.join(", "));
      }

      // ✅ moodLabel -> emoji
      if (aiResult.moodLabel) {
        const lbl = String(aiResult.moodLabel).toLowerCase();
        const allowed: MoodLabel[] = [
          "happy",
          "neutral",
          "tired",
          "sad",
          "angry",
        ];
        if (allowed.includes(lbl as MoodLabel)) {
          setMoodLabel(lbl as MoodLabel);

          // ✅ set emoji from AI only if user hasn't edited emoji
          if (!emojiEdited) {
            setPostEmoji(emojiFromMoodLabel(lbl));
          }
        }
      }

      if (aiResult.moodSource) {
        setMoodSource(String(aiResult.moodSource) as MoodSource);
      } else {
        // AI ran -> mark as ai
        setMoodSource("ai");
      }

      // Face recognition batch
      const FACE_THRESHOLD = 0.37;
      const scanImages = imageBase64List.slice(0, 3);
      const batch = await callFaceRecognizeBatch(scanImages, FACE_THRESHOLD);

      if (batch && Array.isArray(batch.results)) {
        const names: string[] = [];

        for (const item of batch.results) {
          const faces = Array.isArray(item.faces) ? item.faces : [];
          for (const f of faces) {
            const matches = Array.isArray(f.matches) ? f.matches : [];
            for (const m of matches) {
              const n = String(m.name || "").trim();
              if (n) names.push(n);
            }
          }
        }

        if (names.length) {
          setFriendTagsText((prev: string) => {
            const existing = prev
              .split(/[,@\s]+/)
              .map((t) => t.trim())
              .filter(Boolean);
            const merged = new Set([...existing, ...names]);
            return Array.from(merged).join(", ");
          });
        }
      }
    } catch (e: any) {
      console.log("AI generate error:", e);
      Alert.alert(
        "AI Error",
        `Failed to generate caption. Please check AI / face server.\nDetails: ${
          e instanceof Error ? e.message : JSON.stringify(e)
        }`
      );
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // -------------------------------------------------------
  // Upload
  // -------------------------------------------------------
  const handleUpload = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Error", "You need to be logged in to post.");
      return;
    }

    const hashtagList =
      hashtagsText
        .split(/[,\s]+/)
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0)
        .map((t: string) => (t.startsWith("#") ? t : `#${t}`)) || [];

    const friendTagList =
      friendTagsText
        .split(/[,@\s]+/)
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0) || [];

    const safeAlbums: AlbumInfo[] = Array.isArray(albums) ? albums : [];
    const safeAlbumIds: string[] = Array.isArray(albumIds) ? albumIds : [];

    const finalEmoji = postEmoji?.trim() ? postEmoji.trim() : "😐";

    // ---- EDIT MODE ----
    if (editMode && editingPostId) {
      try {
        setIsUploading(true);

        const now = Date.now();
        const expiry = Timestamp.fromDate(new Date(now + 24 * 60 * 60 * 1000));

        const refDoc = doc(firestore, "posts", editingPostId);
        await updateDoc(refDoc, {
          caption,
          isStory,
          storyExpiresAt: isStory ? expiry : null,
          hashtags: hashtagList,
          friendTags: friendTagList,

          // ✅ IMPORTANT: top-level emoji (MoodCalendar uses this)
          emoji: finalEmoji,

          // optional: keep mood info
          moodLabel: postData?.moodLabel ?? moodLabel,
          moodSource: postData?.moodSource ?? moodSource,

          albums: safeAlbums,
          albumIds: safeAlbumIds,
        });

        Alert.alert("Updated", "Your memory has been updated.");
        navigation.goBack();
      } catch (e) {
        console.log(e);
        Alert.alert("Error", "Failed to update. Please try again.");
      } finally {
        setIsUploading(false);
      }
      return;
    }

    // ---- ADD MODE ----
    if (!mediaItems.length) {
      Alert.alert("Please select at least one photo or video first.");
      return;
    }

    try {
      setIsUploading(true);

      const now = Date.now();
      const expiry = Timestamp.fromDate(new Date(now + 24 * 60 * 60 * 1000));

      const uploadedUrls: string[] = [];
      const uploadedTypes: ("image" | "video")[] = [];

      for (const item of mediaItems) {
        const blob = await (await fetch(item.uri)).blob();
        const ext = item.type === "video" ? "mp4" : "jpg";
        const filename = `posts/${user.uid}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${ext}`;

        const storageRef = ref(storage, filename);
        await uploadBytes(storageRef, blob);
        const downloadURL = await getDownloadURL(storageRef);

        uploadedUrls.push(downloadURL);
        uploadedTypes.push(item.type);
      }

      const firstUrl = uploadedUrls[0];
      const firstType = uploadedTypes[0] || "image";

      await addDoc(collection(firestore, "posts"), {
        CreatedUser: {
          CreatedUserId: user.uid,
          CreatedUserName: user.displayName || "Unknown",
          CreatedUserPhoto: user.photoURL || "-",
        },
        mediaUrl: firstUrl,
        mediaType: firstType,
        mediaUrls: uploadedUrls,
        mediaTypes: uploadedTypes,
        caption,
        hashtags: hashtagList,
        friendTags: friendTagList,
        isStory,
        createdAt: serverTimestamp(),
        storyExpiresAt: isStory ? expiry : null,
        likes: [],
        savedBy: [],
        locationLabel: locationLabel || null,
        locationCoords: locationCoords || null,

        // ✅ IMPORTANT: top-level emoji (MoodCalendar uses this)
        emoji: finalEmoji,

        // optional: keep mood info
        moodLabel,
        moodSource: moodSource || "unknown",

        albums: safeAlbums,
        albumIds: safeAlbumIds,
      });

      Alert.alert("Posted", "Your memory has been uploaded.");
      navigation.goBack();
    } catch (e) {
      console.log(e);
      Alert.alert("Error", "Failed to upload. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const arrowColor = isDarkmode ? themeColor.white : "#999";

  const canUseAI = useMemo(() => {
    return (
      mediaItems.some((m) => m.type === "image" && !!m.base64) &&
      !isGeneratingAI
    );
  }, [mediaItems, isGeneratingAI]);

  return (
    <Layout>
      <TopNav
        middleContent={
          <Text>{editMode ? "Edit Memory" : "Upload Memory"}</Text>
        }
        leftAction={() => navigation.goBack()}
        leftContent={
          <Ionicons
            name="chevron-back"
            size={24}
            color={isDarkmode ? themeColor.white : "black"}
          />
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        <Button
          text={
            editMode
              ? "Choose Photo / Video (disabled in edit mode)"
              : "Add Photo / Video (Camera or Gallery)"
          }
          onPress={pickMedia}
        />
        {/* Preview selected media */}
        {mediaItems.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text>Selected files: {mediaItems.length}</Text>

            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator
              style={{ width: "100%", height: 260, marginTop: 10 }}
            >
              {mediaItems.map((item, index) => (
                <View
                  key={`${item.uri}-${index}`}
                  style={{
                    width: 320,
                    height: "100%",
                    marginRight: 12,
                    borderRadius: 12,
                    overflow: "hidden",
                    position: "relative",
                    backgroundColor: isDarkmode ? "#111" : "#eee",
                  }}
                >
                  {!editMode && (
                    <TouchableOpacity
                      onPress={() => removeMediaAt(index)}
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        zIndex: 10,
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "rgba(0,0,0,0.55)",
                      }}
                    >
                      <Ionicons name="close" size={18} color="#fff" />
                    </TouchableOpacity>
                  )}

                  {item.type === "video" ? (
                    <VideoPreview uri={item.uri} />
                  ) : (
                    <Image
                      source={{ uri: item.uri }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  )}
                </View>
              ))}
            </ScrollView>

            {!editMode && (
              <Text
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: isDarkmode ? "#aaa" : "#777",
                }}
              >
                Tip: Tap the “X” to remove a wrong file.
              </Text>
            )}
          </View>
        )}
        {/* 📍 Location */}
        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", flex: 1 }}
            >
              <Ionicons
                name="location-outline"
                size={18}
                color={isDarkmode ? themeColor.white : "#555"}
              />
              <Text
                style={{
                  marginLeft: 6,
                  color: isDarkmode ? themeColor.white : themeColor.dark,
                }}
                numberOfLines={1}
              >
                {locationLabel
                  ? locationLabel
                  : locationError
                  ? locationError
                  : "Detecting location..."}
              </Text>
            </View>

            <TouchableOpacity onPress={autoDetectLocation}>
              <Text
                style={{ fontSize: 11, color: themeColor.info, marginLeft: 8 }}
              >
                Detect again
              </Text>
            </TouchableOpacity>
          </View>

          <View
            style={{ marginTop: 8, flexDirection: "row", alignItems: "center" }}
          >
            <View style={{ flex: 1, marginRight: 8 }}>
              <TextInput
                placeholder="Search for a place (optional)"
                value={locationQuery}
                onChangeText={setLocationQuery}
              />
            </View>
            <TouchableOpacity
              onPress={searchAddress}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: isDarkmode ? "#555" : "#ccc",
                opacity: isSearchingPlace ? 0.5 : 1,
              }}
              disabled={isSearchingPlace}
            >
              {isSearchingPlace ? (
                <ActivityIndicator />
              ) : (
                <Ionicons
                  name="search-outline"
                  size={18}
                  color={isDarkmode ? themeColor.white : "#555"}
                />
              )}
            </TouchableOpacity>
          </View>

          {placeOptions.length > 0 && (
            <View
              style={{
                marginTop: 6,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: isDarkmode ? "#444" : "#ddd",
                backgroundColor: isDarkmode ? "#111" : "#fff",
              }}
            >
              {placeOptions.map((p, idx) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => handleSelectPlace(p)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderBottomWidth: idx === placeOptions.length - 1 ? 0 : 1,
                    borderBottomColor: isDarkmode ? "#222" : "#eee",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: isDarkmode ? themeColor.white : themeColor.dark,
                    }}
                    numberOfLines={2}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        {/* Draft / Keywords */}
        <Text style={{ marginTop: 20, marginBottom: 10 }}>
          Draft / Keywords (optional)
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <TextInput
              placeholder="Eg: dinner, makeup, dress full"
              value={draft}
              onChangeText={setDraft}
            />
          </View>

          <TouchableOpacity
            onPress={() => {
              if (!canUseAI) return;
              handleGenerateWithAI({ useDraft: true });
            }}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 6,
              opacity: canUseAI ? 1 : 0.3,
              borderWidth: 1,
              borderColor: isDarkmode ? "#555" : "#ccc",
              borderRadius: 4,
            }}
          >
            <Ionicons name="arrow-forward" size={20} color={arrowColor} />
          </TouchableOpacity>
        </View>
        {/* Caption */}
        <Text style={{ marginTop: 20, marginBottom: 10 }}>Caption</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <TextInput
              placeholder="Generated caption will appear here"
              value={caption}
              onChangeText={setCaption}
            />
          </View>

          {/* ✨ button + AI pill overlay */}
          <View style={{ position: "relative", justifyContent: "center" }}>
            <TouchableOpacity
              onPress={() => {
                if (!canUseAI) return;
                handleGenerateWithAI({ useDraft: false });
              }}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 8,
                opacity: canUseAI ? 1 : 0.3,
                borderWidth: 1,
                borderColor: isDarkmode ? "#555" : "#ccc",
                borderRadius: 10,
              }}
            >
              <Ionicons name="sparkles" size={20} color={arrowColor} />
            </TouchableOpacity>

            {/* keep it INSIDE screen, not sticking out */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: -24,
                right: -4, // ✅ move left a bit (no negative)
                zIndex: 50,
                elevation: 50,
              }}
            >
              <AIPill compact />
            </View>
          </View>
        </View>
        {/* Hashtags label with AI pill (no button) */}
        <LabelWithAIPill label="Hashtags (AI / manual)" />
        <TextInput
          placeholder="#friends #holiday #2025"
          value={hashtagsText}
          onChangeText={setHashtagsText}
        />
        {/* Friend tags label with AI pill (no button) */}
        <LabelWithAIPill label="Friend tags (comma separated)" />
        <TextInput
          placeholder="Angelina, Jamie, Alex"
          value={friendTagsText}
          onChangeText={setFriendTagsText}
        />
        {/* Mood display (optional) */}
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontSize: 12, color: isDarkmode ? "#aaa" : "#666" }}>
            Mood (AI): {moodLabel} • {moodSource}
          </Text>
        </View>
        {/* Remember this face */}
        <Text style={{ marginTop: 24, marginBottom: 8 }}>
          Remember this face
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <TextInput
              placeholder="Type a name (eg: Angelina)"
              value={faceName}
              onChangeText={setFaceName}
            />
          </View>
          <Button
            text={isSavingFace ? "Saving..." : "Remember"}
            onPress={handleRememberFace}
            disabled={isSavingFace || !mediaItems.length}
            status="info"
            style={{ width: 120 }}
          />
        </View>

        {/* ✅ Post Emoji */}
        <Text style={{ marginTop: 18, marginBottom: 8 }}>
          Post emoji (AI auto fill)
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {/* Emoji preview / picker */}
          <TouchableOpacity
            onPress={() => setEmojiPickerVisible(true)}
            activeOpacity={0.85}
            style={{
              width: 54,
              height: 48,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: isDarkmode ? "#555" : "#ccc",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 10,
              backgroundColor: isDarkmode ? "#111" : "#fff",
            }}
          >
            <Text style={{ fontSize: 22 }}>{postEmoji || "😐"}</Text>
          </TouchableOpacity>

          {/* Manual emoji typing (NO placeholder) */}
          <View style={{ flex: 1, marginRight: 10 }}>
            <TextInput
              value={postEmoji}
              placeholder="" // ✅ force empty
              placeholderTextColor="transparent" // ✅ hide placeholder
              onChangeText={(t) => {
                setEmojiEdited(true);
                const emoji = Array.from(String(t || ""))[0] || "";
                setPostEmoji(emoji);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              textAlign="center"
            />
          </View>

          {/* Reset to AI */}
          <TouchableOpacity
            onPress={() => {
              setEmojiEdited(false);
              setPostEmoji(emojiFromMoodLabel(moodLabel));
            }}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: isDarkmode ? "#555" : "#ccc",
            }}
          >
            <Text style={{ fontSize: 12, color: isDarkmode ? "#fff" : "#333" }}>
              Reset AI
            </Text>
          </TouchableOpacity>
        </View>

        <Text
          style={{
            marginTop: 6,
            fontSize: 12,
            color: isDarkmode ? "#aaa" : "#777",
          }}
        >
          Tip: Tap the emoji box to choose quickly.
        </Text>

        {/* Emoji picker modal */}
        <Modal
          visible={emojiPickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setEmojiPickerVisible(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.55)",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <View
              style={{
                width: "100%",
                maxWidth: 380,
                borderRadius: 16,
                backgroundColor: isDarkmode ? "#0b1220" : "#fff",
                padding: 14,
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "700",
                  color: isDarkmode ? "#fff" : "#111",
                }}
              >
                Choose emoji
              </Text>
              <Text
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: isDarkmode ? "#bbb" : "#666",
                }}
              >
                This emoji will be saved into the post and shown in Mood
                Calendar.
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                {emojiOptions.map((item) => (
                  <TouchableOpacity
                    key={item.emoji}
                    onPress={() => {
                      setEmojiEdited(true);
                      setPostEmoji(item.emoji);
                      setEmojiPickerVisible(false);
                    }}
                    style={{
                      width: 48,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontSize: 26 }}>{item.emoji}</Text>
                    <Text
                      style={{
                        fontSize: 11,
                        marginTop: 2,
                        color: isDarkmode ? "#aaa" : "#666",
                        textAlign: "center",
                      }}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: "row", marginTop: 12 }}>
                <Button
                  text="Close"
                  status="info"
                  style={{ flex: 1 }}
                  onPress={() => setEmojiPickerVisible(false)}
                />
              </View>
            </View>
          </View>
        </Modal>
        {/* Story toggle */}
        <View style={{ marginTop: 24 }}>
          <TouchableOpacity
            onPress={() => setIsStory(!isStory)}
            style={{ flexDirection: "row", alignItems: "center" }}
          >
            <Ionicons
              name={isStory ? "checkbox-outline" : "square-outline"}
              size={20}
              color={isDarkmode ? themeColor.white : "#444"}
              style={{ marginRight: 8 }}
            />
            <Text
              style={{ color: isDarkmode ? themeColor.white : themeColor.dark }}
            >
              Post as 24-hour Story
            </Text>
          </TouchableOpacity>
          <Text
            style={{
              marginTop: 4,
              fontSize: 12,
              color: isDarkmode ? "#aaa" : "#777",
            }}
          >
            When enabled, this memory will appear as a story and disappear after
            24 hours.
          </Text>
        </View>
        {/* Upload button */}
        <View style={{ marginTop: 30, marginBottom: 20 }}>
          <Button
            text={
              isUploading
                ? editMode
                  ? "Saving..."
                  : "Uploading..."
                : editMode
                ? "Save changes"
                : "Post memory"
            }
            onPress={handleUpload}
            disabled={isUploading}
            status="primary"
          />
        </View>
      </ScrollView>

      <MemoryFloatingMenu navigation={navigation} />
    </Layout>
  );
}

const styles = StyleSheet.create({
  aiPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#7C3AED",
  },
  aiText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 12,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 10,
  },
});
