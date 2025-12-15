import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Dimensions,
  FlatList,
  Image,
  TouchableOpacity,
  StatusBar,
  Platform,
} from "react-native";
import { Layout, Text, useTheme, themeColor } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { Video, ResizeMode } from "expo-av";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

type Props = NativeStackScreenProps<MainStackParamList, "MemoryMediaViewer">;

export type MediaItem = {
  id: string; // unique per media item (postId + index)
  postId: string;
  uri: string;
  type: "image" | "video";
  createdAt?: any;
  caption?: string;
};

const { width: W, height: H } = Dimensions.get("window");

export default function MemoryMediaViewer({ navigation, route }: Props) {
  const { isDarkmode } = useTheme();
  const { media, startIndex = 0, title } = route.params;

  const [index, setIndex] = useState(Math.max(0, Math.min(startIndex, media.length - 1)));
  const listRef = useRef<FlatList<MediaItem>>(null);

  const bg = isDarkmode ? "#000" : "#000";
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

  return (
    <Layout style={{ backgroundColor: bg }}>
      <StatusBar barStyle="light-content" />
      {/* Top bar */}
      <View
        style={{
          position: "absolute",
          top: Platform.OS === "ios" ? 48 : 18,
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

        {/* spacer to balance back button */}
        <View style={{ width: 40, height: 40 }} />
      </View>

      <FlatList
        ref={listRef}
        data={media}
        keyExtractor={(it) => it.id}
        horizontal
        pagingEnabled
        initialScrollIndex={startIndex}
        getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => {
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
                <Video
                  source={{ uri: item.uri }}
                  style={{ width: W, height: H }}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls
                  shouldPlay={false}
                  isLooping={false}
                />
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

      {/* Bottom caption (optional) */}
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
