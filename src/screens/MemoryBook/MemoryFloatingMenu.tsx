import React, { useMemo } from "react";
import { View, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Text, useTheme, themeColor } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type NavProp = NativeStackNavigationProp<MainStackParamList>;

interface Props {
  navigation: NavProp;
}

type Action = {
  key: string;
  icon: any;
  label: string;
  screen: keyof MainStackParamList;
};

export default function MemoryFloatingMenu({ navigation }: Props) {
  const { isDarkmode } = useTheme();
  const route = useRoute();
  const insets = useSafeAreaInsets();

  const activeColor = themeColor.info;
  const iconColor = isDarkmode ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.72)";
  const labelColor = isDarkmode ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.62)";

  const actions = useMemo<Action[]>(
    () => [
      {
        key: "search",
        icon: "search-outline",
        label: "Search",
        screen: "MemorySearch",
      },
      {
        key: "home",
        icon: "home-outline",
        label: "Home",
        screen: "MemoryFeed",
      },
      {
        key: "reels",
        icon: "play-circle-outline",
        label: "Reels",
        screen: "MemoryReels",
      },
      // add handled as FAB
      {
        key: "mood",
        icon: "calendar-outline",
        label: "Mood",
        screen: "MemoryMoodCalendar",
      },
      {
        key: "album",
        icon: "albums-outline",
        label: "Album",
        screen: "MemoryAlbum",
      },
      {
        key: "profile",
        icon: "person-outline",
        label: "Profile",
        screen: "MemoryProfile",
      },
    ],
    []
  );

  const current = (route as any)?.name as string;

  const BAR_HEIGHT = 66;
  const SAFE_BOTTOM = Math.max(insets.bottom, 10);

  const barBg = isDarkmode ? "rgba(14,18,28,0.72)" : "rgba(255,255,255,0.78)";
  const borderTopColor = isDarkmode
    ? "rgba(255,255,255,0.10)"
    : "rgba(0,0,0,0.08)";
  const shadowColor = "#000";

  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      {/* Bar */}
      <View style={[styles.barShell, { paddingBottom: SAFE_BOTTOM }]}>
        {/* Frosted background (no distortion like GlassView) */}
        <View style={[styles.bgWrap, { borderTopColor }]}>
          <BlurView
            intensity={30}
            tint={isDarkmode ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: barBg }]} />
        </View>

        {/* Row */}
        <View style={[styles.row, { height: BAR_HEIGHT }]}>
          {/* Left side */}
          <View style={styles.side}>
            {actions.slice(0, 3).map((a) => {
              const isActive = current === a.screen;
              return (
                <TouchableOpacity
                  key={a.key}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate(a.screen as never)}
                  style={styles.item}
                >
                  <Ionicons
                    name={a.icon}
                    size={22}
                    color={isActive ? activeColor : iconColor}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      ...styles.label,
                      color: isActive ? activeColor : labelColor,
                      fontWeight: isActive ? "700" : "500",
                    }}
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Center spacer (FAB sits here) */}
          <View style={styles.centerSlot} />

          {/* Right side */}
          <View style={styles.side}>
            {actions.slice(3).map((a) => {
              const isActive = current === a.screen;
              return (
                <TouchableOpacity
                  key={a.key}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate(a.screen as never)}
                  style={styles.item}
                >
                  <Ionicons
                    name={a.icon}
                    size={22}
                    color={isActive ? activeColor : iconColor}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      ...styles.label,
                      color: isActive ? activeColor : labelColor,
                      fontWeight: isActive ? "700" : "500",
                    }}
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Floating ADD Button */}
        <View
          pointerEvents="box-none"
          style={[
            styles.fabWrap,
            {
              bottom: SAFE_BOTTOM + 18,
              shadowColor,
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate("MemoryUpload" as never)}
            style={[
              styles.fab,
              {
                backgroundColor: activeColor,
                shadowColor,
              },
            ]}
          >
            <Ionicons name="add" size={28} color="#fff" />
          </TouchableOpacity>

          <Text
            style={{
              marginTop: 6,
              fontSize: 10,
              color: isDarkmode ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.6)",
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            Add
          </Text>
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

  barShell: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },

  bgWrap: {
    ...StyleSheet.absoluteFillObject,
    borderTopWidth: 1,
    overflow: "hidden",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },

  side: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around",
  },

  centerSlot: {
    width: 74, // space for FAB
  },

  item: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    minWidth: 52,
  },

  label: {
    marginTop: 3,
    fontSize: 10,
  },

  fabWrap: {
    position: "absolute",
    alignSelf: "center",
    alignItems: "center",
  },

  fab: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",

    // Shadow (iOS)
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },

    // Shadow (Android)
    elevation: 10,

    // Make it look crisp
    ...(Platform.OS === "android" ? { borderWidth: 0 } : { borderWidth: 0 }),
  },
});
