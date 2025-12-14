// src/screens/MyModule/MemoryUpload.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Image,
  Alert,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
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
  base64?: string | null; // for vision AI (images only)
};

// For place search (IG-style location search)
type PlaceOption = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

// ----- Face-recognition types (your Node returns faces[] with matches[]) -----
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

export default function MemoryUpload({ navigation, route }: Props) {
  const theme = useTheme();
  const isDarkmode = !!theme.isDarkmode;

  const auth = getAuth();
  const firestore = getFirestore();
  const storage = getStorage();

  // ---- read params (for edit mode / optional album selection) ----
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

  // ✅ initial albums if editing (fallback to [])
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

  // store ALL selected media here
  const [mediaItems, setMediaItems] = useState<SelectedMedia[]>(() =>
    initialMediaUrls.length
      ? initialMediaUrls.map((uri: string, idx: number) => ({
          uri,
          type: initialMediaTypes[idx] || "image",
          base64: null, // no base64 when editing existing media
        }))
      : []
  );

  const [caption, setCaption] = useState(initialCaption);
  const [hashtagsText, setHashtagsText] = useState(initialHashtagsText);
  const [friendTagsText, setFriendTagsText] = useState(initialFriendTagsText);

  const [isStory, setIsStory] = useState(initialIsStory);
  const [isUploading, setIsUploading] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  // ✅ albums state
  const [albumIds, setAlbumIds] = useState<string[]>(
    selectedAlbums.length ? selectedAlbums.map((a) => a.id) : initialAlbumIds
  );
  const [albums, setAlbums] = useState<AlbumInfo[]>(
    selectedAlbums.length ? selectedAlbums : initialAlbums
  );

  // face-learning UI state
  const [faceName, setFaceName] = useState(""); // name typed by user
  const [isSavingFace, setIsSavingFace] = useState(false);

  // 🔹 Location state (auto-detect + search)
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
  // You can also set EXPO_PUBLIC_AI_SERVER or AI_SERVER_URL in env to override.
  const LOCAL_AI_SERVER =
    ((process as any)?.env?.EXPO_PUBLIC_AI_SERVER as string) ||
    ((process as any)?.env?.AI_SERVER_URL as string) ||
    "http://192.168.68.129:3000";

  // -------------------------------------------------------
  // Location: auto-detect using GPS + Nominatim (English)
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

      // 1) Nominatim reverse geocode (English)
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1&accept-language=en`;
        const resp = await fetch(url, {
          headers: {
            "User-Agent": "memorybook-app",
          },
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

      // 2) Fallback Expo reverseGeocode
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
  // Search address (IG-style) with Nominatim (English)
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
        headers: {
          "User-Agent": "memorybook-app",
        },
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

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
    setLocationCoords({
      latitude: place.latitude,
      longitude: place.longitude,
    });
    setLocationQuery(place.label);
    setPlaceOptions([]);
  };

  // -------------------------------------------------------
  // Helper: call AI server (caption + hashtags + friendTags)
  // -------------------------------------------------------
  const callAiForPostMeta = async (
    captionDraft: string,
    imageBase64List: string[]
  ) => {
    const response = await fetch(`${LOCAL_AI_SERVER}/generatePostMeta`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        captionDraft,
        imageBase64List,
      }),
    });

    if (!response.ok) {
      throw new Error("AI server failed");
    }

    // aiResult = { caption, hashtags, friendTags }

    const data = await response.json();
    console.log("[CLIENT] /generatePostMeta result:", data);
    return data as {
      caption: string;
      hashtags: string[];
      friendTags: string[];
    };
  };

  // -------------------------------------------------------
  // Face: single image recognize (kept for other usage)
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
      console.log("[CLIENT] /faces/recognize result:", data);
      return data;
    } catch (err) {
      console.log("Face recognize error:", err);
      return null;
    }
  };

  // -------------------------------------------------------
  // ✅ Face: batch recognize (multiple images)
  // -------------------------------------------------------
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
      console.log("[CLIENT] /faces/recognize_batch result:", data);
      return data;
    } catch (err) {
      console.log("Face batch error:", err);
      return null;
    }
  };

  // Helper – register a face under a given name
  const callFaceRegister = async (name: string, imageBase64: string) => {
    const personId = name.trim().toLowerCase().replace(/\s+/g, "_");

    const resp = await fetch(`${LOCAL_AI_SERVER}/faces/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId,
        name,
        imageBase64,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.log("Face register error body:", text);
      throw new Error(`Face register HTTP ${resp.status}`);
    }

    const data = await resp.json();
    console.log("Face register result:", data);
    return data;
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
    // ✅ Safety: only allow Remember when exactly ONE face is detected
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

      Alert.alert(
        "Saved",
        `I'll try to recognize "${name}" in future photos on this device.`
      );
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
  // ✅ Remove selected media (X button)
  // -------------------------------------------------------
  const removeMediaAt = (indexToRemove: number) => {
    setMediaItems((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // -------------------------------------------------------
  // Media picking
  // -------------------------------------------------------
  const pickPhotosFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "We need access to your photos to upload memories."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: true,
      base64: true, // ✅ images only
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
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "We need access to your videos to upload memories."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
      allowsMultipleSelection: false,
      base64: false,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    const item: SelectedMedia = {
      uri: asset.uri,
      type: "video",
      base64: null,
    };

    setMediaItems((prev) => [...prev, item]);
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
      base64: true, // ✅ photos have base64, videos will be null
    });

    if (result.canceled || !result.assets || !result.assets.length) return;

    const asset = result.assets[0];
    const item: SelectedMedia = {
      uri: asset.uri,
      type: asset.type === "video" ? "video" : "image",
      base64: asset.type === "video" ? null : asset.base64 ?? null,
    };

    setMediaItems((prev) => [...prev, item]);
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

  // ✅ helper for mood keys
  const getTodayMoodObject = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return {
      date: `${yyyy}-${mm}-${dd}`, // YYYY-MM-DD
      monthKey: `${yyyy}-${mm}`, // YYYY-MM
      emoji: "😐",
    };
  };

  // -------------------------------------------------------
  // ✅ AI generate (caption + hashtags + friend tags)
  // Uses MULTI-image base64, and batch face recognize for better tags.
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

      // only images (videos have no base64)
      const imageBase64List = mediaItems
        .filter((m) => m.type === "image" && m.base64)
        .map((m) => m.base64 as string);

      if (!imageBase64List.length) {
        Alert.alert(
          "Need photo data",
          "To use AI + face recognition, please select at least 1 photo (not only video)."
        );
        setIsGeneratingAI(false);
        return;
      }

      let captionDraft = "";
      if (options?.useDraft) captionDraft = draft || "";
      else captionDraft = caption || "";

      // 1) Caption + hashtags from your Node (/generatePostMeta already supports multi images)
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

      // 2) Friend tags from AI (text model) - keep it if provided
      if (Array.isArray(aiResult.friendTags) && aiResult.friendTags.length) {
        setFriendTagsText(aiResult.friendTags.join(", "));
      }

      // 3) ✅ Face recognition batch across multiple images (faster + better)
      const FACE_THRESHOLD = 0.37;

      // scan first 3 images max for speed
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

      console.log("AI caption/tags generated.");
    } catch (e: any) {
      console.log("AI generate error:", e);
      Alert.alert(
        "AI Error",
        "Failed to generate caption. Please check AI / face server."
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
          mood: postData?.mood || getTodayMoodObject(),
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
        mood: getTodayMoodObject(),
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

  // UI states
  const arrowColor = isDarkmode ? themeColor.white : "#999";

  // ✅ AI enabled only if there is at least one image with base64
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
                  {/* ❌ Delete button */}
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

                  {/* Media preview */}
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

          <TouchableOpacity
            onPress={() => {
              if (!canUseAI) return;
              handleGenerateWithAI({ useDraft: false });
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
            <Ionicons name="sparkles" size={20} color={arrowColor} />
          </TouchableOpacity>
        </View>

        {/* Hashtags */}
        <Text style={{ marginTop: 20, marginBottom: 10 }}>
          Hashtags (AI / manual)
        </Text>
        <TextInput
          placeholder="#friends #holiday #2025"
          value={hashtagsText}
          onChangeText={setHashtagsText}
        />

        {/* Friend tags */}
        <Text style={{ marginTop: 20, marginBottom: 10 }}>
          Friend tags (comma separated)
        </Text>
        <TextInput
          placeholder="Angelina, Jamie, Alex"
          value={friendTagsText}
          onChangeText={setFriendTagsText}
        />

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
