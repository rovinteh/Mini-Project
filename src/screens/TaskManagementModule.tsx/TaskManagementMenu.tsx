import React, { useState, useEffect } from "react";
import { View, TouchableOpacity, StyleSheet, Dimensions, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { getAuth } from "firebase/auth";
import { MainStackParamList } from "../../types/navigation";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Layout,
  Text,
  useTheme,
  themeColor,
  Button,
  TopNav,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { GlassView } from "expo-glass-effect";
import TaskList from "./TaskList";
import TaskAdd from "./TaskAdd";
import TeamManagement from "./TeamManagement";
import TaskQRScanner from "./TaskQRScanner";
import { LineChart } from "react-native-chart-kit";
import { BarChart } from "react-native-gifted-charts";

import { useTaskData, useAITaskAnalysis, toDate, useUserTeamsStats, useProjectNameResolver, useProjectData, useProjectFullTasks } from "./TaskHooks";
import { DEFAULT_PROJECT_ID, DEFAULT_TEAM_ID } from "./data";

export default function ({
  navigation,
}: NativeStackScreenProps<MainStackParamList, "TaskManagementMenu">) {
  const { isDarkmode, setTheme } = useTheme();
  // State for Bottom Tabs: 'list', 'calendar', 'menu', 'add', or 'team'
  const [activeTab, setActiveTab] = useState<"list" | "calendar" | "menu" | "add" | "team" | "scanner">("menu");
  const [pendingSelection, setPendingSelection] = useState<{ projectId: string, teamId: string } | null>(null);

  // Lifted State for Persistence
  // Use global task fetch (no args) so we see ALL tasks created by user across all projects
  const { loading, taskArray, setTaskArray } = useTaskData();
  


  // 2. LIST PRIORITIZATION (GEMINI - Cloud AI)
  const { 
    aiBriefing, aiBriefingLoading, aiSuggestions, aiAccepted, 
    setAiAccepted, setAiSuggestions, analyzeTasksWithAI,
    focusTasks, setFocusTasks
  } = useAITaskAnalysis(taskArray, "gemini");

  // 3. TEAM STATS
  const { stats: teamStats, loading: teamStatsLoading } = useUserTeamsStats();

  // 4. PROJECT NAMES RESOLVER
  const { projects: userProjects } = useProjectData();
  const allProjectIds = React.useMemo(() => userProjects.map(p => p.id), [userProjects]);
  const projectNames = useProjectNameResolver(allProjectIds);

  // 5. GLOBAL PROJECT STATS (For Charts)
  const { tasks: fullProjectTasks, loading: chartLoading } = useProjectFullTasks(allProjectIds);

  // Theme colors
  const bgColor = isDarkmode ? "#0f172a" : "#f8fafc";
  const navColor = isDarkmode ? "#1e293b" : "#ffffff";
  const activeColor = "#3b82f6"; // Blue-500
  const inactiveColor = isDarkmode ? "#64748b" : "#94a3b8";
  const borderColor = isDarkmode ? "#334155" : "#e2e8f0";
  const cardBg = isDarkmode ? "#1e293b" : "#ffffff";
  const textColor = isDarkmode ? "#fff" : "#0f172a";
  const subTextColor = isDarkmode ? "#94a3b8" : "#64748b";

  // --- IGNORE HARMLESS WEB WARNINGS ---
  // --- IGNORE HARMLESS WEB WARNINGS ---
  useEffect(() => {
    const originalError = console.error;
    const originalWarn = console.warn;

    const shouldIgnore = (args: any[]) => {
      const msg = args.join(" ");
      return (
        msg.includes("Invalid DOM property") ||
        msg.includes("transform-origin") ||
        msg.includes("Unknown event handler property") ||
        msg.includes("onStartShouldSetResponder") ||
        msg.includes("onResponderGrant") ||
        msg.includes("onResponderMove") ||
        msg.includes("onResponderRelease") ||
        msg.includes("onResponderTerminate") ||
        msg.includes("onResponderTerminationRequest") ||
        msg.includes("The action 'NAVIGATE'") ||
        msg.includes("Unexpected text node")
      );
    };

    console.error = (...args) => {
      if (shouldIgnore(args)) return;
      originalError(...args);
    };

    console.warn = (...args) => {
      if (shouldIgnore(args)) return;
      originalWarn(...args);
    };

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

  // --- GREETING CONTEXT ---
  const auth = getAuth();
  const userName = auth.currentUser?.displayName?.split(" ")[0] || "User";
  
  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good Morning";
    if (h < 18) return "Good Afternoon";
    return "Good Evening";
  };
  
  const todayDate = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', month: 'long', day: 'numeric' 
  });

  // --- DASHBOARD CALCULATIONS ---
  // Helper function to normalize dates to start of day for comparison
  const toStartOfDay = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const now = new Date();
  const todayStart = toStartOfDay(now);
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);

  // 1. PENDING: count of !isCompleted
  const pendingCount = taskArray.filter(t => !t.isCompleted).length;

  // 2. DUE TODAY: count due by 23:59 local
  const dueTodayCount = taskArray.filter(t => {
    if (t.isCompleted || !t.dueDate) return false;
    const dueDate = new Date(t.dueDate.seconds ? t.dueDate.seconds * 1000 : t.dueDate);
    return dueDate >= todayStart && dueDate <= todayEnd;
  }).length;

  // 3. OVERDUE: count due < now
  const overdueCount = taskArray.filter(t => {
    if (t.isCompleted || !t.dueDate) return false;
    const dueDate = new Date(t.dueDate.seconds ? t.dueDate.seconds * 1000 : t.dueDate);
    return dueDate < now;
  }).length;

  // 4. URGENT: "High" priority OR AI-score ≥ threshold
  const URGENT_SCORE_THRESHOLD = 7.5;
  const urgentCount = taskArray.filter(t => {
    if (t.isCompleted) return false;
    const isHighPriority = t.priority === "High";
    const hasHighScore = (t._score || 0) >= URGENT_SCORE_THRESHOLD;
    return isHighPriority || hasHighScore;
  }).length;
  
  // Weekly Completion Trend
  const getWeeklyData = () => {
    // Helper to get local YYYY-MM-DD
    const toLocalISO = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().split('T')[0];
    };

    const today = new Date();
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(today.getDate() - (6 - i));
      return d;
    });

    const last7Dates = last7Days.map(d => toLocalISO(d));
    const last7Labels = last7Days.map(d => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })); // 11 Dec

    const completedCounts = last7Dates.map(dateStr => 
      taskArray.filter(t => {
          if (!t.isCompleted) return false;
          const d = toDate(t.progress?.completedDate || t.updatedDate); 
          return d && toLocalISO(d) === dateStr;
      }).length
    );

    const plannedCounts = last7Dates.map(dateStr => 
        taskArray.filter(t => {
            // "Planned" (Pending) Logic Update:
            // 1. Must be created on or before this day
            const created = toDate(t.date); 
            // If creation date exists and is in the future relative to this chart day, ignore.
            // If missing -> assume valid old task
            if (created && toLocalISO(created) > dateStr) return false;

            // 2. Must NOT be completed by the end of this day
            if (t.isCompleted) {
                const completed = toDate(t.progress?.completedDate || t.updatedDate);
                // If completed date is valid and <= today, it is done, so NOT pending.
                if (completed && toLocalISO(completed) <= dateStr) return false;
            }
            
            // If not completed, or completed in future -> It is pending.
            return true;
        }).length
    );

    const maxCount = Math.max(...completedCounts, ...plannedCounts);
    return { labels: last7Labels, completed: completedCounts, planned: plannedCounts, max: maxCount };
  };

  const chartData = getWeeklyData();


  const completedThisWeek = chartData.completed.reduce((a, b) => a + b, 0);
  const plannedThisWeek = chartData.planned.reduce((a, b) => a + b, 0);
  const efficiency = plannedThisWeek > 0 ? Math.round((completedThisWeek / plannedThisWeek) * 100) : 0;

  // Urgent Tasks


  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      
      {/* Content Area */}
      <View style={{ flex: 1 }}>
        {activeTab === "menu" ? (
           <Layout>
             <TopNav
                middleContent="Dashboard"
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
                style={{ flex: 1 }} 
                contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
                refreshControl={<RefreshControl refreshing={loading} />}
                showsVerticalScrollIndicator={false}
              >

               {/* 0. GREETING ROW */}
               <View style={{ marginBottom: 20 }}>
                  <Text style={{ fontSize: 28, fontWeight: 'bold', color: textColor }}>
                    {getGreeting()}, {userName} 👋
                  </Text>
                  <Text style={{ fontSize: 14, color: subTextColor, marginTop: 4 }}>
                    {todayDate}
                  </Text>
               </View>


               
               {/* 1. KEY METRICS GRID (2x2) */}
               <View style={{ marginBottom: 20 }}>
                  {/* First Row */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                     {/* Pending */}
                     <View style={{ 
                         backgroundColor: cardBg, 
                         width: '48%', 
                         padding: 14, 
                         borderRadius: 16, 
                         alignItems: 'flex-start',
                         borderLeftWidth: 4,
                         borderLeftColor: '#3b82f6',
                         shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 5, elevation: 2
                     }}>
                         <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <Ionicons name="list" size={18} color="#3b82f6" style={{ marginRight: 6 }} />
                            <Text style={{ fontSize: 11, color: subTextColor, fontWeight: '600' }}>PENDING</Text>
                         </View>
                         <Text style={{ fontSize: 24, fontWeight: 'bold', color: textColor }}>{pendingCount}</Text>
                     </View>

                     {/* Due Today */}
                     <View style={{ 
                         backgroundColor: cardBg, 
                         width: '48%', 
                         padding: 14, 
                         borderRadius: 16, 
                         alignItems: 'flex-start',
                         borderLeftWidth: 4,
                         borderLeftColor: '#f59e0b',
                         shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 5, elevation: 2
                     }}>
                         <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <Ionicons name="today" size={18} color="#f59e0b" style={{ marginRight: 6 }} />
                            <Text style={{ fontSize: 11, color: subTextColor, fontWeight: '600' }}>DUE TODAY</Text>
                         </View>
                         <Text style={{ fontSize: 24, fontWeight: 'bold', color: textColor }}>{dueTodayCount}</Text>
                     </View>
                  </View>

                  {/* Second Row */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                     {/* Overdue */}
                     <View style={{ 
                         backgroundColor: cardBg, 
                         width: '48%', 
                         padding: 14, 
                         borderRadius: 16, 
                         alignItems: 'flex-start',
                         borderLeftWidth: 4,
                         borderLeftColor: '#ef4444',
                         shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 5, elevation: 2
                     }}>
                         <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <Ionicons name="alert-circle" size={18} color="#ef4444" style={{ marginRight: 6 }} />
                            <Text style={{ fontSize: 11, color: subTextColor, fontWeight: '600' }}>OVERDUE</Text>
                         </View>
                         <Text style={{ fontSize: 24, fontWeight: 'bold', color: textColor }}>{overdueCount}</Text>
                     </View>

                     {/* Urgent */}
                     <View style={{ 
                         backgroundColor: cardBg, 
                         width: '48%', 
                         padding: 14, 
                         borderRadius: 16, 
                         alignItems: 'flex-start',
                         borderLeftWidth: 4,
                         borderLeftColor: '#8b5cf6',
                         shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 5, elevation: 2
                     }}>
                         <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <Ionicons name="flame" size={18} color="#8b5cf6" style={{ marginRight: 6 }} />
                            <Text style={{ fontSize: 11, color: subTextColor, fontWeight: '600' }}>URGENT</Text>
                         </View>
                         <Text style={{ fontSize: 24, fontWeight: 'bold', color: textColor }}>{urgentCount}</Text>
                     </View>
                  </View>
               </View>


               {/* 3. PRODUCTIVITY CHART */}
               <View style={{ backgroundColor: cardBg, borderRadius: 16, padding: 16, marginBottom: 20, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 }}>
                  <Text style={{ fontSize: 16, fontWeight: 'bold', color: textColor, marginBottom: 16 }}>Productivity Trend</Text>
                  <LineChart
                    data={{
                      labels: chartData.labels,
                      datasets: [
                        { data: chartData.completed, color: (opacity = 1) => `rgba(16, 185, 129, ${opacity})`, strokeWidth: 2 }, // Green
                        { data: chartData.planned, color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, strokeWidth: 2 } // Blue
                      ],
                      legend: ["Completed", "Planned"]
                    }}
                    width={Dimensions.get("window").width - 72}
                    height={200}
                    yAxisInterval={1}
                    fromZero={true}
                    segments={chartData.max < 5 ? (chartData.max || 1) : 4}
                    chartConfig={{
                      backgroundColor: cardBg,
                      backgroundGradientFrom: cardBg,
                      backgroundGradientTo: cardBg,
                      decimalPlaces: 0,
                      color: (opacity = 1) => subTextColor,
                      labelColor: (opacity = 1) => subTextColor,
                      style: { borderRadius: 16 },
                      propsForDots: { r: "4", strokeWidth: "2", stroke: "#ffa726" }
                    }}
                    bezier
                    style={{ marginVertical: 8, borderRadius: 16 }}
                  />
               </View>

               {/* 4. TEAM SIZE CHART */}
               <View style={{ backgroundColor: cardBg, borderRadius: 16, padding: 16, marginBottom: 20, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 }}>
                  <View style={{ marginBottom: 16 }}>
                      <Text style={{ fontSize: 16, fontWeight: 'bold', color: textColor, marginBottom: 8 }}>Active Team Members</Text>
                      <View>
                        {/* Legend */}
                        {(() => {
                           const stats = teamStats || [];
                           const projects = Array.from(new Set(stats.map((s: any) => s.projectName))).sort();
                           const PALETTE = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444"];
                           return (
                             <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                               {projects.map((p, i) => (
                                 <View key={p as string} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16, marginBottom: 4 }}>
                                   <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PALETTE[i % PALETTE.length], marginRight: 6 }} />
                                   <Text style={{ fontSize: 12, color: subTextColor }}>{p}</Text>
                                 </View>
                               ))}
                             </View>
                           );
                        })()}
                      </View>
                  </View>
                  
                  {loading || teamStatsLoading ? (
                      <ActivityIndicator size="small" color={activeColor} />
                  ) : (
                      <BarChart
                        data={(() => {
                            const stats = teamStats || [];
                            if (stats.length === 0) return [{ value: 0, label: 'No Teams', frontColor: subTextColor }];
                            
                            const PALETTE = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444"];
                            const projectColorMap: Record<string, string> = {};
                            const projects = Array.from(new Set(stats.map((s: any) => s.projectName))).sort();
                            projects.forEach((p, i) => projectColorMap[p as string] = PALETTE[i % PALETTE.length]);

                            const sortedStats = [...stats].sort((a: any, b: any) => {
                                if (a.projectName === b.projectName) return a.teamName.localeCompare(b.teamName);
                                return a.projectName.localeCompare(b.projectName);
                            });

                            return sortedStats.map((s: any, i: number) => {
                              const isNewProject = i > 0 && s.projectName !== sortedStats[i-1].projectName;
                              return {
                                value: s.value,
                                label: s.teamName.length > 10 ? s.teamName.substring(0, 10) + '..' : s.teamName,
                                frontColor: projectColorMap[s.projectName] || activeColor,
                                spacing: isNewProject ? 80 : 40, 
                                labelTextStyle: { color: subTextColor, fontSize: 10, textAlign: 'center', width: 100 }, 
                                topLabelComponent: () => null 
                            };
                          });
                        })()}
                        barWidth={22}
                        xAxisThickness={0}
                        yAxisThickness={0}
                        yAxisTextStyle={{ color: subTextColor, fontSize: 10 }}
                        noOfSections={4} 
                        maxValue={(() => {
                             const maxVal = Math.max(...(teamStats?.map((s: any) => s.value) || [0]), 4);
                             return maxVal % 2 === 0 ? maxVal : maxVal + 1; 
                        })()} 
                        stepValue={(() => {
                             const maxVal = Math.max(...(teamStats?.map((s: any) => s.value) || [0]), 4);
                             const evenMax = maxVal % 2 === 0 ? maxVal : maxVal + 1;
                             return evenMax / 4; 
                        })()} 
                        labelWidth={30}
                        xAxisLabelTextStyle={{ color: subTextColor, fontSize: 10, textAlign: 'center' }}
                        width={Dimensions.get("window").width - 150}
                      />
                  )}
               </View>

               {/* 5. PROJECT TRENDS (Moved to Bottom) */}
               <View style={{ backgroundColor: cardBg, borderRadius: 16, padding: 16, marginBottom: 80, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 }}>
                   <View style={{ marginBottom: 16 }}>
                     <Text style={{ fontSize: 16, fontWeight: 'bold', color: textColor }}>Project Progress</Text>
                   </View>
                  {(() => {
                      // DEBUG: Log the data we're working with
                      console.log("=== PROJECT PROGRESS DEBUG ===");
                      console.log("Total tasks from hook:", fullProjectTasks.length);
                      console.log("Chart loading state:", chartLoading);
                      console.log("Projects:", allProjectIds);
                      if (fullProjectTasks.length > 0) {
                          console.log("Sample task:", fullProjectTasks[0]);
                          console.log("Tasks by project:", allProjectIds.map(pid => ({
                              projectId: pid,
                              projectName: projectNames[pid],
                              taskCount: fullProjectTasks.filter(t => (t.projectId || DEFAULT_PROJECT_ID) === pid).length
                          })));
                      }
                      // 1. Get Project Names (Already fetched at top level)
                      // const allProjectIds passed from top level
                      // const projectNames passed from top level

                      // 2. Prepare Last 7 Days
                      const last7Days = Array.from({ length: 7 }, (_, i) => {
                          const d = new Date();
                          d.setDate(d.getDate() - (6 - i));
                          d.setHours(23, 59, 59, 999); // End of day
                          return d;
                      });
                      const labels = last7Days.map(d => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })); // 11 Dec

                      // 3. Build Datasets
                      // Only show top 3 active projects
                      const activeProjects = allProjectIds
                          .map(pid => ({ pid, count: fullProjectTasks.filter(t => (t.projectId || DEFAULT_PROJECT_ID) === pid).length }))
                          .sort((a, b) => b.count - a.count)
                          .slice(0, 3)
                          .map(p => p.pid);

                      const PALETTE = ["#10b981", "#3b82f6", "#f59e0b"]; // Green, Blue, Amber

                      const datasets = activeProjects.map((pid, index) => {
                          const data = last7Days.map(dayTime => {
                              const dayMs = dayTime.getTime();
                              const projectTasks = fullProjectTasks.filter(t => (t.projectId || DEFAULT_PROJECT_ID) === pid);
                              
                              let completedCount = 0;
                              let totalScopeCount = 0;

                              projectTasks.forEach(t => {
                                  // SCOPE: Assume all tasks existed? Or check createdAt?
                                  // Fallback: if no createdAt, assume it's valid scope.
                                  // Better: Check created date if available.
                                  // t.created? t.createdDate? t.createdAt? 
                                  // Inspecting hooks: create uses 'created' or 'createdDate' or 'startDate'? 
                                  // Safe fallback: count it.
                                  totalScopeCount++;
                                  
                                  // COMPLETION:
                                  if (t.isCompleted) {
                                      if (t.progress?.completedDate) {
                                          if (t.progress.completedDate <= dayMs) {
                                              completedCount++;
                                          }
                                      } else {
                                          // Missing date fallback: Assume historical (completed long ago)
                                          completedCount++;
                                      }
                                  }
                              });

                              return totalScopeCount > 0 ? (completedCount / totalScopeCount) * 100 : 0;
                          });

                          return {
                              data,
                              color: (opacity = 1) => PALETTE[index % PALETTE.length], 
                              strokeWidth: 2,
                              legend: projectNames[pid] || "Loading..."
                          };
                      });

                      if (datasets.length === 0) {
                          return (
                              <View>
                                  <Text style={{ color: subTextColor, marginBottom: 12 }}>
                                      {chartLoading ? "⏳ Loading chart data..." : "❌ No tasks found for your projects."}
                                  </Text>
                                  {!chartLoading && fullProjectTasks.length === 0 && (
                                      <View style={{ padding: 12, backgroundColor: isDarkmode ? '#334155' : '#f1f5f9', borderRadius: 8 }}>
                                          <Text style={{ fontSize: 12, color: subTextColor, marginBottom: 8 }}>
                                              🔍 <Text style={{ fontWeight: '600' }}>Troubleshooting:</Text>
                                          </Text>
                                          <Text style={{ fontSize: 11, color: subTextColor, marginBottom: 4 }}>
                                              • Check your terminal for a Firestore Index link
                                          </Text>
                                          <Text style={{ fontSize: 11, color: subTextColor, marginBottom: 4 }}>
                                              • Click the link to create the required index
                                          </Text>
                                          <Text style={{ fontSize: 11, color: subTextColor }}>
                                              • Wait 2-3 minutes for index to build, then refresh
                                          </Text>
                                      </View>
                                  )}
                              </View>
                          );
                      }

                      return (
                          <View>
                           <LineChart
                            data={{
                              labels: labels,
                              datasets: datasets,
                              legend: datasets.map(d => d.legend)
                            }}
                            width={Dimensions.get("window").width - 100}
                            height={220}
                            yAxisSuffix="%"
                            yAxisInterval={1}
                            verticalLabelRotation={45}
                            xLabelsOffset={-10}
                            key={JSON.stringify(datasets)} // Force re-render on data update
                            chartConfig={{
                              backgroundColor: cardBg,
                              backgroundGradientFrom: cardBg,
                              backgroundGradientTo: cardBg,
                              decimalPlaces: 0,
                              color: (opacity = 1) => subTextColor,
                              labelColor: (opacity = 1) => subTextColor,
                              propsForDots: { r: "4", strokeWidth: "2", stroke: "#ffa726" },
                              propsForBackgroundLines: { strokeDasharray: "" } // Solid lines
                            }}
                            bezier
                            style={{ marginVertical: 8, borderRadius: 16 }}
                          />
                          </View>
                      );
                   })()}

                   {/* AI Analytics Button */}
                   <TouchableOpacity
                     onPress={() => {
                       navigation.navigate("AIAnalytics", {
                         projects: userProjects,
                         tasks: fullProjectTasks,
                         metrics: {
                           pendingCount,
                           dueTodayCount,
                           overdueCount,
                           urgentCount,
                           completedThisWeek,
                           plannedThisWeek,
                           efficiency,
                         },
                       });
                     }}
                     style={{
                       marginTop: 16,
                       backgroundColor: isDarkmode ? '#1e293b' : '#3b82f6',
                       paddingVertical: 14,
                       paddingHorizontal: 20,
                       borderRadius: 12,
                       borderWidth: 2,
                       borderColor: '#3b82f6',
                       flexDirection: 'row',
                       alignItems: 'center',
                       justifyContent: 'center',
                       shadowColor: '#3b82f6',
                       shadowOffset: { width: 0, height: 4 },
                       shadowOpacity: 0.3,
                       shadowRadius: 8,
                       elevation: 5,
                     }}
                     activeOpacity={0.8}
                   >
                     <Ionicons 
                       name="analytics" 
                       size={20} 
                       color={isDarkmode ? '#3b82f6' : '#fff'} 
                       style={{ marginRight: 8 }}
                     />
                     <Text style={{ 
                       fontSize: 15, 
                       fontWeight: '700', 
                       color: isDarkmode ? '#3b82f6' : '#fff',
                       textAlign: 'center',
                     }}>
                       Need More Insights? Try Click Me Out
                     </Text>
                     <Ionicons 
                       name="arrow-forward" 
                       size={18} 
                       color={isDarkmode ? '#3b82f6' : '#fff'} 
                       style={{ marginLeft: 8 }}
                     />
                   </TouchableOpacity>
                </View>
             </ScrollView>
           </Layout>
        ) : activeTab === "add" ? (
             <TaskAdd
                navigation={navigation as any}
                route={{} as any} // Mock route, we use props for data
                onBack={() => setActiveTab("menu")}
                onSuccess={() => setActiveTab("list")}
             />
        ) : activeTab === "team" ? (
             <TeamManagement 
                navigation={navigation as any} 
                route={{} as any} 
                pendingSelection={pendingSelection}
                onSelectionHandled={() => setPendingSelection(null)}
             />
        ) : activeTab === "scanner" ? (
             <TaskQRScanner 
                navigation={navigation as any} 
                route={{} as any} 
                onJoinSuccess={(pid, tid) => {
                    setPendingSelection({ projectId: pid, teamId: tid });
                    setActiveTab("team");
                }}
             />
        ) : (
            <TaskList 
                navigation={navigation as any}
                route={{} as any}
                viewMode={activeTab as "list" | "calendar"} 
                
                // Pass Lifted State
                loading={loading}
                taskArray={taskArray}
                setTaskArray={setTaskArray}
                
                aiBriefing={aiBriefing}
                aiBriefingLoading={aiBriefingLoading}
                aiSuggestions={aiSuggestions}
                aiAccepted={aiAccepted}
                setAiAccepted={setAiAccepted}
                setAiSuggestions={setAiSuggestions}
                analyzeTasksWithAI={analyzeTasksWithAI}
                
                focusTasks={focusTasks}
                setFocusTasks={setFocusTasks}
            />
        )}
      </View>

      {/* Custom Bottom Tab Bar */}
      {/* Custom Bottom Tab Bar with Glass Effect */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 85,
          overflow: 'hidden', // Ensure glass doesn't bleed if we add rounded corners
          borderTopWidth: 1,
          borderTopColor: isDarkmode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
        }}
      >
          {/* Glass Background */}
          <GlassView 
            style={StyleSheet.absoluteFill} 
            glassEffectStyle="regular" 
          />

          {/* Content Container */}
          <View style={{ 
             flexDirection: 'row', 
             flex: 1, 
             paddingBottom: 20, 
             paddingTop: 10 
          }}>
            {/* List View Tab */}
            <TouchableOpacity 
              onPress={() => setActiveTab("list")}
              style={styles.tabItem}
              activeOpacity={0.7}
            >
                <View style={[styles.iconContainer, activeTab === "list" && { backgroundColor: `${activeColor}20` }]}>
                  <Ionicons 
                      name={activeTab === "list" ? "list" : "list-outline"} 
                      size={24} 
                      color={activeTab === "list" ? activeColor : inactiveColor} 
                  />
                </View>
                <Text style={{ 
                    fontSize: 10, 
                    fontWeight: "700", 
                    color: activeTab === "list" ? activeColor : inactiveColor,
                    marginTop: 4
                }}>
                    List
                </Text>
            </TouchableOpacity>

            {/* Add Task Tab (Prominent) */}
            <TouchableOpacity 
              onPress={() => setActiveTab("add")}
              style={[styles.tabItem, { flex: 1.2 }]} // Slightly wider
              activeOpacity={0.8}
            >
                <View style={{
                    width: 50,
                    height: 50,
                    borderRadius: 25,
                    backgroundColor: activeColor,
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginBottom: 4,
                    shadowColor: activeColor,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 5,
                    elevation: 5
                }}>
                  <Ionicons 
                      name="add" 
                      size={32} 
                      color="#fff" 
                  />
                </View>
            </TouchableOpacity>

            {/* Scanner Tab (Right of Add) */}
            <TouchableOpacity 
              onPress={() => setActiveTab("scanner")}
              style={[styles.tabItem, { flex: 1.2 }]} 
              activeOpacity={0.8}
            >
                <View style={[styles.iconContainer, activeTab === "scanner" && { backgroundColor: `${activeColor}20` }]}>
                  <Ionicons 
                      name={activeTab === "scanner" ? "scan" : "scan-outline"} 
                      size={24} 
                      color={activeTab === "scanner" ? activeColor : inactiveColor} 
                  />
                </View>
                <Text style={{ 
                    fontSize: 10, 
                    fontWeight: "700", 
                    color: activeTab === "scanner" ? activeColor : inactiveColor,
                    marginTop: 4
                }}>
                    Scan
                </Text>
            </TouchableOpacity>

            {/* Menu Tab */}
            <TouchableOpacity 
              onPress={() => setActiveTab("menu")}
              style={styles.tabItem}
              activeOpacity={0.7}
            >
                <View style={[styles.iconContainer, activeTab === "menu" && { backgroundColor: `${activeColor}20` }]}>
                  <Ionicons 
                      name={activeTab === "menu" ? "grid" : "grid-outline"} 
                      size={24} 
                      color={activeTab === "menu" ? activeColor : inactiveColor} 
                  />
                </View>
                <Text style={{ 
                    fontSize: 10, 
                    fontWeight: "700", 
                    color: activeTab === "menu" ? activeColor : inactiveColor,
                    marginTop: 4
                }}>
                    Menu
                </Text>
            </TouchableOpacity>

            {/* Calendar View Tab */}
            <TouchableOpacity 
              onPress={() => setActiveTab("calendar")}
              style={styles.tabItem}
              activeOpacity={0.7}
            >
                <View style={[styles.iconContainer, activeTab === "calendar" && { backgroundColor: `${activeColor}20` }]}>
                  <Ionicons 
                      name={activeTab === "calendar" ? "calendar" : "calendar-outline"} 
                      size={24} 
                      color={activeTab === "calendar" ? activeColor : inactiveColor} 
                  />
                </View>
                <Text style={{ 
                    fontSize: 10, 
                    fontWeight: "700", 
                    color: activeTab === "calendar" ? activeColor : inactiveColor,
                    marginTop: 4
                }}>
                    Calendar
                </Text>
            </TouchableOpacity>
            {/* Team Tab */}
            <TouchableOpacity 
              onPress={() => setActiveTab("team")}
              style={styles.tabItem}
              activeOpacity={0.7}
            >
                <View style={[styles.iconContainer, activeTab === "team" && { backgroundColor: `${activeColor}20` }]}>
                  <Ionicons 
                      name={activeTab === "team" ? "people" : "people-outline"} 
                      size={24} 
                      color={activeTab === "team" ? activeColor : inactiveColor} 
                  />
                </View>
                <Text style={{ 
                    fontSize: 10, 
                    fontWeight: "700", 
                    color: activeTab === "team" ? activeColor : inactiveColor,
                    marginTop: 4
                }}>
                    Team
                </Text>
            </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
    tabItem: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
    },
    iconContainer: {
        paddingHorizontal: 20,
        paddingVertical: 5,
        borderRadius: 20,
    }
});
