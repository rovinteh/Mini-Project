import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { Calendar } from "react-native-calendars";
import {

} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { useTaskData } from "./TaskHooks";
import { Task, DEFAULT_PROJECT_ID, DEFAULT_TEAM_ID } from "./data";

const toDate = (v: any): Date | null => {
  if (!v) return null;
  // @ts-ignore
  if (typeof v?.toDate === "function") return v.toDate();
  try {
    return new Date(v);
  } catch {
    return null;
  }
};

const formatDateKey = (date: Date) => date.toISOString().split("T")[0];

const COLORS = {
  primary: "#6366f1",
  primaryDark: "#4f46e5",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  purple: "#8b5cf6",
  light: {
    bg: "#f8fafc",
    card: "#ffffff",
    cardAlt: "#f1f5f9",
    text: "#0f172a",
    textSecondary: "#64748b",
    border: "#e2e8f0",
  },
  dark: {
    bg: "#0f172a",
    card: "#1e293b",
    cardAlt: "#334155",
    text: "#f8fafc",
    textSecondary: "#94a3b8",
    border: "#334155",
  },
};

export default function TaskCalendar({
  navigation,
}: NativeStackScreenProps<MainStackParamList, "TaskCalendar">) {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();


  const { loading, taskArray: TaskArray } = useTaskData(DEFAULT_PROJECT_ID, DEFAULT_TEAM_ID);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );

  // Calculate score for sorting (same logic as TaskList)
  const calculateFinalScore = (task: any) => {
    const dueDate = toDate(task.dueDate);
    let urgency = 0;
    let overdueBoost = 0;
    if (dueDate) {
      const now = new Date();
      const diffDays = Math.ceil(
        (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays <= 0) {
        urgency = 1;
        overdueBoost = 0.15;
      } else urgency = 1 / (diffDays + 1);
    }

    let effort = 0.6;
    if (task.effort === "Low") effort = 1.0;
    else if (task.effort === "High") effort = 0.3;

    const depCount =
      (Array.isArray(task.dependencies) ? task.dependencies.length : 0) ||
      (Array.isArray(task.taskDependencies) ? task.taskDependencies.length : 0);
    const dependencyWeight = Math.min(depCount, 3) / 3;

    const focusScore =
      typeof task.focusScore === "number" ? task.focusScore : 0.5;

    if (task.isCompleted) return -1;

    let score =
      0.35 * urgency +
      0.2 * effort +
      0.15 * dependencyWeight +
      0.15 * focusScore +
      overdueBoost;

    if (dueDate) {
      score += Math.max(
        0,
        0.02 * (1 / (1 + Math.max(0, dueDate.getTime() - Date.now())))
      );
    }

    return score;
  };

  // Map tasks by date for calendar view
  const tasksByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    TaskArray.forEach((t) => {
      const d = toDate(t.dueDate);
      if (!d) return;
      const key = formatDateKey(d);
      if (!map[key]) map[key] = [];
      map[key].push({ ...t, _score: calculateFinalScore(t) });
    });
    return map;
  }, [TaskArray]);

  // Marked dates for calendar with status colors
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    Object.entries(tasksByDate).forEach(([date, arr]) => {
      const isOverdue = date < todayStr;
      const isToday = date === todayStr;

      const dots = arr.slice(0, 4).map((task: any, idx: number) => {
        let dotColor = COLORS.primary;
        if (task.isCompleted) {
          dotColor = COLORS.success;
        } else if (isOverdue) {
          dotColor = COLORS.danger;
        } else if (isToday) {
          dotColor = COLORS.warning;
        } else if (task.priority === "High") {
          dotColor = COLORS.danger;
        } else if (task.priority === "Medium") {
          dotColor = COLORS.warning;
        }
        return { key: `${date}-${idx}`, color: dotColor };
      });

      marks[date] = { marked: true, dots };
    });

    marks[selectedDate] = {
      ...(marks[selectedDate] || {}),
      selected: true,
      selectedColor: COLORS.primary,
      selectedTextColor: "#fff",
    };

    return marks;
  }, [tasksByDate, selectedDate]);

  // Tasks for selected date (sorted by score)
  const tasksForSelectedDate = useMemo(() => {
    const arr = tasksByDate[selectedDate] ?? [];
    return [...arr].sort((a, b) => b._score - a._score);
  }, [tasksByDate, selectedDate]);

  // Load realtime tasks


  const theme = isDarkmode ? COLORS.dark : COLORS.light;

  const getTimeRemaining = (date: Date | null) => {
    if (!date) return null;
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (diff < 0) return { text: "Overdue", urgent: true };
    if (days === 0 && hours <= 3)
      return { text: `${hours}h left`, urgent: true };
    if (days === 0) return { text: "Today", urgent: true };
    if (days === 1) return { text: "Tomorrow", urgent: false };
    if (days <= 7) return { text: `${days} days`, urgent: false };
    return {
      text: date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      urgent: false,
    };
  };

  const renderTaskItem = (item: any) => {
    const t = item;
    const dueDate = toDate(t.dueDate);
    const timeInfo = getTimeRemaining(dueDate);
    const priorityColor =
      t.priority === "High"
        ? COLORS.danger
        : t.priority === "Medium"
        ? COLORS.warning
        : COLORS.success;
    const priorityIcon =
      t.priority === "High"
        ? "flame"
        : t.priority === "Medium"
        ? "alert-circle"
        : "leaf";

    return (
      <TouchableOpacity
        style={[
          styles.taskCard,
          { backgroundColor: isDarkmode ? "#1e293b" : "#ffffff" },
        ]}
        activeOpacity={0.7}
      >
        {!t.isCompleted && (
          <View
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              backgroundColor: priorityColor,
              borderTopLeftRadius: 12,
              borderBottomLeftRadius: 12,
            }}
          />
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            {!t.isCompleted && (
              <Ionicons
                name={priorityIcon as any}
                size={14}
                color={priorityColor}
                style={{ marginRight: 6 }}
              />
            )}
            <Text
              style={{
                fontWeight: "600",
                fontSize: 14,
                color: isDarkmode ? "#f8fafc" : "#0f172a",
                textDecorationLine: t.isCompleted ? "line-through" : "none",
                opacity: t.isCompleted ? 0.5 : 1,
                flex: 1,
              }}
              numberOfLines={2}
            >
              {t.taskName ?? t.title}
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {!!t.listName && (
              <View
                style={{
                  backgroundColor: `${COLORS.primary}12`,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "600",
                    color: COLORS.primary,
                  }}
                >
                  {t.listName}
                </Text>
              </View>
            )}
            {timeInfo && !t.isCompleted && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: timeInfo.urgent
                    ? `${COLORS.danger}12`
                    : isDarkmode
                    ? "#334155"
                    : "#f1f5f9",
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 4,
                }}
              >
                <Ionicons
                  name={timeInfo.urgent ? "time" : "calendar-outline"}
                  size={11}
                  color={
                    timeInfo.urgent
                      ? COLORS.danger
                      : isDarkmode
                      ? "#94a3b8"
                      : "#64748b"
                  }
                  style={{ marginRight: 3 }}
                />
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "600",
                    color: timeInfo.urgent
                      ? COLORS.danger
                      : isDarkmode
                      ? "#94a3b8"
                      : "#64748b",
                  }}
                >
                  {timeInfo.text}
                </Text>
              </View>
            )}
          </View>
        </View>
        {t.isCompleted && (
          <Ionicons
            name="checkmark-circle"
            size={16}
            color={COLORS.success}
            style={{ marginLeft: 8 }}
          />
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <Layout>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: isDarkmode ? "#000" : "#f2f2f7",
          }}
        >
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={{ marginTop: 12, color: theme.textSecondary }}>
            Loading calendar...
          </Text>
        </View>
      </Layout>
    );
  }

  return (
    <Layout>
      <TopNav
        middleContent="Task Calendar"
        leftContent={
          <Ionicons
            name="chevron-back"
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        leftAction={() => navigation.goBack()}
        rightContent={
          <Ionicons
            name={isDarkmode ? "sunny" : "moon"}
            size={20}
            color={isDarkmode ? themeColor.white100 : themeColor.dark}
          />
        }
        rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
      />

      <View
        style={{ flex: 1, backgroundColor: isDarkmode ? "#000" : "#f2f2f7" }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
        >
          {/* Calendar Widget */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <View
              style={{
                backgroundColor: isDarkmode ? "#1e293b" : "#fff",
                borderRadius: 16,
                overflow: "hidden",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.08,
                shadowRadius: 8,
                elevation: 3,
              }}
            >
              <Calendar
                markingType="multi-dot"
                markedDates={markedDates}
                onDayPress={(day: any) => setSelectedDate(day.dateString)}
                current={selectedDate}
                enableSwipeMonths={true}
                theme={{
                  backgroundColor: "transparent",
                  calendarBackground: "transparent",
                  textMonthFontWeight: "700",
                  textMonthFontSize: 18,
                  monthTextColor: isDarkmode ? "#f8fafc" : "#0f172a",
                  arrowColor: COLORS.primary,
                  textSectionTitleColor: isDarkmode ? "#64748b" : "#94a3b8",
                  textDayHeaderFontWeight: "600",
                  dayTextColor: isDarkmode ? "#e2e8f0" : "#374151",
                  textDayFontSize: 15,
                  textDayFontWeight: "500",
                  todayTextColor: "#fff",
                  todayBackgroundColor: COLORS.primary,
                  selectedDayBackgroundColor: COLORS.primary,
                  selectedDayTextColor: "#fff",
                  textDisabledColor: isDarkmode ? "#475569" : "#d1d5db",
                  dotColor: COLORS.primary,
                  selectedDotColor: "#fff",
                }}
                style={{ paddingBottom: 10 }}
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 16,
                  paddingVertical: 12,
                  borderTopWidth: 1,
                  borderTopColor: isDarkmode ? "#334155" : "#e5e7eb",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: COLORS.danger,
                      marginRight: 4,
                    }}
                  />
                  <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                    Overdue
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: COLORS.warning,
                      marginRight: 4,
                    }}
                  />
                  <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                    Today
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: COLORS.primary,
                      marginRight: 4,
                    }}
                  />
                  <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                    Upcoming
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: COLORS.success,
                      marginRight: 4,
                    }}
                  />
                  <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                    Done
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Selected Date Tasks */}
          {tasksForSelectedDate.length === 0 ? (
            <View
              style={{
                paddingHorizontal: 16,
                paddingVertical: 24,
                alignItems: "center",
              }}
            >
              <Ionicons
                name="calendar-outline"
                size={48}
                color={theme.textSecondary}
                style={{ opacity: 0.4, marginBottom: 12 }}
              />
              <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
                No tasks on {selectedDate}
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <Ionicons name="calendar" size={18} color={COLORS.primary} />
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "700",
                    color: theme.text,
                    marginLeft: 8,
                  }}
                >
                  {tasksForSelectedDate.length} task
                  {tasksForSelectedDate.length !== 1 ? "s" : ""}
                </Text>
              </View>
              {tasksForSelectedDate.map((t: any) => (
                <View key={t.key} style={{ marginBottom: 10 }}>
                  {renderTaskItem(t)}
                </View>
              ))}
            </View>
          )}

          {/* Summary Stats */}
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              marginTop: 12,
            }}
          >
            <View
              style={{
                backgroundColor: isDarkmode ? "#1e293b" : "#ffffff",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "700",
                  color: theme.text,
                  marginBottom: 8,
                }}
              >
                Calendar Stats
              </Text>
              <View style={{ gap: 6 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                    Total tasks:
                  </Text>
                  <Text style={{ color: theme.text, fontWeight: "600" }}>
                    {TaskArray.length}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                    Pending:
                  </Text>
                  <Text style={{ color: COLORS.primary, fontWeight: "600" }}>
                    {TaskArray.filter((t) => !t.isCompleted).length}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                    Completed:
                  </Text>
                  <Text style={{ color: COLORS.success, fontWeight: "600" }}>
                    {TaskArray.filter((t) => t.isCompleted).length}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                    High priority:
                  </Text>
                  <Text style={{ color: COLORS.danger, fontWeight: "600" }}>
                    {
                      TaskArray.filter(
                        (t) => !t.isCompleted && t.priority === "High"
                      ).length
                    }
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </Layout>
  );
}

const styles = StyleSheet.create({
  taskCard: {
    marginHorizontal: 0,
    marginBottom: 10,
    borderRadius: 12,
    paddingVertical: 12,
    paddingRight: 12,
    paddingLeft: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "flex-start",
  },
});
