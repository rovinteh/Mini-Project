// src/screens/MyModule/MemoryUpload.tsx
import React, { useState, useEffect } from "react";
import { View, Image, Alert, ScrollView, TouchableOpacity } from "react-native";
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

type Props = NativeStackScreenProps<MainStackParamList, "MemoryUpload">;

// For multiple selection
type SelectedMedia = {
  uri: string;
  type: "image" | "video";
  base64?: string | null; // for vision AI
};

// For place search (IG-style location search)
type PlaceOption = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

// ----- Types for face-recognition responses -----
type FaceMatch = {
  box: { x: number; y: number; width: number; height: number };
  personId: string | null;
  name: string | null;
  distance: number;
};

type FaceRecognizeResponse = {
  matches: FaceMatch[];
};

// ✅ Album info stored under posts
type AlbumInfo = {
  id: string;
  name: string;
};

export default function MemoryUpload({ navigation, route }: Props) {
  const { isDarkmode } = useTheme();

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

  // 用户输入的 draft/keywords
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

  // ✅ albums state (so you can keep passed albums OR editing albums)
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

  // For Expo web / Android emulator on same PC.
  // On real phone, change to "http://<YOUR_PC_IP>:3000"
  const LOCAL_AI_SERVER = "http://192.168.0.18:3000";

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

      // 1) Try Nominatim reverse geocode with English first
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

      // 2) Fallback to Expo reverseGeocode (may be device-language)
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
  // Helper: call local AI server (caption + hashtags + friendTags)
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
        imageBase64List, // 多张图片一起给 AI
      }),
    });

    if (!response.ok) {
      throw new Error(`AI server error: ${response.status}`);
    }

    const data = await response.json();
    console.log("[CLIENT] /generatePostMeta result:", data);
    return data as {
      caption: string;
      hashtags: string[];
      friendTags: string[];
    };
  };

  // -------------------------------------------------------
  // Helper – call face-recognition endpoint (single image)
  // -------------------------------------------------------
  const callFaceRecognize = async (
    imageBase64: string
  ): Promise<FaceRecognizeResponse | null> => {
    try {
      const resp = await fetch(`${LOCAL_AI_SERVER}/faces/recognize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
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

  // ⭐ Merge recognized names into friendTagsText using functional setState
  const mergeFriendTagsFromFaces = (matches: FaceMatch[]) => {
    if (!matches || !matches.length) return;

    const recognizedNames = matches
      .map((m) => (m.name || "").trim())
      .filter((n) => n.length > 0);

    if (!recognizedNames.length) return;

    setFriendTagsText((prev: string) => {
      const existing: string[] = prev
        .split(/[,@\s]+/)
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0);

      const mergedSet = new Set<string>(existing);
      recognizedNames.forEach((n) => mergedSet.add(n));

      const mergedList = Array.from(mergedSet);
      console.log(
        "[CLIENT] mergeFriendTagsFromFaces prev=",
        prev,
        "recognized=",
        recognizedNames,
        "merged=",
        mergedList
      );
      return mergedList.join(", ");
    });
  };

  // -------------------------------------------------------
  // Auto-generate AI caption & tags + face-based names
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
          "To let AI read your photos, please re-select them from gallery."
        );
        setIsGeneratingAI(false);
        return;
      }

      let captionDraft = "";
      if (options?.useDraft) {
        captionDraft = draft || "";
      } else {
        captionDraft = caption || "";
      }

      const aiResult = await callAiForPostMeta(captionDraft, imageBase64List);

      const stripHashtags = (text: string) =>
        (text || "")
          .replace(/(^|\s)#\S+/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      if (aiResult.caption) {
        setCaption(stripHashtags(aiResult.caption));
      }

      if (Array.isArray(aiResult.hashtags)) {
        const formatted = aiResult.hashtags.map((h) =>
          h.trim().startsWith("#") ? h.trim() : `#${h.trim()}`
        );
        setHashtagsText(formatted.join(" "));
      }

      if (Array.isArray(aiResult.friendTags) && aiResult.friendTags.length) {
        console.log("[CLIENT] Friend tags from AI:", aiResult.friendTags);
        setFriendTagsText(aiResult.friendTags.join(", "));
      }

      const firstImageBase64 = imageBase64List[0];
      if (firstImageBase64) {
        const faceResult = await callFaceRecognize(firstImageBase64);
        if (faceResult && Array.isArray(faceResult.matches)) {
          mergeFriendTagsFromFaces(faceResult.matches);
        }
      }

      console.log("AI caption, tags & faces generated.");
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
  // Media picking: show options (Camera / Gallery)
  // -------------------------------------------------------
  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "We need access to your photos and videos to upload memories."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.85,
      allowsMultipleSelection: true,
      base64: true,
    });

    if (result.canceled) return;

    const selected: SelectedMedia[] = result.assets.map((asset) => ({
      uri: asset.uri,
      type: asset.type === "video" ? "video" : "image",
      base64: asset.base64 ?? null,
    }));

    setMediaItems((prev) => [...prev, ...selected]);
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
      mediaTypes: ["images", "videos"],
      quality: 0.85,
      base64: true,
    });

    if (result.canceled || !result.assets || !result.assets.length) return;

    const asset = result.assets[0];
    const item: SelectedMedia = {
      uri: asset.uri,
      type: asset.type === "video" ? "video" : "image",
      base64: asset.base64 ?? null,
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
      { text: "Gallery", onPress: () => pickFromLibrary() },
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
      emoji: "😐", // default (MoodCalendar will later overwrite based on posts)
    };
  };

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

    // ✅ album values to store under posts
    const safeAlbums: AlbumInfo[] = Array.isArray(albums) ? albums : [];
    const safeAlbumIds: string[] = Array.isArray(albumIds) ? albumIds : [];

    // ---- EDIT MODE: update text fields (and also mood/album if you want) ----
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

          // ✅ keep mood + album under posts
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
        const filename = `posts/${user.uid}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;
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

        // ✅ mood stored under posts
        mood: getTodayMoodObject(),

        // ✅ album stored under posts
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
  const canUseAI = mediaItems.length > 0 && !isGeneratingAI;

  return (
    <Layout>
      <TopNav
        middleContent={<Text>{editMode ? "Edit Memory" : "Upload Memory"}</Text>}
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
                  style={{ width: 320, height: "100%", marginRight: 12 }}
                >
                  <Image
                    source={{ uri: item.uri }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* 📍 Location (auto-detect + IG-style search) */}
        <View style={{ marginTop: 16 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
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
              <Text style={{ fontSize: 11, color: themeColor.info, marginLeft: 8 }}>
                Detect again
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center" }}>
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
              <Ionicons
                name="search-outline"
                size={18}
                color={isDarkmode ? themeColor.white : "#555"}
              />
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
              {placeOptions.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => handleSelectPlace(p)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderBottomWidth: 1,
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
        <Text style={{ marginTop: 24, marginBottom: 8 }}>Remember this face</Text>
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
            <Text style={{ color: isDarkmode ? themeColor.white : themeColor.dark }}>
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
            When enabled, this memory will appear as a story and disappear after 24
            hours.
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
