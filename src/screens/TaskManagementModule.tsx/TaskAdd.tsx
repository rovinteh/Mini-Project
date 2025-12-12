import React, { useState, useEffect, useRef } from "react";
import { View, Platform, KeyboardAvoidingView, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions } from "react-native";
import DropDownPicker from "react-native-dropdown-picker";
import { MainStackParamList } from "../../types/navigation";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { DEFAULT_PROJECT_ID, DEFAULT_TEAM_ID } from "./data";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  TextInput,
  Button,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import {
  getFirestore,
  addDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
import { ImageSlider } from "react-native-image-slider-banner";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ScrollView } from "react-native";
import { formatDetailedDate, useProjectData, useTeamData, AIService } from "./TaskHooks";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Theme colors (matching TaskList)
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

const TaskAdd = ({
  navigation,
  route,
  onBack,
  onSuccess,
  presetDate: propPresetDate
}: NativeStackScreenProps<MainStackParamList, "TaskAdd"> & { onBack?: () => void, onSuccess?: () => void, presetDate?: string }) => {
  const { isDarkmode, setTheme } = useTheme();
  const auth = getAuth();
  const dateInputRef = useRef<any>(null);
  const db = getFirestore();

  useEffect(() => {
    if (propPresetDate) {
      setDueDate(new Date(propPresetDate));
    } else if (route.params?.presetDate) {
      setDueDate(new Date(route.params.presetDate));
    }
    
    if (route.params?.projectId) setSelectedProjectId(route.params.projectId);
    if (route.params?.teamId) setSelectedTeamId(route.params.teamId);
  }, [route.params?.presetDate, propPresetDate, route.params?.projectId, route.params?.teamId]);

  // Project & Team Selection
  const [selectedProjectId, setSelectedProjectId] = useState(DEFAULT_PROJECT_ID);
  const [selectedTeamId, setSelectedTeamId] = useState(DEFAULT_TEAM_ID);
  
  const { projects } = useProjectData();
  const { teams } = useTeamData(selectedProjectId);
  const [projectOpen, setProjectOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);

  const [listName, setListName] = useState("");
  const [taskName, setTaskName] = useState("");
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<{ img: string }[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [dueDate, setDueDate] = useState<Date | null>(null);

  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityValue, setPriorityValue] = useState<string | null>(null);
  const [effortValue, setEffortValue] = useState<string>("Medium"); // Default but updated by AI

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPriorityHelp, setShowPriorityHelp] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false); // Success Toast State

  const [existingLists, setExistingLists] = useState<{ label: string; value: string }[]>([]);
  const [listDropdownOpen, setListDropdownOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [useNewList, setUseNewList] = useState(false);

  const onChangeDueDate = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) setDueDate(selectedDate);
  };

  const emptyState = () => {
    setListName("");
    setNewListName("");
    setTaskName("");
    setNotes("");
    setImages([]);
    setPriorityValue(null);
    setEffortValue("Medium");
    setUseNewList(false);
    setSelectedDependencies([]); // Reset dependencies
  };

  // State for dependencies
  const [availableTasks, setAvailableTasks] = useState<any[]>([]);
  const [selectedDependencies, setSelectedDependencies] = useState<string[]>([]);

  const suggestWithAI = async () => {
    if (!taskName.trim()) return alert("Please enter a task name first.");
    if (!dueDate) return alert("Please select a due date first so AI can assess urgency.");
    setAiLoading(true);

    // 1. Context Gathering
    const currentList = useNewList ? newListName : listName;
    let listContext = "No specific list selected.";
    let taskCountInList = 0;

    if (currentList && auth.currentUser) {
      // Query how many tasks are already in this list
      try {
        const q = query(
          collection(db, `Projects/${selectedProjectId}/Teams/${selectedTeamId}/Tasks`),
          where("CreatedUser.CreatedUserId", "==", auth.currentUser.uid),
          where("listName", "==", currentList)
        );
        const snapshot = await getDocs(q);
        taskCountInList = snapshot.size;
        listContext = `Task belongs to list '${currentList}', which already has ${taskCountInList} pending tasks.`;
      } catch (e) {
        console.log("Error fetching list context", e);
      }
    }

    // 2. Date Context
    let dateContext = "No due date set.";
    if (dueDate) {
      const today = new Date();
      const diffTime = dueDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      dateContext = `Due Date: ${dueDate.toISOString().split('T')[0]} (${diffDays} days remaining).`;
      if (diffDays < 0) dateContext += " [STATUS: OVERDUE]";
      else if (diffDays <= 0) dateContext += " [STATUS: DUE TODAY]";
      else if (diffDays <= 2) dateContext += " [STATUS: URGENT]";
    }

    try {
      // 3. Construct Prompt
      const prompt = `
      Analyze this task for a productivity app.
      
      Task Name: "${taskName}"
      Notes: "${notes}"
      Context: ${listContext}
      Time Constraints: ${dateContext}
      
      CRITICAL PRIORITY RULES:
      1. COMBINED URGENCY: You must weigh both the semantics of the Task Name AND the Time Constraints.
      2. TIME SENSITIVITY: 
         - If 'STATUS: OVERDUE', 'STATUS: DUE TODAY', or 'STATUS: URGENT' is present, Priority MUST be 'High', regardless of the task name (e.g., "Buy Milk" due today is High).
         - If Due Date is far away (>7 days), Priority should likely be 'Medium' or 'Low' unless the task name implies a critical emergency (e.g., "Fix server crash").
      3. EFFORT RULES:
         - Quick actions (email, call, buy) -> Low Effort.
         - Creation/Deep work -> Medium/High Effort.

      Based on this, suggest:
      1. Priority (High, Medium, or Low)
      2. Effort (High, Medium, or Low)
      
      Respond ONLY in valid JSON format: { "priority": "High|Medium|Low", "effort": "High|Medium|Low" }
      `;

      // Use Centralized Gemini Service
      const text = await AIService.generateInsights(prompt);
      
      if (!text) throw new Error("AI Service returned no data");
      
      // Clean markdown if present
      const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
      
      let result;
      try {
         result = JSON.parse(cleanText);
      } catch (e) {
         // Fallback regex
         const pMatch = cleanText.match(/priority"?: "?(High|Medium|Low)/i);
         const eMatch = cleanText.match(/effort"?: "?(High|Medium|Low)/i);
         result = {
           priority: pMatch ? pMatch[1] : null,
           effort: eMatch ? eMatch[1] : "Medium"
         };
      }

      if (result.priority) {
        // Capitalize first letter just in case
        const p = result.priority.charAt(0).toUpperCase() + result.priority.slice(1).toLowerCase();
        if (["High", "Medium", "Low"].includes(p)) setPriorityValue(p);
      }
      
      if (result.effort) {
        const e = result.effort.charAt(0).toUpperCase() + result.effort.slice(1).toLowerCase();
        if (["High", "Medium", "Low"].includes(e)) setEffortValue(e);
      }
    } finally {
      setAiLoading(false);
    }
  };

  // ... (keep helpers same)
  const getBlobFromUri = async (uri: string) => {
    const blob: Blob = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = () => reject(new TypeError("Network request failed"));
      xhr.responseType = "blob";
      xhr.open("GET", uri, true);
      xhr.send(null);
    });
    return blob;
  };

  useEffect(() => {
    (async () => {
      if (Platform.OS !== "web") {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted")
          alert("We need camera roll permissions to upload images.");
      }
    })();
  }, []);

  useEffect(() => {
    if (auth.currentUser && selectedProjectId && selectedTeamId) {
      const fetchLists = async () => {
        if (!auth.currentUser) return;
        try {
            const q = query(
              collection(db, `Projects/${selectedProjectId}/Teams/${selectedTeamId}/Tasks`),
              where("CreatedUser.CreatedUserId", "==", auth.currentUser.uid)
            );
            const snapshot = await getDocs(q);
            const names = new Set<string>();
            const tasks: any[] = [];
            
            snapshot.forEach((doc) => {
              const data = doc.data();
              if (data.listName) names.add(data.listName);
              
              // Collect pending tasks for dependency selection
              if (!data.isCompleted) {
                tasks.push({
                  key: doc.id,
                  taskName: data.taskName,
                  listName: data.listName,
                  priority: data.priority,
                });
              }
            });
            
            setExistingLists(
              Array.from(names).map((n) => ({ label: n, value: n }))
            );
            setAvailableTasks(tasks);
        } catch (e) {
            console.log("Error fetching lists", e);
        }
      };
      fetchLists();
    }
  }, [auth.currentUser, selectedProjectId, selectedTeamId]);

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 1,
      });
      if (!result.canceled) {
        const selected = result.assets.map((a) => ({ img: a.uri }));
        setImages((prev) => [...prev, ...selected]);
      }
    } catch (error) {
      alert("Error selecting images: " + error);
    }
  };

  const handleTaskNameChange = (text: string) => {
    setTaskName(text);
    // Smart heuristic: if user types "Urgent", set High priority automatically
    if (text.toLowerCase().includes("urgent") && priorityValue !== "High") {
      setPriorityValue("High");
    }
  };

  const handlePress = async () => {
    const finalListName = useNewList ? newListName.trim() : listName;
    if (!finalListName) return alert("List Name is required");
    if (!taskName) return alert("Task Name is required");
    if (!dueDate) return alert("Due Date is required");
    if (!priorityValue) return alert("Priority is required");
    
    setLoading(true);
    const currentUser = auth.currentUser;
    const storage = getStorage();

    if (currentUser) {
      try {
        const startDate = Date.now();
        const imageURLs = await Promise.all(
          images.map(async (item) => {
            const blob = await getBlobFromUri(item.img);
            const guid =
              Date.now().toString(16) + Math.random().toString(16).substring(2);
            const imageRef = ref(storage, `Task/${guid}`);
            await uploadBytes(imageRef, blob);
            return await getDownloadURL(imageRef);
          })
        );

        // Usage of new nested path based on selection
        const taskCollectionRef = collection(db, `Projects/${selectedProjectId}/Teams/${selectedTeamId}/Tasks`);
        await addDoc(taskCollectionRef, {
          listName: finalListName,
          taskName,
          dueDate,
          notes,
          priority: priorityValue,
          effort: effortValue, 
          attachments: imageURLs,
          
          // Save dependencies as the new Object structure directly
          dependencies: {
            block: [],
            blockedBy: selectedDependencies
          },
          dependenciesList: selectedDependencies, // Keep simple list for legacy/indexing
          startDate,
          updatedDate: startDate,
          
          // Initialize Embedded Objects
          progress: {
            actualTimeSpent: 0,
            lastUpdate: startDate,
            startDate: startDate,
            isStalled: false
          },

          // Initialize Priority Score (Best effort calculation for new task)
          priorityScore: {
            urgencyScore: (() => {
               if (!dueDate) return 0;
               const diff = Math.ceil((dueDate.getTime() - Date.now()) / (86400000));
               return diff <= 0 ? 1 : 1 / (diff + 1);
            })(),
            dependencyScore: 0, // Will be updated by system later
            effortScore: effortValue === "Low" ? 1.0 : effortValue === "High" ? 0.3 : 0.6,
            behaviorScore: 0.5,
            finalPriority: 0, // Will be recalculated by client
            explanation: "New Task"
          },

          CreatedUser: {
            CreatedUserId: currentUser.uid,
            CreatedUserName: currentUser.displayName,
            CreatedUserPhoto: currentUser.photoURL,
          },
          projectId: selectedProjectId,
          teamId: selectedTeamId,
          assignedTo: currentUser.uid, // Auto-assign to creator so it shows in My Tasks
        });

        emptyState();
        setLoading(false);
        setSuccessVisible(true);
        setTimeout(() => {
           setSuccessVisible(false);
           if (onSuccess) {
             onSuccess();
           } else {
             navigation.goBack();
           }
        }, 1500);
      } catch (err: any) {
        setLoading(false);
        alert("Error: " + err.message);
      }
    }
  };

  const theme = isDarkmode ? COLORS.dark : COLORS.light;

  // Calculate form progress
  const formProgress = [
    useNewList ? newListName : listName,
    taskName,
    priorityValue,
    dueDate
  ].filter(Boolean).length;
  const progressPercent = (formProgress / 4) * 100;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <Layout>
        {/* Success Overlay */}
        {successVisible && (
          <View style={styles.successOverlay}>
            <View style={[styles.successCard, { backgroundColor: theme.card }]}>
              <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: `${COLORS.success}15`, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <Ionicons name="checkmark-circle" size={48} color={COLORS.success} />
              </View>
              <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text, marginBottom: 4 }}>Task Created!</Text>
              <Text style={{ fontSize: 14, color: theme.textSecondary }}>Redirecting you back...</Text>
            </View>
          </View>
        )}

        <TopNav
          middleContent="Add Task"
          leftContent={
            <Ionicons
              name="chevron-back"
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
            />
          }
          leftAction={() => {
            if (onBack) onBack();
            else navigation.goBack();
          }}
          rightContent={
            <Ionicons
              name={isDarkmode ? "sunny" : "moon"}
              size={20}
              color={isDarkmode ? themeColor.white100 : themeColor.dark}
            />
          }
          rightAction={() => setTheme(isDarkmode ? "light" : "dark")}
        />

        {/* Progress Bar */}
        <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSecondary }}>Task Creation Progress</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.primary }}>{formProgress}/4 fields</Text>
          </View>
          <View style={{ height: 6, backgroundColor: theme.border, borderRadius: 3, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${progressPercent}%`, backgroundColor: COLORS.primary, borderRadius: 3 }} />
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Section 0: Assignment */}
          <View style={{ marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${COLORS.warning}15`, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.warning }}>0</Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Assignment</Text>
            </View>
            
            <View style={[styles.card, { backgroundColor: theme.card, zIndex: 3000 }]}>
               <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSecondary, marginBottom: 8 }}>Project</Text>
               <DropDownPicker
                  theme={isDarkmode ? "DARK" : "LIGHT"}
                  open={projectOpen}
                  value={selectedProjectId}
                  items={projects.map(p => ({ label: p.name, value: p.id }))}
                  setOpen={setProjectOpen}
                  setValue={setSelectedProjectId}
                  setItems={() => {}}
                  onOpen={() => {
                    setTeamOpen(false);
                    setListDropdownOpen(false);
                    setPriorityOpen(false);
                  }}
                  style={{ borderColor: theme.border, backgroundColor: theme.card, marginBottom: 15 }}
                  zIndex={3000}
                  zIndexInverse={1000}
                  listMode="SCROLLVIEW"
               />
               
               <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSecondary, marginBottom: 8 }}>Team</Text>
               <DropDownPicker
                  theme={isDarkmode ? "DARK" : "LIGHT"}
                  open={teamOpen}
                  value={selectedTeamId}
                  items={teams.map(t => ({ label: t.name, value: t.id }))}
                  setOpen={setTeamOpen}
                  setValue={setSelectedTeamId}
                  setItems={() => {}}
                  onOpen={() => {
                    setProjectOpen(false);
                    setListDropdownOpen(false);
                    setPriorityOpen(false);
                  }}
                  style={{ borderColor: theme.border, backgroundColor: theme.card }}
                  zIndex={2000}
                  zIndexInverse={2000}
                  listMode="SCROLLVIEW"
               />
            </View>
          </View>

          {/* Section 1: List Selection */}
          <View style={{ marginBottom: 20, zIndex: 2000 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${COLORS.primary}15`, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.primary }}>1</Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Choose List</Text>
            </View>
            
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <View style={{ zIndex: 2000 }}>
                {!useNewList ? (
                  <View>
                    <DropDownPicker
                      theme={isDarkmode ? "DARK" : "LIGHT"}
                      placeholder="Select a list..."
                      open={listDropdownOpen}
                      value={listName}
                      items={existingLists}
                      setOpen={setListDropdownOpen}
                      setValue={setListName}
                      setItems={setExistingLists}
                      onOpen={() => {
                        setProjectOpen(false);
                        setTeamOpen(false);
                        setPriorityOpen(false);
                      }}
                      onChangeValue={() => setUseNewList(false)}
                      style={{
                        borderColor: theme.border,
                        backgroundColor: theme.card,
                        borderRadius: 12,
                        minHeight: 50,
                      }}
                      textStyle={{ color: theme.text, fontSize: 15 }}
                      placeholderStyle={{ color: theme.textSecondary }}
                      dropDownContainerStyle={{
                        borderColor: theme.border,
                        backgroundColor: theme.card,
                        borderRadius: 12,
                      }}
                      listItemLabelStyle={{ color: theme.text }}
                      zIndex={2000}
                      zIndexInverse={1000}
                      listMode="SCROLLVIEW"
                    />
                    <TouchableOpacity 
                      onPress={() => setUseNewList(true)} 
                      style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingVertical: 4 }}
                    >
                      <Ionicons name="add-circle" size={18} color={COLORS.primary} />
                      <Text style={{ color: COLORS.primary, fontWeight: "600", fontSize: 14, marginLeft: 6 }}>
                        Create New List
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View>
                    <TextInput
                      placeholder="Enter list name..."
                      value={newListName}
                      onChangeText={setNewListName}
                      leftContent={<Ionicons name="folder-outline" size={20} color={theme.textSecondary} />}
                    />
                    <TouchableOpacity 
                      onPress={() => setUseNewList(false)} 
                      style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingVertical: 4 }}
                    >
                      <Ionicons name="arrow-back-circle" size={18} color={COLORS.danger} />
                      <Text style={{ color: COLORS.danger, fontWeight: "600", fontSize: 14, marginLeft: 6 }}>
                        Back to Existing Lists
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Section 2: Task Details */}
          <View style={{ marginBottom: 20, zIndex: 1000 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${COLORS.purple}15`, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.purple }}>2</Text>
                </View>
                <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Task Details</Text>
              </View>

            </View>
            
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              {/* Task Name */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSecondary, marginBottom: 8 }}>Task Name *</Text>
                <TextInput
                  placeholder="What needs to be done?"
                  value={taskName}
                  onChangeText={handleTaskNameChange}
                  leftContent={<Ionicons name="create-outline" size={20} color={theme.textSecondary} />}
                />
              </View>

              {/* Priority Selection */}


              {/* Due Date */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSecondary, marginBottom: 8 }}>Due Date *</Text>
                
                {/* Quick Date Shortcuts */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {[
                    { label: 'Today', days: 0, icon: 'today' },
                    { label: 'Tomorrow', days: 1, icon: 'sunny' },
                    { label: 'Next Week', days: 7, icon: 'calendar' },
                  ].map((shortcut) => {
                    const shortcutDate = new Date();
                    shortcutDate.setDate(shortcutDate.getDate() + shortcut.days);
                    shortcutDate.setHours(23, 59, 59, 999); // Default to End of Day (11:59 PM)
                    const isSelected = dueDate && 
                      dueDate.toDateString() === shortcutDate.toDateString();
                    
                    return (
                      <TouchableOpacity
                        key={shortcut.label}
                        onPress={() => setDueDate(shortcutDate)}
                        style={{
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          paddingVertical: 10,
                          borderRadius: 10,
                          backgroundColor: isSelected ? `${COLORS.primary}15` : theme.cardAlt,
                          borderWidth: 1.5,
                          borderColor: isSelected ? COLORS.primary : 'transparent',
                          gap: 4,
                        }}
                      >
                        <Ionicons 
                          name={shortcut.icon as any} 
                          size={14} 
                          color={isSelected ? COLORS.primary : theme.textSecondary} 
                        />
                        <Text style={{ 
                          fontSize: 12, 
                          fontWeight: '600', 
                          color: isSelected ? COLORS.primary : theme.textSecondary 
                        }}>
                          {shortcut.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {Platform.OS === "web" ? (
                  <View style={{ position: 'relative', width: '100%' }}>
                     <TouchableOpacity
                       activeOpacity={0.6}
                       onPress={() => {
                          if (dateInputRef.current && typeof dateInputRef.current.showPicker === 'function') {
                             dateInputRef.current.showPicker();
                          } else {
                             dateInputRef.current?.focus();
                             dateInputRef.current?.click();
                          }
                       }}
                     >
                        <View style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 14,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: theme.border,
                          backgroundColor: theme.cardAlt,
                        }}>
                          <Text style={{ fontSize: 15, color: theme.text }}>
                            {dueDate ? formatDetailedDate(dueDate) : "Select Due Date & Time"}
                          </Text>
                          <Ionicons name="calendar-outline" size={22} color={theme.textSecondary} />
                        </View>
                     </TouchableOpacity>
                     <input
                       ref={dateInputRef}
                       type="datetime-local"
                       value={dueDate ? new Date(new Date(dueDate).getTime() - new Date(dueDate).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}
                       onChange={(e) => setDueDate(new Date(e.target.value))}
                       style={{
                         position: 'absolute',
                         top: 0,
                         left: 0,
                         width: '100%',
                         height: '100%',
                         opacity: 0,
                         zIndex: -1
                       } as any}
                     />
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => setShowDatePicker(true)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 14,
                      borderRadius: 12,
                      backgroundColor: dueDate ? `${COLORS.primary}08` : theme.cardAlt,
                      borderWidth: 1,
                      borderColor: dueDate ? COLORS.primary : 'transparent',
                    }}
                  >
                    <Ionicons name="calendar" size={20} color={dueDate ? COLORS.primary : theme.textSecondary} />
                    <Text style={{ marginLeft: 12, fontSize: 15, color: dueDate ? theme.text : theme.textSecondary, flex: 1 }}>
                      {dueDate ? formatDetailedDate(dueDate) : "Or pick custom date & time"}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </TouchableOpacity>
                )}
                {showDatePicker && (
                  <DateTimePicker
                    value={dueDate || new Date()}
                    mode="datetime"
                    display="default"
                    onChange={onChangeDueDate}
                  />
                )}
              </View>

              {/* Priority Selection */}
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSecondary }}>Priority *</Text>
                  <TouchableOpacity 
                    onPress={suggestWithAI}
                    disabled={aiLoading}
                    style={{ marginLeft: 6 }}
                  >
                     {aiLoading ? (
                        <ActivityIndicator size="small" color={COLORS.primary} />
                     ) : (
                        <Ionicons name="sparkles" size={16} color={COLORS.primary} />
                     )}
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={() => setShowPriorityHelp(!showPriorityHelp)}
                    style={{ marginLeft: 8 }}
                  >
                     <Ionicons name="help-circle-outline" size={16} color={theme.textSecondary} />
                  </TouchableOpacity>
                  {showPriorityHelp && (
                    <Text style={{ fontSize: 11, color: theme.textSecondary, marginLeft: 8, fontStyle: 'italic' }}>
                      Auto-detect priority from name & due date
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {[
                    { value: 'High', color: COLORS.danger, icon: 'flame' },
                    { value: 'Medium', color: COLORS.warning, icon: 'alert-circle' },
                    { value: 'Low', color: COLORS.success, icon: 'leaf' },
                  ].map((p) => (
                    <TouchableOpacity 
                      key={p.value}
                      onPress={() => setPriorityValue(p.value)}
                      style={{
                        flex: 1,
                        paddingVertical: 14,
                        borderRadius: 12,
                        alignItems: 'center',
                        backgroundColor: priorityValue === p.value ? `${p.color}15` : theme.cardAlt,
                        borderWidth: 2,
                        borderColor: priorityValue === p.value ? p.color : 'transparent',
                      }}
                    >
                      <Ionicons name={p.icon as any} size={20} color={p.color} />
                      <Text style={{ fontSize: 12, fontWeight: '600', color: priorityValue === p.value ? p.color : theme.textSecondary, marginTop: 4 }}>
                        {p.value}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Notes */}
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSecondary }}>Notes (Optional)</Text>
                  <Text style={{ fontSize: 11, color: notes.length > 200 ? COLORS.warning : theme.textSecondary }}>
                    {notes.length}/500
                  </Text>
                </View>
                <TextInput
                  placeholder="Add any additional details, links, or context..."
                  value={notes}
                  onChangeText={(text) => text.length <= 500 && setNotes(text)}
                  numberOfLines={4}
                  multiline={true}
                  textAlignVertical="top"
                  leftContent={<Ionicons name="document-text-outline" size={20} color={theme.textSecondary} style={{marginTop: 8}} />}
                />
              </View>
            </View>
          </View>

          {/* Section 3: Dependencies (Optional) */}
          {availableTasks.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${COLORS.purple}15`, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.purple }}>3</Text>
                </View>
                <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Dependencies</Text>
                <Text style={{ fontSize: 13, color: theme.textSecondary, marginLeft: 8 }}>(Optional)</Text>
              </View>
              
              <View style={[styles.card, { backgroundColor: theme.card }]}>
                <Text style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 12 }}>
                  Select tasks that must be completed before this one:
                </Text>
                
                <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                  {availableTasks.map((t) => {
                    const isSelected = selectedDependencies.includes(t.key);
                    return (
                      <TouchableOpacity
                        key={t.key}
                        onPress={() => {
                          if (isSelected) {
                            setSelectedDependencies(selectedDependencies.filter(d => d !== t.key));
                          } else {
                            setSelectedDependencies([...selectedDependencies, t.key]);
                          }
                        }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 12,
                          paddingHorizontal: 12,
                          marginBottom: 8,
                          borderRadius: 8,
                          backgroundColor: isSelected ? `${COLORS.purple}15` : theme.cardAlt,
                          borderWidth: isSelected ? 2 : 1,
                          borderColor: isSelected ? COLORS.purple : 'transparent',
                        }}
                      >
                        <View style={{
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          borderWidth: 2,
                          borderColor: isSelected ? COLORS.purple : theme.textSecondary,
                          backgroundColor: isSelected ? COLORS.purple : 'transparent',
                          marginRight: 12,
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}>
                          {isSelected && <Ionicons name="checkmark" size={14} color="white" />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
                            {t.taskName}
                          </Text>
                          {t.listName && (
                            <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                              {t.listName}
                            </Text>
                          )}
                        </View>
                        {t.priority && (
                          <View style={{
                            backgroundColor: t.priority === 'High' ? `${COLORS.danger}15` : t.priority === 'Medium' ? `${COLORS.warning}15` : `${COLORS.success}15`,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 6,
                          }}>
                            <Text style={{
                              fontSize: 11,
                              fontWeight: '700',
                              color: t.priority === 'High' ? COLORS.danger : t.priority === 'Medium' ? COLORS.warning : COLORS.success
                            }}>
                              {t.priority}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                
                {selectedDependencies.length > 0 && (
                  <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border }}>
                    <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                      ✓ {selectedDependencies.length} task{selectedDependencies.length > 1 ? 's' : ''} selected as dependencies
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Section 4: Attachments */}
          <View style={{ marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${COLORS.success}15`, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.success }}>4</Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>Attachments</Text>
              <Text style={{ fontSize: 13, color: theme.textSecondary, marginLeft: 8 }}>(Optional)</Text>
            </View>
            
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              {/* Image Grid */}
              {images.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text }}>
                      {images.length} image{images.length > 1 ? 's' : ''} attached
                    </Text>
                    <TouchableOpacity onPress={() => setImages([])}>
                      <Text style={{ fontSize: 12, color: COLORS.danger, fontWeight: '600' }}>Remove All</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {images.map((img, index) => (
                      <View key={index} style={{ position: 'relative' }}>
                        <Image 
                          source={{ uri: img.img }} 
                          style={{ 
                            width: (SCREEN_WIDTH - 100) / 3, 
                            height: (SCREEN_WIDTH - 100) / 3, 
                            borderRadius: 12,
                            backgroundColor: theme.cardAlt
                          }} 
                        />
                        <TouchableOpacity 
                          onPress={() => setImages(images.filter((_, i) => i !== index))}
                          style={{
                            position: 'absolute',
                            top: -6,
                            right: -6,
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: COLORS.danger,
                            justifyContent: 'center',
                            alignItems: 'center',
                            shadowColor: '#000',
                            shadowOpacity: 0.2,
                            shadowRadius: 4,
                            elevation: 3,
                          }}
                        >
                          <Ionicons name="close" size={14} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    {/* Add More Button */}
                    <TouchableOpacity 
                      onPress={pickImage}
                      style={{
                        width: (SCREEN_WIDTH - 100) / 3,
                        height: (SCREEN_WIDTH - 100) / 3,
                        borderRadius: 12,
                        backgroundColor: theme.cardAlt,
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderWidth: 2,
                        borderColor: theme.border,
                        borderStyle: 'dashed',
                      }}
                    >
                      <Ionicons name="add" size={28} color={theme.textSecondary} />
                      <Text style={{ fontSize: 10, color: theme.textSecondary, marginTop: 4 }}>Add More</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Upload Zone (only show when no images) */}
              {images.length === 0 && (
                <TouchableOpacity 
                  onPress={pickImage} 
                  style={[styles.uploadZone, { borderColor: theme.border, backgroundColor: theme.cardAlt }]}
                >
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: `${COLORS.primary}12`, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                    <Ionicons name="images" size={28} color={COLORS.primary} />
                  </View>
                  <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }}>Add Images</Text>
                  <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 4 }}>Tap to select from your gallery</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handlePress}
            disabled={loading}
            style={{
              backgroundColor: loading ? theme.cardAlt : COLORS.primary,
              paddingVertical: 16,
              borderRadius: 14,
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              shadowColor: COLORS.primary,
              shadowOpacity: loading ? 0 : 0.3,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              elevation: loading ? 0 : 4,
            }}
          >
            {loading ? (
              <ActivityIndicator color={theme.textSecondary} style={{ marginRight: 10 }} />
            ) : (
              <Ionicons name="checkmark-circle" size={22} color="#fff" style={{ marginRight: 10 }} />
            )}
            <Text style={{ fontSize: 16, fontWeight: '700', color: loading ? theme.textSecondary : '#fff' }}>
              {loading ? "Creating Task..." : "Create Task"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </Layout>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  uploadZone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  successCard: {
    padding: 30,
    borderRadius: 24,
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  }
});

export default TaskAdd;
