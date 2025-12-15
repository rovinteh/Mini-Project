// src/screens/MemoryBook/MemoryMediaViewer.tsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  View,
  Dimensions,
  FlatList,
  Image,
  TouchableOpacity,
  StatusBar,
  Platform,
} from "react-native";
import { Layout, Text, useTheme } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

// ✅ expo-video
import { VideoView, useVideoPlayer } from "expo-video";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryMediaViewer">;

export type MediaItem = {
  id: string;
  postId: string;
  uri: string;
  type: "image" | "video";
  createdAt?: any;
  caption?: string;
};

const { width: W, height: H } = Dimensions.get("window");

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Small component to render a video with its own player instance
 * so we can pause/play based on "active" state.
 */
function VideoSlide({
  uri,
  active,
}: {
  uri: string;
  active: boolean;
}) {
  const player = useVideoPlayer(uri, (p) => {
    // start paused always; user taps play via controls
    p.loop = false;
    p.muted = false;
  });

  // ✅ Pause when not active. Keep the current one paused by default
  // until user uses controls, but make sure other slides never keep playing.
  useEffect(() => {
    if (!active) {
      try {
        player.pause();
      } catch {}
    } else {
      // active slide: keep paused by default (like your previous shouldPlay={false})
      try {
        player.pause();
      } catch {}
    }
  }, [active, player]);

  return (
    <VideoView
      player={player}
      style={{ width: W, height: H }}
      allowsFullscreen
      allowsPictureInPicture
      // ✅ show native controls
      nativeControls
      // Similar to ResizeMode.CONTAIN
      contentFit="contain"
    />
  );
}

export default function MemoryMediaViewer({ navigation, route }: Props) {
  const { isDarkmode } = useTheme();
  const { media, startIndex = 0, title } = route.params;

  const safeStart = clamp(startIndex, 0, Math.max(0, media.length - 1));
  const [index, setIndex] = useState(safeStart);

  const listRef = useRef<FlatList<MediaItem>>(null);

  const bg = "#000";
  const textColor = "#fff";

  const current = media[index];

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (!viewableItems?.length) return;
    const i = viewableItems[0]?.index;
    if (typeof i === "number") setIndex(i);
  }).current;

  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 70 }),
    []
  );

  // ✅ if media changes and startIndex changes, keep stable
  useEffect(() => {
    setIndex(safeStart);
  }, [safeStart]);

  // better top spacing (no safe-area lib)
  const topInset = Platform.OS === "ios" ? 52 : 18;

  return (
    <Layout style={{ backgroundColor: bg }}>
      <StatusBar barStyle="light-content" />

      {/* Top bar */}
      <View
        style={{
          position: "absolute",
          top: topInset,
          left: 12,
          right: 12,
          zIndex: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: "rgba(0,0,0,0.35)",
            alignItems: "center",
            justifyContent: "center",
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="chevron-back" size={22} color={textColor} />
        </TouchableOpacity>

        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text
            style={{
              color: textColor,
              fontSize: 13,
              fontWeight: "700",
              textAlign: "center",
            }}
            numberOfLines={1}
          >
            {title || "Memory"}
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.8)",
              fontSize: 12,
              textAlign: "center",
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {media.length ? `${index + 1} / ${media.length}` : ""}
          </Text>
        </View>

        <View style={{ width: 40, height: 40 }} />
      </View>

      <FlatList
        ref={listRef}
        data={media}
        keyExtractor={(it) => it.id}
        horizontal
        pagingEnabled
        initialScrollIndex={safeStart}
        getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        windowSize={3}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        renderItem={({ item, index: itemIndex }) => {
          const active = itemIndex === index;

          return (
            <View
              style={{
                width: W,
                height: H,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: bg,
              }}
            >
              {item.type === "video" ? (
                <VideoSlide uri={item.uri} active={active} />
              ) : (
                <Image
                  source={{ uri: item.uri }}
                  style={{ width: W, height: H }}
                  resizeMode="contain"
                />
              )}
            </View>
          );
        }}
      />

      {/* Bottom caption */}
      {!!current?.caption && (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 18,
            paddingHorizontal: 16,
            zIndex: 25,
          }}
        >
          <View
            style={{
              backgroundColor: "rgba(0,0,0,0.45)",
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 13 }} numberOfLines={3}>
              {current.caption}
            </Text>
          </View>
        </View>
      )}
    </Layout>
  );
}
