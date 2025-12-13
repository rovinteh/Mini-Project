import React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Text, useTheme, themeColor } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";

import { GlassView } from "expo-glass-effect";

type NavProp = NativeStackNavigationProp<MainStackParamList>;

interface Props {
  navigation: NavProp;
}

export default function MemoryFloatingMenu({ navigation }: Props) {
  const { isDarkmode } = useTheme();
  const route = useRoute();

  const iconColor = isDarkmode ? themeColor.white100 : themeColor.dark;
  const activeColor = themeColor.info;

  const borderTopColor = isDarkmode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";

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
    <View pointerEvents="box-none" style={styles.wrapper}>
      {/* Outer container controls position */}
      <View style={[styles.barShell, { borderTopColor }]}>
        {/* ✅ Glass background */}
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
        />

        {/* Content row above glass */}
        <View style={styles.row}>
          {actions.map((action) => {
            const isAdd = action.key === "add";
            const isActive = (route as any)?.name === action.screen;

            return (
              <TouchableOpacity
                key={action.key}
                onPress={() => navigation.navigate(action.screen as never)}
                activeOpacity={0.85}
                style={[
                  styles.item,
                  isAdd ? styles.addItemLift : null,
                ]}
              >
                <Ionicons
                  name={action.icon as any}
                  size={isAdd ? 56 : 25}
                  color={isActive ? activeColor : isAdd ? activeColor : iconColor}
                />

                <Text
                  style={{
                    fontSize: 10,
                    marginTop: 2,
                    color: isActive ? activeColor : iconColor,
                    fontWeight: isActive ? "700" : "400",
                  }}
                >
                  {action.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },

  // ✅ Like your screenshot: absolute bar, a little taller, with borderTop, overflow hidden
  barShell: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,

    height: 85,
    overflow: "hidden",
    borderTopWidth: 1,
  },

  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingBottom: 10,
    paddingHorizontal: 6,

    // ensure icons always appear above GlassView
    zIndex: 2,
  },

  item: {
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    flex: 1,
  },

  addItemLift: {
    transform: [{ translateY: -8 }],
  },
});
