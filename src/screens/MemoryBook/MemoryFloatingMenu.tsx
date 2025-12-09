// src/screens/MemoryBook/MemoryFloatingMenu.tsx
import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Text, useTheme, themeColor } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

type NavProp = NativeStackNavigationProp<MainStackParamList>;

interface Props {
  navigation: NavProp;
}

export default function MemoryFloatingMenu({ navigation }: Props) {
  const { isDarkmode } = useTheme();
  const route = useRoute(); // 

  const barBg = isDarkmode ? themeColor.dark100 : themeColor.white100;
  const iconColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const borderColor = isDarkmode ? "#374151" : "#e5e7eb";

  const actions = [
    { key: "search", icon: "search", label: "Search", screen: "MemorySearch" },
    { key: "home", icon: "home", label: "Home", screen: "MemoryFeed" },
    { key: "reels", icon: "play-circle", label: "Reels", screen: "MemoryReels" },
    { key: "add", icon: "add-circle", label: "Add", screen: "MemoryUpload" },
    { key: "mood", icon: "calendar-outline", label: "Mood", screen: "MemoryMoodCalendar" },
    { key: "album", icon: "albums-outline", label: "Album", screen: "MemoryAlbum" },
    { key: "profile", icon: "person-circle-outline", label: "Profile", screen: "MemoryProfile" },
  ];

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      <View
        style={{
          height: 70,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
          backgroundColor: barBg,
          borderTopWidth: 0.5,
          borderTopColor: borderColor,
          paddingBottom: 8,
        }}
      >
        {actions.map((action) => {
          const isAdd = action.key === "add";

          const isActive = route.name === action.screen;

          const activeColor = themeColor.info;

          return (
            <TouchableOpacity
              key={action.key}
              onPress={() => navigation.navigate(action.screen as never)}
              activeOpacity={0.8}
              style={{
                alignItems: "center",
                justifyContent: "center",
                transform: isAdd ? [{ translateY: -6 }] : [],
              }}
            >
              <Ionicons
                name={action.icon as any}
                size={isAdd ? 53 : 25}
                color={isActive ? activeColor : isAdd ? themeColor.info : iconColor}
              />

              <Text
                style={{
                  fontSize: 10,
                  marginTop: 2,
                  color: isActive ? activeColor : iconColor,
                  fontWeight: isActive ? "700" : "400", // 
                }}
              >
                {action.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
