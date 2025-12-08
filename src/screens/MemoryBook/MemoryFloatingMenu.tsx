// src/screens/MemoryBook/MemoryFloatingMenu.tsx
import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { Text, useTheme, themeColor } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

type NavProp = NativeStackNavigationProp<MainStackParamList>;

interface Props {
  navigation: NavProp;
}

export default function MemoryFloatingMenu({ navigation }: Props) {
  const { isDarkmode } = useTheme();
  const [open, setOpen] = useState(false);

  const barBg = isDarkmode ? "#0b1120" : "#e5e7eb"; // 整条横条背景
  const iconBubbleBg = "#0ea5e9"; // 每个小圆icon背景（明显一点）
  const labelColor = isDarkmode ? "#e5e7eb" : "#111827";

  const actions = [
    {
      key: "search",
      icon: "search",
      label: "Search",
      onPress: () => navigation.navigate("MemorySearch"),
    },
    {
      key: "home",
      icon: "home",
      label: "Home",
      onPress: () => navigation.navigate("MemoryFeed"),
    },
    {
      key: "reels",
      icon: "play-circle",
      label: "Reels",
      onPress: () => navigation.navigate("MemoryReels"),
    },
    {
      key: "add",
      icon: "add",
      label: "Add",
      onPress: () => navigation.navigate("MemoryUpload"),
    },
    {
      key: "mood",
      icon: "calendar-outline",
      label: "Mood",
      onPress: () => navigation.navigate("MemoryMoodCalendar"),
    },
    {
      key: "album",
      icon: "albums-outline",
      label: "Album",
      onPress: () => navigation.navigate("MemoryAlbum"),
    },
    {
      key: "profile",
      icon: "person-circle-outline",
      label: "Profile",
      onPress: () => navigation.navigate("MemoryProfile"),
    },
  ];

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        bottom: 24,
        right: 24,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      {/* 左边伸出去的一条横条 */}
      {open && (
        <View
          style={{
            marginRight: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: barBg,
            flexDirection: "row-reverse", // 从主按钮向左排
            alignItems: "center",
          }}
        >
          {actions.map((action) => (
            <TouchableOpacity
              key={action.key}
              onPress={() => {
                setOpen(false);
                action.onPress();
              }}
              style={{
                alignItems: "center",
                marginHorizontal: 4,
                width: 56, // 固定宽度，icon+文字对称
              }}
              activeOpacity={0.8}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: iconBubbleBg,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 2,
                }}
              >
                <Ionicons name={action.icon as any} size={18} color="#ffffff" />
              </View>
              <Text
                style={{
                  fontSize: 10,
                  color: labelColor,
                  textAlign: "center",
                }}
                numberOfLines={1}
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
        activeOpacity={0.9}
      >
        <Ionicons name={open ? "close" : "grid"} size={28} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}
