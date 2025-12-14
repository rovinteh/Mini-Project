// src/screens/Home.tsx (or wherever this file is)
import React from "react";
import { View, ScrollView, TouchableOpacity } from "react-native";
import { MainStackParamList } from "../types/navigation";
import { getAuth } from "firebase/auth";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Layout,
  Text,
  TopNav,
  useTheme,
  themeColor,
  Button,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";

type Props = NativeStackScreenProps<MainStackParamList, "MainTabs">;

export default function Home({ navigation }: Props) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();

  const featureCards = [
    {
      key: "MemoryFeed",
      title: "Memory Feed",
      subtitle: "Capture your best moments and daily stories.",
      icon: "images-outline",
      bgLight: "#FFE5EC",
      bgDark: "#3B1C32",
      route: "MemoryFeed" as keyof MainStackParamList,
    },
    {
      key: "TaskManagement",
      title: "Task Management",
      subtitle: "Organise to-dos and stay on top of your day.",
      icon: "checkmark-done-outline",
      bgLight: "#E5F4FF",
      bgDark: "#102A43",
      route: "TaskManagementMenu" as keyof MainStackParamList,
    },
    {
      key: "MoneyManagement",
      title: "Money Management",
      subtitle: "Track expenses and build better habits.",
      icon: "wallet-outline",
      bgLight: "#E9FFE5",
      bgDark: "#123524",
      route: "MoneyManagementModule" as keyof MainStackParamList,
    },
    {
      key: "HealthFitness",
      title: "Health & Fitness",
      subtitle: "Track daily workouts and meals.",
      icon: "fitness-outline",
      bgLight: "#FFF6E5",
      bgDark: "#3D2A0F",
      route: "FitnessMenu" as keyof MainStackParamList,
    },
  ];

  const textColor = isDarkmode ? themeColor.white100 : themeColor.dark;

  return (
    <Layout>
      {/* Top Navbar */}
      <TopNav
        middleContent="Home"
        rightContent={
          <Ionicons
            name={isDarkmode ? "sunny" : "moon"}
            size={22}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        rightAction={() => {
          setTheme(isDarkmode ? "light" : "dark");
        }}
      />

      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingBottom: 20,
        }}
      >
        {/* Header / Greeting */}
        <View style={{ marginTop: 10, marginBottom: 20 }}>
          <Text fontWeight="bold" style={{ fontSize: 26 }}>
            Your Life Dashboard 💫
          </Text>
          <Text
            style={{
              marginTop: 6,
              fontSize: 14,
              opacity: 0.8,
              color: textColor,
            }}
          >
            Manage memories, tasks, money, and health — all in one place.
          </Text>
        </View>

        {/* 4 Feature Cards */}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          {featureCards.map((card) => {
            const bgColor = isDarkmode ? card.bgDark : card.bgLight;

            return (
              <TouchableOpacity
                key={card.key}
                activeOpacity={0.9}
                onPress={() => navigation.navigate(card.route as never)}
                style={{
                  width: "48%",
                  borderRadius: 18,
                  padding: 14,
                  marginBottom: 16,
                  backgroundColor: bgColor,
                  shadowColor: "#000",
                  shadowOpacity: 0.1,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 4,
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    justifyContent: "center",
                    alignItems: "center",
                    backgroundColor: "rgba(255,255,255,0.8)",
                    marginBottom: 10,
                  }}
                >
                  <Ionicons name={card.icon as any} size={22} color="#111" />
                </View>

                <Text
                  fontWeight="bold"
                  style={{ fontSize: 16, color: textColor }}
                >
                  {card.title}
                </Text>

                <Text
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    opacity: 0.9,
                    color: textColor,
                  }}
                  numberOfLines={3}
                >
                  {card.subtitle}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Small motivational strip */}
        <View
          style={{
            marginTop: 10,
            padding: 14,
            borderRadius: 16,
            backgroundColor: isDarkmode ? "#1E293B" : "#F4F4F5",
          }}
        >
          <Text fontWeight="bold" style={{ fontSize: 14, color: textColor }}>
            Daily Tip 🌱
          </Text>
          <Text
            style={{
              marginTop: 4,
              fontSize: 12,
              opacity: 0.9,
              color: textColor,
            }}
          >
            Small consistent steps in your tasks, savings, and health can create
            powerful memories in your future.
          </Text>
        </View>

        {/* ✅ NEW: Quick Actions (fills the empty space) */}
        <View
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 16,
            backgroundColor: isDarkmode ? "#111827" : "#FFFFFF",
            shadowColor: "#000",
            shadowOpacity: 0.08,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
          }}
        >
          <Text
            fontWeight="bold"
            style={{ fontSize: 14, marginBottom: 10, color: textColor }}
          >
            Quick Actions ⚡
          </Text>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            {[
              {
                label: "Add Memory",
                icon: "add-circle-outline",
                route: "MemoryUpload",
              },
              {
                label: "New Task",
                icon: "create-outline",
                route: "TaskAdd",
              },
              {
                label: "Add Expense",
                icon: "cash-outline",
                route: "TransactionAdd",
              },
              {
                label: "Add Meal",
                icon: "restaurant-outline",
                route: "LogMeal",
              },
            ].map((item) => (
              <TouchableOpacity
                key={item.label}
                activeOpacity={0.9}
                onPress={() => navigation.navigate(item.route as never)}
                style={{
                  width: "48%",
                  paddingVertical: 14,
                  borderRadius: 14,
                  alignItems: "center",
                  marginBottom: 10,
                  backgroundColor: isDarkmode ? "#1F2937" : "#F4F4F5",
                }}
              >
                <Ionicons
                  name={item.icon as any}
                  size={22}
                  color={isDarkmode ? themeColor.white100 : themeColor.dark}
                />
                <Text
                  style={{
                    fontSize: 12,
                    marginTop: 6,
                    color: textColor,
                    fontWeight: "500",
                  }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        
      </ScrollView>
    </Layout>
  );
}
