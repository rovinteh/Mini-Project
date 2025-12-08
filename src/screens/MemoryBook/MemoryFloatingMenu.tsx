import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import {
  Text,
  useTheme,
  themeColor,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { NavigationProp } from "@react-navigation/native";
import { MainStackParamList } from "../../types/navigation";

interface Props {
  navigation: NavigationProp<MainStackParamList>;
}

export default function MemoryFloatingMenu({ navigation }: Props) {
  const { isDarkmode } = useTheme();
  const [open, setOpen] = useState(false);

  const iconColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const bgColor = isDarkmode ? themeColor.dark100 : themeColor.white100;

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
      key: "upload",
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
      }}
    >
      {/* 展开后的小圆按钮们 */}
      {open &&
        actions.map((action, index) => (
          <View
            key={action.key}
            style={{
              position: "absolute",
              bottom: 72 + index * 56,
              right: 0,
              alignItems: "flex-end",
            }}
          >
            {/* label */}
            <View
              style={{
                marginRight: 58,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 12,
                backgroundColor: bgColor,
                shadowColor: "#000",
                shadowOpacity: 0.15,
                shadowRadius: 4,
                elevation: 3,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  color: iconColor,
                }}
              >
                {action.label}
              </Text>
            </View>

            {/* icon 圆钮 */}
            <TouchableOpacity
              onPress={() => {
                setOpen(false);
                action.onPress();
              }}
              style={{
                marginTop: 6,
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: bgColor,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOpacity: 0.25,
                shadowRadius: 4,
                elevation: 5,
              }}
            >
              <Ionicons name={action.icon as any} size={24} color={iconColor} />
            </TouchableOpacity>
          </View>
        ))}

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
      >
        <Ionicons name={open ? "close" : "grid"} size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}
