import React, { useState, useEffect } from "react";
import {
  View,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { MainStackParamList } from "../../types/navigation";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { Project, Task } from "./data";

type AIAnalyticsProps = NativeStackScreenProps<MainStackParamList, "AIAnalytics"> & {
  projects?: Project[];
  tasks?: Task[];
  metrics?: {
    pendingCount: number;
    dueTodayCount: number;
    overdueCount: number;
    urgentCount: number;
    completedThisWeek: number;
    plannedThisWeek: number;
    efficiency: number;
  };
};

export default function AIAnalytics({
  navigation,
  route,
}: AIAnalyticsProps) {
  const { isDarkmode, setTheme } = useTheme();
  const [loading, setLoading] = useState<boolean>(false);
  const [insights, setInsights] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Theme colors
  const bgColor = isDarkmode ? "#0f172a" : "#f8fafc";
  const cardBg = isDarkmode ? "#1e293b" : "#ffffff";
  const textColor = isDarkmode ? "#fff" : "#0f172a";
  const subTextColor = isDarkmode ? "#94a3b8" : "#64748b";
  const accentColor = "#3b82f6";

  // Get data from route params with proper null safety
  const projects = route?.params?.projects || [];
  const tasks = route?.params?.tasks || [];
  const metrics = route?.params?.metrics;

  useEffect(() => {
    if (projects && projects.length > 0) {
      analyzeProjects();
    }
  }, [projects]);

  const analyzeProjects = async () => {
    setLoading(true);
    setError("");
    setInsights("");

    try {
      // Prepare analysis data
      const analysisData = projects.map((project) => {
        const projectTasks = tasks.filter(
          (t) => t.projectId === project.id || (!t.projectId && project.id === "MyPersonalProject")
        );

        const totalTasks = projectTasks.length;
        const completedTasks = projectTasks.filter((t) => t.isCompleted).length;
        const pendingTasks = totalTasks - completedTasks;
        const overdueTasks = projectTasks.filter((t) => {
          if (t.isCompleted || !t.dueDate) return false;
          const dueDate = new Date(t.dueDate.seconds ? t.dueDate.seconds * 1000 : t.dueDate);
          return dueDate < new Date();
        }).length;

        const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

        // Calculate time metrics
        const now = Date.now();
        const startDate = project.timeline?.startDate || now;
        const endDate = project.timeline?.endDate || now;
        const totalDuration = endDate - startDate;
        const elapsed = now - startDate;
        const remaining = endDate - now;
        const timeProgress = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0;

        return {
          name: project.name,
          status: project.status,
          startDate: new Date(startDate).toLocaleDateString(),
          endDate: new Date(endDate).toLocaleDateString(),
          daysRemaining: Math.ceil(remaining / (1000 * 60 * 60 * 24)),
          totalTasks,
          completedTasks,
          pendingTasks,
          overdueTasks,
          completionRate: completionRate.toFixed(1),
          timeProgress: timeProgress.toFixed(1),
        };
      });

      // Create AI prompt
      const prompt = `You are a business analytics expert. Analyze the following project data and provide insights on the likelihood of completion by the end date.

Current Date: ${new Date().toLocaleDateString()}

Overall Metrics:
- Pending Tasks: ${metrics?.pendingCount || 0}
- Due Today: ${metrics?.dueTodayCount || 0}
- Overdue Tasks: ${metrics?.overdueCount || 0}
- Urgent Tasks: ${metrics?.urgentCount || 0}
- Weekly Efficiency: ${metrics?.efficiency || 0}%
- Completed This Week: ${metrics?.completedThisWeek || 0}
- Planned This Week: ${metrics?.plannedThisWeek || 0}

Project Details:
${analysisData.map((p, i) => `
Project ${i + 1}: ${p.name}
- Status: ${p.status}
- Timeline: ${p.startDate} to ${p.endDate} (${p.daysRemaining} days remaining)
- Progress: ${p.completionRate}% tasks completed vs ${p.timeProgress}% time elapsed
- Tasks: ${p.completedTasks}/${p.totalTasks} completed, ${p.pendingTasks} pending, ${p.overdueTasks} overdue
`).join('\n')}

Please provide:
1. Completion Probability: For each project, estimate the likelihood (percentage) of completion by the end date
2. Risk Assessment: Identify key risks (red flags like overdue tasks, low completion rate vs time elapsed)
3. Actionable Recommendations: Suggest 3-5 specific actions to improve delivery probability
4. Resource Insights: Comment on workload distribution and potential bottlenecks

IMPORTANT: Format your response in PLAIN TEXT without markdown symbols. Do not use asterisks for bold or bullets. Use simple numbered lists and dashes for sub-items. Use UPPERCASE for emphasis instead of asterisks.`;

      // Call Gemini API
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=AIzaSyC2dEPGBmrpHwhBHdByqQXU33R9Dz2dPIo",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 500,  // Limit response length (~300-400 words)
              temperature: 0.5,
            },
          }),

        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (text) {
        setInsights(text);
      } else {
        setError("No insights generated. Please try again.");
      }
    } catch (err: any) {
      setError(`Error: ${err.message}`);
      console.error("AI Analytics Error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <TopNav
        middleContent="AI Analytics"
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
        rightAction={() => {
          if (isDarkmode) setTheme("light");
          else setTheme("dark");
        }}
      />

      <ScrollView
        style={{ flex: 1, backgroundColor: bgColor }}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Card */}
        <View style={[styles.card, { backgroundColor: cardBg }]}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <Ionicons name="analytics" size={28} color={accentColor} />
            <Text
              style={{
                fontSize: 20,
                fontWeight: "bold",
                color: textColor,
                marginLeft: 12,
              }}
            >
              Business Insights
            </Text>
          </View>
          <Text style={{ fontSize: 14, color: subTextColor, lineHeight: 20 }}>
            AI-powered analysis of your project completion probability based on current metrics,
            timeline, and progress trends.
          </Text>
        </View>

        {/* Loading State */}
        {loading && (
          <View style={[styles.card, { backgroundColor: cardBg, alignItems: "center" }]}>
            <ActivityIndicator size="large" color={accentColor} />
            <Text style={{ color: subTextColor, marginTop: 16 }}>
              Analyzing your project data...
            </Text>
          </View>
        )}

        {/* Error State */}
        {error && !loading && (
          <View
            style={[
              styles.card,
              { backgroundColor: isDarkmode ? "#7f1d1d" : "#fee2e2", borderLeftWidth: 4, borderLeftColor: "#ef4444" },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Ionicons name="alert-circle" size={20} color="#ef4444" />
              <Text style={{ fontSize: 16, fontWeight: "bold", color: "#ef4444", marginLeft: 8 }}>
                Error
              </Text>
            </View>
            <Text style={{ color: isDarkmode ? "#fca5a5" : "#991b1b" }}>{error}</Text>
            <TouchableOpacity
              onPress={analyzeProjects}
              style={{
                marginTop: 12,
                paddingVertical: 8,
                paddingHorizontal: 16,
                backgroundColor: accentColor,
                borderRadius: 8,
                alignSelf: "flex-start",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Insights Display */}
        {insights && !loading && (
          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
              <Ionicons name="bulb" size={20} color="#f59e0b" />
              <Text
                style={{ fontSize: 16, fontWeight: "bold", color: textColor, marginLeft: 8 }}
              >
                AI-Generated Insights
              </Text>
            </View>
            <Text style={{ fontSize: 14, color: textColor, lineHeight: 22 }}>
              {insights}
            </Text>
          </View>
        )}

        {/* No Data State */}
        {!loading && !insights && !error && projects.length === 0 && (
          <View style={[styles.card, { backgroundColor: cardBg, alignItems: "center" }]}>
            <Ionicons name="folder-open-outline" size={48} color={subTextColor} />
            <Text style={{ color: subTextColor, marginTop: 16, textAlign: "center" }}>
              No project data available for analysis.
            </Text>
          </View>
        )}
      </ScrollView>
    </Layout>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
});
