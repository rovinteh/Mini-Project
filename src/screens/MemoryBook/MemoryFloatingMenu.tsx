// src/screens/MemoryBook/MemoryFloatingMenu.tsx
import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { Text, useTheme, themeColor } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { NavigationProp } from "@react-navigation/native";
import { MainStackParamList } from "../../types/navigation";

type NavProp = NavigationProp<MainStackParamList>;

interface Props {
  navigation: NavProp;
}

export default function MemoryFloatingMenu({ navigation }: Props) {
  const { isDarkmode } = useTheme();
  const [open, setOpen] = useState(false);

  const barBg = isDarkmode ? "#0c1748ff" : "#f9fafb"; // 比较浅的背景，像向左那一版
  const iconBubbleBg = "#1aadf0ff";
  const labelColor = isDarkmode ? "#e5e7eb" : "#111827";

  const actions = [
    {
      key: "profile",
      icon: "person-circle-outline",
      label: "Profile",
      onPress: () => navigation.navigate("MemoryProfile"),
    },
    {
      key: "album",
      icon: "albums-outline",
      label: "Album",
      onPress: () => navigation.navigate("MemoryAlbum"),
    },
    {
      key: "mood",
      icon: "calendar-outline",
      label: "Mood",
      onPress: () => navigation.navigate("MemoryMoodCalendar"),
    },
    {
      key: "add",
      icon: "add",
      label: "Add",
      onPress: () => navigation.navigate("MemoryUpload"),
    },
    {
      key: "reels",
      icon: "play-circle",
      label: "Reels",
      onPress: () => navigation.navigate("MemoryReels"),
    },
    {
      key: "home",
      icon: "home",
      label: "Home",
      onPress: () => navigation.navigate("MemoryFeed"),
    },
    {
      key: "search",
      icon: "search",
      label: "Search",
      onPress: () => navigation.navigate("MemorySearch"),
    },
  ];

  // 下面靠近按钮的是 Search
  const actionsBottomToTop = actions.slice().reverse();

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        bottom: 24,
        right: 24,
      }}
    >
      <View style={{ alignItems: "flex-end" }}>
        {/* 竖直向上的菜单，背景像「向左展开」那种紧紧包住内容 */}
        {open && (
          <View
            style={{
              marginBottom: 12,
              paddingVertical: 6,
              paddingHorizontal: 10,
              backgroundColor: barBg,
              borderRadius: 24,        // 不用 999，比较自然的圆角矩形
              width: 120,              // 固定宽度，刚好包住文字 + icon
              alignSelf: "flex-end",
              shadowColor: "#000000ff",
              shadowOpacity: 0.25,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 6,
            }}
          >
            {actionsBottomToTop.map((action) => (
              <TouchableOpacity
                key={action.key}
                onPress={() => {
                  setOpen(false);
                  action.onPress();
                }}
                activeOpacity={0.8}
                style={{
                  flexDirection: "row-reverse", // 右 icon 左文字
                  alignItems: "center",
                  paddingVertical: 6,
                }}
              >
                {/* icon 小圆圈 */}
                <View
                  style={{
                    width: 35,
                    height: 35,
                    borderRadius: 15,
                    backgroundColor: iconBubbleBg,
                    alignItems: "center",
                    justifyContent: "center",
                    marginLeft: 8,
                  }}
                >
                  <Ionicons
                    name={action.icon as any}
                    size={20}
                    color="#ffffff"
                  />
                </View>

                {/* 文字 label */}
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    fontSize: 14,
                    color: labelColor,
                    textAlign: "right",
                  }}
                >
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 右下角主按钮 */}
        <TouchableOpacity
          onPress={() => setOpen((v) => !v)}
          activeOpacity={0.9}
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: themeColor.info,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#000",
            shadowOpacity: 0.3,
            shadowRadius: 6,
            elevation: 6,
          }}
        >
          <Ionicons name={open ? "close" : "grid"} size={28} color="#ffffff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}
