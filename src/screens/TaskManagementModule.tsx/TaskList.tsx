import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  View,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Text,
  Alert,
  Modal,
  StyleSheet,
  Dimensions,
  Platform,
  Image,
  FlatList,
  SectionList,
} from "react-native";
import DropDownPicker from "react-native-dropdown-picker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import {
  Layout,
  TopNav,
  useTheme,
  themeColor,
  TextInput,
  Button,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  collection,
  deleteDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  deleteObject,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { 
  CONFIG, COLORS, 
  toDate, formatDateKey, formatDisplayDate, formatDetailedDate, 
  calculateFinalScore, 
  TaskService, AIService, 
  useTaskGrouping, useTaskData,
  useProjectData, useTeamData
} from "./TaskHooks";
import { PriorityScore, Task, DEFAULT_PROJECT_ID, DEFAULT_TEAM_ID } from "./data";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ============================================================================
// 🧱 COMPONENTS
// ============================================================================

const AIScoreBadge = ({ score, priority, compact = false, theme, onPress }: any) => {
  const percentage = Math.min(Math.max(score * 100, 0), 100);
  
  let label = percentage >= 70 ? "Urgent" : percentage >= 45 ? "Important" : "Normal";
  let color = percentage >= 70 ? COLORS.danger : percentage >= 45 ? COLORS.warning : COLORS.success;

  // Override logic moved to calculateFinalScore to ensure % matches color.
  // We keep the color logic consistent with the score.

  if (compact) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: `${color}15`, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 6 }} />
          <Text style={{ fontSize: 11, fontWeight: "700", color }}>{Math.round(percentage)}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <View style={{ alignItems: "flex-end", minWidth: 70 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
          <Ionicons name="analytics" size={12} color={color} />
          <Text style={{ fontSize: 11, fontWeight: "700", color, marginLeft: 4 }}>{Math.round(percentage)}%</Text>
        </View>
        <View style={{ width: 60, height: 4, backgroundColor: theme.border, borderRadius: 2, overflow: "hidden" }}>
          <View style={{ width: `${percentage}%`, height: "100%", backgroundColor: color, borderRadius: 2 }} />
        </View>
        <Text style={{ fontSize: 9, color: theme.textSecondary, marginTop: 2 }}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
};

const ReasonBadge = ({ task, isDarkmode }: any) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const theme = { text: isDarkmode ? "#f8fafc" : "#0f172a", textSecondary: isDarkmode ? "#94a3b8" : "#64748b", card: isDarkmode ? "#1e293b" : "#ffffff" };
  
  // Generate reason based on task properties
  const reason = useMemo(() => {
    const reasons = [];
    const dueDate = toDate(task.dueDate);
    
    if (dueDate) {
      const diffDays = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) reasons.push(`Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? 's' : ''}`);
      else if (diffDays === 0) reasons.push("Due today");
      else if (diffDays <= 2) reasons.push(`Deadline in ${diffDays} day${diffDays > 1 ? 's' : ''}`);
    }
    
    const depCount = (Array.isArray(task.dependencies) ? task.dependencies.length : 0) || 
                     (Array.isArray(task.taskDependencies) ? task.taskDependencies.length : 0);
    if (depCount > 0) reasons.push(`Unblocks ${depCount} task${depCount > 1 ? 's' : ''}`);
    
    if (task.effort === "Low") reasons.push("Quick win (low effort)");
    if (task.priority === "High") reasons.push("High priority");
    
    return reasons.length > 0 ? reasons.join(" • ") : "AI recommended";
  }, [task]);

  return (
    <TouchableOpacity 
      onPress={() => setShowTooltip(!showTooltip)}
      style={{ position: "relative", marginLeft: 6 }}
    >
      <Ionicons name="help-circle" size={16} color={COLORS.primary} />
      {showTooltip && (
        <View style={{
          position: "absolute",
          top: 24,
          right: 0,
          backgroundColor: theme.card,
          padding: 12,
          borderRadius: 8,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 4,
          elevation: 5,
          minWidth: 200,
          maxWidth: 280,
          zIndex: 1000,
          borderWidth: 1,
          borderColor: isDarkmode ? "#334155" : "#e2e8f0",
        }}>
          <Text style={{ fontSize: 12, color: theme.text, lineHeight: 18 }}>{reason}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const LoadBalancingBanner = ({ listLoadMap, taskArray, onMoveToLater, isDarkmode }: any) => {
  const theme = { text: isDarkmode ? "#f8fafc" : "#0f172a", textSecondary: isDarkmode ? "#94a3b8" : "#64748b", card: isDarkmode ? "#1e293b" : "#ffffff" };
  
  // Find the most overloaded list (> 7 tasks)
  const overloadedList = useMemo(() => {
    const lists = Object.entries(listLoadMap)
      .filter(([name, count]: [string, any]) => count > 7)
      .sort((a: any, b: any) => b[1] - a[1]);
    
    return lists.length > 0 ? { name: lists[0][0], count: lists[0][1] } : null;
  }, [listLoadMap]);

  if (!overloadedList) return null;

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 16, padding: 14, backgroundColor: `${COLORS.warning}08`, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: COLORS.warning }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
        <Ionicons name="clipboard" size={18} color={COLORS.warning} />
        <Text style={{ fontSize: 14, fontWeight: "700", color: theme.text, marginLeft: 8, flex: 1 }}>
          {`"${String(overloadedList.name)}" is overloaded (${overloadedList.count} tasks)`}
        </Text>
      </View>
      <Text style={{ fontSize: 12, color: theme.textSecondary }}>
        Consider moving 2 low-priority items to Later to balance your workload.
      </Text>
    </View>
  );
};

const TaskItem = ({ item, onToggle, onDelete, onEdit, compact = false, onScorePress, readonly = false }: any) => {
  const { isDarkmode } = useTheme();
  const theme = {
    text: isDarkmode ? "#f8fafc" : "#0f172a",
    textSecondary: isDarkmode ? "#94a3b8" : "#64748b",
    border: isDarkmode ? "#334155" : "#e2e8f0",
    card: isDarkmode ? "#1e293b" : "#ffffff",
  };

  const t = item;
  const priorityColor = t.priority === "High" ? COLORS.danger : t.priority === "Medium" ? COLORS.warning : COLORS.success;
  const displayDate = toDate(t.dueDate);
  
  return (
    <View
      style={[styles.cardContainer, { backgroundColor: theme.card, marginBottom: compact ? 6 : 10 }]}
    >
      {!t.isCompleted && (
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: compact ? 3 : 4, backgroundColor: priorityColor, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 }} />
      )}
      <View style={[styles.cardInner, { padding: compact ? 10 : 16, paddingLeft: compact ? 16 : 20 }]}>
        <TouchableOpacity 
          style={{ flex: 1, flexDirection: "row", alignItems: "flex-start" }} 
          onPress={() => !readonly && onEdit(t)}
          activeOpacity={readonly ? 1 : 0.7}
        >
          {!readonly && (
            <TouchableOpacity onPress={() => !readonly && onToggle(t)} activeOpacity={readonly ? 1 : 0.7} style={{ marginRight: compact ? 10 : 14, paddingTop: 2 }}>
              <View style={{ width: compact ? 24 : 28, height: compact ? 24 : 28, borderRadius: 8, borderWidth: 2.5, borderColor: t.isCompleted ? COLORS.success : isDarkmode ? "#475569" : "#cbd5e1", backgroundColor: t.isCompleted ? COLORS.success : "transparent", justifyContent: "center", alignItems: "center" }}>
                {t.isCompleted && <Ionicons name="checkmark" size={compact ? 16 : 18} color="#fff" />}
              </View>
            </TouchableOpacity>
          )}

          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: compact ? 2 : 4 }}>
              <Text style={{ fontWeight: "600", fontSize: compact ? 14 : 15, color: theme.text, textDecorationLine: t.isCompleted ? "line-through" : "none", opacity: t.isCompleted ? 0.5 : 1, flex: 1 }} numberOfLines={compact ? 1 : 2}>
                {t.taskName ?? t.title}
              </Text>
            </View>
            
            {/* Compact mode: show priority + notes keywords */}
            {compact ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                {t.priority && (
                  <View style={{ backgroundColor: `${priorityColor}15`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: priorityColor }}>{t.priority}</Text>
                  </View>
                )}
                {/* AI Reason Badge for Compact Mode */}
                {(t.reason || t._rank) && <ReasonBadge task={t} isDarkmode={isDarkmode} />}
                {t.notes && (
                  <Text style={{ fontSize: 10, color: theme.textSecondary, flex: 1 }} numberOfLines={1}>
                    {t.notes}
                  </Text>
                )}
              </View>
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {!!t.listName && (
                    <View style={{ backgroundColor: `${COLORS.primary}12`, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: COLORS.primary }}>{t.listName}</Text>
                    </View>
                  )}
                  {t.priority && (
                    <View style={{ backgroundColor: `${priorityColor}15`, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: priorityColor }}>{t.priority}</Text>
                    </View>
                  )}
                  {/* AI Reason Badge for Normal Mode */}
                  {(t.reason || t._rank) && <ReasonBadge task={t} isDarkmode={isDarkmode} />}

                  {/* Enhanced Dependency Badge with Status Indicators */}
                  {(()=> {
                    const meta = t._dependencyMeta;
                    let depCount = 0;
                    if (Array.isArray(t.dependencies)) {
                      depCount = t.dependencies.length;
                    } else if (t.dependencies?.blockedBy && Array.isArray(t.dependencies.blockedBy)) {
                      depCount = t.dependencies.blockedBy.length;
                    } else if (Array.isArray(t.taskDependencies)) {
                      depCount = t.taskDependencies.length;
                    }
                    
                    if (!meta && depCount === 0) return null;
                    
                    // Determine badge color and icon based on dependency status
                    let badgeColor = COLORS.purple; // default
                    let badgeIcon = "git-network";
                    let tooltipText = `${depCount} dependencies`;
                    
                    if (meta) {
                      if (meta.isBlocked) {
                        badgeColor = COLORS.warning; // Orange for blocked
                        badgeIcon = "lock-closed";
                        tooltipText = `⚠️ Blocked by: ${meta.blockingTasks.join(", ")}`;
                      } else if (meta.isCritical) {
                        badgeColor = COLORS.danger; // Red for critical path
                        badgeIcon = "alert-circle";
                        tooltipText = `🔥 Critical! Unblocks ${meta.cascadeImpact} task(s)`;
                      } else if (meta.cascadeImpact > 0) {
                        badgeColor = COLORS.primary; // Blue for blocker
                        badgeIcon = "unlock";
                        tooltipText = `🔑 Unblocks ${meta.cascadeImpact} task(s)`;
                      }
                    }
                    
                    return (
                      <TouchableOpacity 
                        onPress={(e) => {
                          e.stopPropagation();
                          if (meta) {
                            Alert.alert("Dependency Info", tooltipText);
                          }
                        }}
                        style={{ backgroundColor: `${badgeColor}12`, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, flexDirection: 'row', alignItems: 'center' }}
                      >
                        <Ionicons name={badgeIcon as any} size={12} color={badgeColor} />
                        {depCount > 0 && (
                          <Text style={{ fontSize: 11, fontWeight: "700", color: badgeColor, marginLeft: 2 }}>{depCount}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })()}
                  {displayDate && !t.isCompleted && (
                  <View style={{ backgroundColor: isDarkmode ? "#334155" : "#f1f5f9", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="calendar-outline" size={12} color={theme.textSecondary} />
                    <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary, marginLeft: 4 }}>
                      {formatDisplayDate(displayDate)}
                    </Text>
                  </View>
                )}
                </View>
                {t.notes && (
                  <Text style={{ fontSize: 11, color: theme.textSecondary, marginTop: 6, lineHeight: 16 }} numberOfLines={2}>
                    {t.notes}
                  </Text>
                )}
                {/* Large Attachments below notes */}
                {t.attachments?.length > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    {t.attachments.slice(0, 3).map((url: string, index: number) => (
                      <Image 
                        key={index}
                        source={{ uri: url }}
                        style={{ width: 60, height: 60, borderRadius: 8, backgroundColor: '#eee' }}
                      />
                    ))}
                    {t.attachments.length > 3 && (
                      <View style={{ width: 60, height: 60, borderRadius: 8, backgroundColor: `${COLORS.warning}20`, justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 14, fontWeight: "700", color: COLORS.warning }}>+{t.attachments.length - 3}</Text>
                      </View>
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        </TouchableOpacity>

        <View style={{ marginLeft: 12, alignItems: "flex-end", justifyContent: "space-between" }}>
          {!t.isCompleted && (t.priorityScore?.finalPriority > 0 || t._score > 0) ? <AIScoreBadge score={t.priorityScore?.finalPriority ?? t._score} priority={t.priority} compact={compact} theme={theme} onPress={() => onScorePress?.(t)} /> : t.isCompleted ? <Ionicons name="checkmark-circle" size={18} color={COLORS.success} /> : null}
          {!compact && !readonly && (
            <View style={{ flexDirection: "row", gap: 6, marginTop: 8, zIndex: 50 }}>
              <TouchableOpacity
                onPress={() => {
                  if (onDelete) onDelete(t);
                }}
                style={{ 
                  padding: 10, 
                  borderRadius: 6, 
                  backgroundColor: isDarkmode ? "#334155" : "#f8fafc", 
                  zIndex: 999
                }}
              >
                <Ionicons name="trash-outline" size={18} color={isDarkmode ? "#94a3b8" : "#64748b"} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const TaskEditModal = ({ visible, onClose, editingTask, onSave, taskArray = [] }: any) => {
  const { isDarkmode } = useTheme();
  const [form, setForm] = useState<any>({
    listName: "",
    taskName: "",
    notes: "",
    priority: null,
    dueDate: null,
    attachments: [],
    newLocalImages: [],
    dependencies: [],
  });
  const dateInputRef = useRef<any>(null);
  
  // Extract existing list names
  const existingLists = useMemo(() => {
    const lists = new Set<string>();
    taskArray.forEach((t: any) => {
      if (t.listName) lists.add(t.listName);
    });
    return Array.from(lists).sort();
  }, [taskArray]);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (editingTask) {
      setForm({
        listName: editingTask.listName ?? "",
        taskName: editingTask.taskName ?? editingTask.title ?? "",
        notes: editingTask.notes ?? "",
        priority: editingTask.priority ?? null,
        dueDate: toDate(editingTask.dueDate),
        attachments: editingTask.attachments ?? [],
        newLocalImages: [],
        dependencies: (() => {
          const deps = editingTask.dependencies;
          if (Array.isArray(deps)) return deps;
          if (deps?.blockedBy && Array.isArray(deps.blockedBy)) return deps.blockedBy;
          return editingTask.taskDependencies ?? [];
        })(), // Initialize dependencies as string array of IDs
      });
      // Set IDs from task or default
      if (editingTask.projectId) setSelectedProjectId(editingTask.projectId);
      else setSelectedProjectId(DEFAULT_PROJECT_ID);
      
      if (editingTask.teamId) setSelectedTeamId(editingTask.teamId);
      else setSelectedTeamId(DEFAULT_TEAM_ID);
    }
  }, [editingTask]);

  // Project & Team Selection
  const [selectedProjectId, setSelectedProjectId] = useState(DEFAULT_PROJECT_ID);
  const [selectedTeamId, setSelectedTeamId] = useState(DEFAULT_TEAM_ID);
  
  const { projects } = useProjectData();
  const { teams } = useTeamData(selectedProjectId);
  const [projectOpen, setProjectOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);

  const handleSave = () => {
    if (!form.taskName?.trim()) return alert("Task Name is required");
    onSave(editingTask?.key, { ...form, projectId: selectedProjectId, teamId: selectedTeamId });
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
      });
      if (!result.canceled) {
        const newImgs = result.assets.map((a) => ({ uri: a.uri }));
        setForm((f: any) => ({ ...f, newLocalImages: [...(f.newLocalImages || []), ...newImgs] }));
      }
    } catch (e) {
      Alert.alert("Error", "Could not pick image");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: isDarkmode ? "#0b1220" : "#ffffff" }]}>
          <View style={styles.modalHeader}>
            <Text style={{ fontSize: 18, fontWeight: "bold", color: isDarkmode ? "#fff" : "#000" }}>Edit Task</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 6, borderRadius: 8, backgroundColor: isDarkmode ? "#1e293b" : "#f1f5f9" }}>
              <Ionicons name="close" size={22} color={isDarkmode ? "#fff" : "#374151"} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
            {/* Project/Team Selection */}
             <View style={{ zIndex: 3000, marginBottom: 15 }}>
               <Text style={styles.label}>Project</Text>
               <DropDownPicker
                  theme={isDarkmode ? "DARK" : "LIGHT"}
                  open={projectOpen}
                  value={selectedProjectId}
                  items={projects.map(p => ({ label: p.name, value: p.id }))}
                  setOpen={setProjectOpen}
                  setValue={setSelectedProjectId}
                  setItems={() => {}}
                  style={{ borderColor: isDarkmode ? '#334155' : '#e2e8f0', backgroundColor: isDarkmode ? '#1e293b' : '#ffffff', minHeight: 40 }}
                  zIndex={3000}
                  zIndexInverse={1000}
                  listMode="SCROLLVIEW"
               />
               
               <Text style={styles.label}>Team</Text>
               <DropDownPicker
                  theme={isDarkmode ? "DARK" : "LIGHT"}
                  open={teamOpen}
                  value={selectedTeamId}
                  items={teams.map(t => ({ label: t.name, value: t.id }))}
                  setOpen={setTeamOpen}
                  setValue={setSelectedTeamId}
                  setItems={() => {}}
                  style={{ borderColor: isDarkmode ? '#334155' : '#e2e8f0', backgroundColor: isDarkmode ? '#1e293b' : '#ffffff', minHeight: 40 }}
                  zIndex={2000}
                  zIndexInverse={2000}
                  listMode="SCROLLVIEW"
               />
            </View>

            <Text style={styles.label}>List Name</Text>
            {existingLists.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {existingLists.map((listName: string) => (
                  <TouchableOpacity
                    key={listName}
                    onPress={() => setForm((f: any) => ({ ...f, listName }))}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      backgroundColor: form.listName === listName ? COLORS.primary : (isDarkmode ? '#1e293b' : '#f1f5f9'),
                      borderWidth: 1,
                      borderColor: form.listName === listName ? COLORS.primary : (isDarkmode ? '#334155' : '#e2e8f0')
                    }}
                  >
                    <Text style={{ 
                      fontSize: 12,
                      fontWeight: '600',
                      color: form.listName === listName ? '#fff' : (isDarkmode ? '#f8fafc' : '#0f172a') 
                    }}>
                      {listName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput 
              placeholder={existingLists.length > 0 ? "Or type new list name" : "e.g., Work, Personal"} 
              value={form.listName} 
              onChangeText={(v) => setForm((f: any) => ({ ...f, listName: v }))} 
            />
            <Text style={styles.label}>Task Name</Text>
            <TextInput placeholder="Task Name*" value={form.taskName} onChangeText={(v) => setForm((f: any) => ({ ...f, taskName: v }))} />
            <Text style={styles.label}>Priority</Text>
            <View style={styles.priorityRow}>
              {["High", "Medium", "Low"].map((p) => (
                <TouchableOpacity key={p} onPress={() => setForm((f: any) => ({ ...f, priority: p }))} style={[styles.priorityChip, form.priority === p ? styles.priorityChipActive : null]}>
                  <Text style={{ fontWeight: "600" }}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Due Date</Text>
            {Platform.OS === "web" ? (
              <View style={{ position: 'relative', width: '100%', marginBottom: 10 }}>
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={() => {
                     // Programmatically trigger picker
                     if (dateInputRef.current && typeof dateInputRef.current.showPicker === 'function') {
                        dateInputRef.current.showPicker();
                     } else {
                        // Fallback: focus and click (less reliable)
                        dateInputRef.current?.focus();
                        dateInputRef.current?.click(); 
                     }
                  }}
                >
                  <View style={{
                    padding: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: isDarkmode ? '#334155' : '#e2e8f0', // Using standard border colors
                    backgroundColor: isDarkmode ? '#1e293b' : '#ffffff',
                    justifyContent: 'space-between',
                    flexDirection: 'row',
                    alignItems: 'center'
                  }}>
                    <Text style={{ fontSize: 16, color: isDarkmode ? '#fff' : '#000' }}>
                      {form.dueDate ? formatDetailedDate(new Date(form.dueDate)) : "Select Due Date & Time"}
                    </Text>
                    <Ionicons name="calendar-outline" size={22} color={isDarkmode ? '#94a3b8' : '#64748b'} />
                  </View>
                </TouchableOpacity>
                <input 
                  ref={dateInputRef}
                  type="datetime-local" 
                  value={form.dueDate ? new Date(new Date(form.dueDate).getTime() - new Date(form.dueDate).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} 
                  onChange={(e) => setForm((f: any) => ({ ...f, dueDate: new Date(e.target.value) }))} 
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, zIndex: -1 } as any} 
                />
              </View>
            ) : (
              <>
                <Button text={form.dueDate ? formatDetailedDate(new Date(form.dueDate)) : "Select Due Date & Time"} onPress={() => setShowPicker(true)} style={{ marginBottom: 10 }} />
                {showPicker && <DateTimePicker value={form.dueDate || new Date()} mode="datetime" display="default" onChange={(_, d) => { setShowPicker(false); if (d) setForm((f: any) => ({ ...f, dueDate: d })); }} />}
              </>
            )}
            <Text style={styles.label}>Notes</Text>
            <TextInput placeholder="Notes" value={form.notes} onChangeText={(v) => setForm((f: any) => ({ ...f, notes: v }))} />
            
            {/* Dependency Selector */}
            <Text style={styles.label}>Dependencies (Tasks that must be completed first)</Text>
            <View style={{ marginBottom: 20 }}>
              {taskArray
                .filter((t: any) => !t.isCompleted && t.key !== editingTask?.key) // Exclude completed tasks and self
                .map((t: any) => {
                  const isSelected = (form.dependencies || []).includes(t.key);
                  return (
                    <TouchableOpacity
                      key={t.key}
                      onPress={() => {
                        const deps = form.dependencies ||[];
                        if (isSelected) {
                          setForm((f: any) => ({ ...f, dependencies: deps.filter((d: string) => d !== t.key) }));
                        } else {
                          setForm((f: any) => ({ ...f, dependencies: [...deps, t.key] }));
                        }
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        marginBottom: 8,
                        borderRadius: 8,
                        backgroundColor: isSelected ? `${COLORS.primary}15` : (isDarkmode ? '#1e293b' : '#f8fafc'),
                        borderWidth: isSelected ? 2 : 1,
                        borderColor: isSelected ? COLORS.primary : (isDarkmode ? '#334155' : '#e2e8f0'),
                      }}
                    >
                      <View style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        borderWidth: 2,
                        borderColor: isSelected ? COLORS.primary : (isDarkmode ? '#64748b' : '#cbd5e1'),
                        backgroundColor: isSelected ? COLORS.primary : 'transparent',
                        marginRight: 12,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}>
                        {isSelected && <Ionicons name="checkmark" size={14} color="white" />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: isDarkmode ? '#f8fafc' : '#0f172a' }}>
                          {t.taskName}
                        </Text>
                        {t.listName && (
                          <Text style={{ fontSize: 12, color: isDarkmode ? '#94a3b8' : '#64748b', marginTop: 2 }}>
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
              {taskArray.filter((t: any) => !t.isCompleted && t.key !== editingTask?.key).length === 0 && (
                <Text style={{ fontSize: 13, color: isDarkmode ? '#94a3b8' : '#64748b', fontStyle: 'italic', textAlign: 'center', paddingVertical: 20 }}>
                  No pending tasks available to set as dependencies
                </Text>
              )}
            </View>
            
            <Text style={styles.label}>Attachments</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
              {form.attachments?.map((url: string, index: number) => (
                <View key={`existing-${index}`} style={{ width: 70, height: 70 }}>
                  <Image source={{ uri: url }} style={{ width: '100%', height: '100%', borderRadius: 8, backgroundColor: '#eee' }} />
                  <TouchableOpacity
                    onPress={() => setForm((f: any) => ({ ...f, attachments: f.attachments.filter((_: any, i: number) => i !== index) }))}
                    style={{ position: 'absolute', top: -6, right: -6, backgroundColor: COLORS.danger, borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#fff' }}
                  >
                    <Ionicons name="close" size={14} color="white" />
                  </TouchableOpacity>
                </View>
              ))}
              {form.newLocalImages?.map((img: any, index: number) => (
                <View key={`new-${index}`} style={{ width: 70, height: 70 }}>
                  <Image source={{ uri: img.uri }} style={{ width: '100%', height: '100%', borderRadius: 8, backgroundColor: '#eee' }} />
                  <TouchableOpacity
                    onPress={() => setForm((f: any) => ({ ...f, newLocalImages: f.newLocalImages.filter((_: any, i: number) => i !== index) }))}
                    style={{ position: 'absolute', top: -6, right: -6, backgroundColor: COLORS.danger, borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#fff' }}
                  >
                    <Ionicons name="close" size={14} color="white" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity onPress={pickImage} style={{ width: 70, height: 70, borderRadius: 8, borderWidth: 2, borderColor: isDarkmode ? '#334155' : '#e2e8f0', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', backgroundColor: isDarkmode ? '#1e293b' : '#f8fafc' }}>
                <Ionicons name="add" size={28} color={isDarkmode ? '#94a3b8' : '#64748b'} />
              </TouchableOpacity>
            </View>

            <View style={{ height: 12 }} />
            <Button text="Save Changes" onPress={handleSave} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const ScoreExplanationModal = ({ visible, onClose, task, listLoadMap }: any) => {
  const { isDarkmode } = useTheme();
  const theme = { text: isDarkmode ? "#f8fafc" : "#0f172a", textSecondary: isDarkmode ? "#94a3b8" : "#64748b", card: isDarkmode ? "#1e293b" : "#ffffff", border: isDarkmode ? "#334155" : "#e2e8f0" };

  if (!task) return null;

  // Recalculate score components (Needed for descriptions and fallback)
  const dueDate = toDate(task.dueDate);
  const listCount = listLoadMap[task.listName ?? "default"] ?? 0;
  
  let depCount = 0;
  if (Array.isArray(task.dependencies)) {
    depCount = task.dependencies.length;
  } else if (task.dependencies?.blockedBy && Array.isArray(task.dependencies.blockedBy)) {
    depCount = task.dependencies.blockedBy.length;
  } else if (Array.isArray(task.taskDependencies)) {
    depCount = task.taskDependencies.length;
  }

  // Use the pre-calculated PriorityScore object if available
  const ps = task.priorityScore;
  
  // Use exact breakdown if available to ensure sum matches total
  let urgencyContrib, userContrib, depContrib, effortContrib, focusContrib;
  
  if (ps && ps.breakdown) {
     urgencyContrib = ps.breakdown.urgency;
     userContrib = ps.breakdown.userPriority;
     depContrib = ps.breakdown.dependencies;
     effortContrib = ps.breakdown.effort;
     focusContrib = ps.breakdown.focus;
  } else {
     // Fallback defaults
     urgencyContrib = 0;
     userContrib = 0;
     depContrib = 0;
     effortContrib = 0;
     focusContrib = 0;
  }

  const components = [
    { name: "Urgency (Time)", weight: 0.50, contribution: urgencyContrib, color: COLORS.danger, desc: dueDate ? "Score based on proximity to due date" : "No due date set" },
    { name: "Importance (Priority)", weight: 0.30, contribution: userContrib, color: COLORS.purple, desc: `Task marked as "${task.priority}"` },
    { name: "Dependencies", weight: 0.10, contribution: depContrib, color: COLORS.primary, desc: "Bonus for blocking other tasks" },
    { name: "Effort Strategy", weight: 0.05, contribution: effortContrib, color: COLORS.warning, desc: task.effort === "Low" ? "Quick win bonus" : "Strategy score" },
    { name: "Focus Context", weight: 0.05, contribution: focusContrib, color: COLORS.success, desc: "Recency of activity" },
  ];

  const totalScore = ps ? ps.finalPriority : (task._score || calculateFinalScore(task, listLoadMap));
  const percentage = Math.min(Math.max(totalScore * 100, 0), 100);


  
  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={styles.modalBackdrop}>
        <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={[styles.modalCard, { backgroundColor: theme.card, maxHeight: "70%" }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <Text style={{ fontSize: 18, fontWeight: "bold", color: theme.text }}>Priority Score: {Math.round(percentage)}%</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close-circle" size={28} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {components.map((comp) => {
              // Use the exact calculated contribution
              const contribution = comp.contribution;
              // Calculate relative bar fill based on weight (how much of the potential points did we get?)
              // Max potential points = weight. So fill = contribution / weight
              const fillPercentage = Math.min(contribution / comp.weight, 1.0);
              
              return (
                <View key={comp.name} style={{ marginBottom: 20 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight:"600", color: theme.text }}>{comp.name}</Text>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: comp.color }}>{contribution > 0 ? "+" : ""}{Math.round(contribution * 100)}%</Text>
                  </View>
                  <View style={{ height: 8, backgroundColor: `${comp.color}10`, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                    <View style={{ width: `${fillPercentage * 100}%`, height: "100%", backgroundColor: comp.color, borderRadius: 4 }} />
                  </View>
                  <Text style={{ fontSize: 11, color: theme.textSecondary }}>{comp.desc}</Text>
                </View>
              );
            })}


          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// ============================================================================
// 📱 MAIN SCREEN
// ============================================================================
interface TaskListProps extends NativeStackScreenProps<MainStackParamList, "TaskList"> {
  viewMode?: "list" | "calendar";
  loading?: boolean;
  taskArray?: any[];
  setTaskArray?: (tasks: any[]) => void;
  aiBriefing?: string;
  aiBriefingLoading?: boolean;
  aiSuggestions?: any;
  aiAccepted?: boolean;
  setAiAccepted?: (val: boolean) => void;
  setAiSuggestions?: (val: any) => void;
  analyzeTasksWithAI?: (tasks?: any[]) => void;
  focusTasks?: any[];
  setFocusTasks?: (tasks: any[]) => void;
}

export default function TaskList(props: TaskListProps) {
  const { 
    navigation, 
    viewMode: externalViewMode,
    loading = false,
    taskArray = [],
    setTaskArray = () => {},
    aiBriefing = "",
    aiBriefingLoading = false,
    aiSuggestions = null,
    aiAccepted = false,
    setAiAccepted = () => {},
    setAiSuggestions = () => {},
    analyzeTasksWithAI = () => {},
    focusTasks = [],
    setFocusTasks = () => {}
  } = props;

  const { isDarkmode, setTheme } = useTheme();
  const theme = { bg: isDarkmode ? "#0f172a" : "#f8fafc", text: isDarkmode ? "#f8fafc" : "#0f172a", textSecondary: isDarkmode ? "#94a3b8" : "#64748b" };

  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [aiSortOn, setAiSortOn] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [editVisible, setEditVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  // focusTasks state removed (lifted to parent)
  const [compactMode, setCompactMode] = useState(false);
  const [timeFilter, setTimeFilter] = useState<string | null>(null); // "15m", "30-60m", "deep"
  const [scoreExplainTask, setScoreExplainTask] = useState<any>(null);

// 🗓️ TIMELINE VIEW STATE
  const [viewMode, setViewMode] = useState<"list" | "calendar">(externalViewMode || "list");
  
  // Update view mode if prop changes
  useEffect(() => {
    if (externalViewMode) {
      setViewMode(externalViewMode);
    }
  }, [externalViewMode]);
  const [timelineDate, setTimelineDate] = useState<Date>(new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date()); // Track displayed month

  // Hooks state is now passed via props
  const { sections, listLoadMap } = useTaskGrouping(taskArray, selectedList, selectedDate, aiSortOn);


  // Helper to generate the Month Grid (7 columns, Sun-Sat)
  const monthGrid = useMemo(() => {
    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    
    // Start from Sunday of the first week
    const startDate = new Date(startOfMonth);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    // Generate 42 days (6 weeks) to cover any month configuration
    const days = [];
    for (let i = 0; i < 42; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        days.push({
            date: d,
            isCurrentMonth: d.getMonth() === currentMonth.getMonth()
        });
    }
    return days;
  }, [currentMonth]);

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  };

  const tasksForTimeline = useMemo(() => {
      return taskArray.filter(t => {
          const d = toDate(t.dueDate);
          return d && isSameDay(d, timelineDate);
      }).sort((a, b) => (b.priorityScore?.finalPriority ?? 0) - (a.priorityScore?.finalPriority ?? 0));
  }, [taskArray, timelineDate]);

  useEffect(() => {
    (async () => {
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission required", "Sorry, we need camera roll permissions to make this work!");
        }
      }
    })();
  }, []);

  const stats = useMemo(() => ({
    pending: taskArray.filter((t) => !t.isCompleted).length,
    high: taskArray.filter((t) => !t.isCompleted && t.priority === "High").length,
    completed: taskArray.filter((t) => t.isCompleted).length,
  }), [taskArray]);

  // Next 3 Focus Queue - auto-updates as tasks complete
  const next3Tasks = useMemo(() => {
    const pending = taskArray
      .filter(t => !t.isCompleted)
      .map(t => {
        // Ensure score is calculated and populated
        const score = calculateFinalScore(t, listLoadMap); 
        return { ...t, _score: score }; // Keep _score for sort compatibility
      })
      .sort((a, b) => (b.priorityScore?.finalPriority ?? b._score) - (a.priorityScore?.finalPriority ?? a._score));
    return pending.slice(0, 3);
  }, [taskArray, listLoadMap]);

  const handleToggleComplete = async (item: any) => {
    const newData = [...taskArray];
    const idx = newData.findIndex((i) => i.key === item.key);
    if (idx !== -1) {
      newData[idx].isCompleted = !newData[idx].isCompleted;
      setTaskArray(newData);
    }
    await TaskService.toggleComplete(item);
  };

  const handleDelete = (item: any) => {
    const performDelete = async () => {
      try {
        await TaskService.deleteTask(item.key, item.attachments);
        
        // Remove from local state immediately for responsiveness
        const newData = taskArray.filter((i) => i.key !== item.key);
        setTaskArray(newData);
        
        console.log("Document successfully deleted via Service!");
      } catch (error: any) {
        Alert.alert("Error", error.message);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to delete "${item.taskName || 'this task'}"?`)) {
        performDelete();
      }
    } else {
      Alert.alert("Delete Task", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: performDelete },
      ]);
    }
  };

  const handleMoveToLater = async (listName: string) => {
    try {
      // Find 2 lowest-priority pending tasks in the list
      const tasksInList = taskArray
        .filter((t) => t.listName === listName && !t.isCompleted)
        .map((t) => ({ ...t, _score: calculateFinalScore(t, listLoadMap, taskArray) })) // Pass taskArray
        .sort((a, b) => a._score - b._score)
        .slice(0, 2);

      if (tasksInList.length === 0) {
        Alert.alert("No Tasks", "No pending tasks found in this list.");
        return;
      }

      // Move them to 14 days from now (2 weeks)
      const newDueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      
      await Promise.all(
        tasksInList.map((t) =>
          TaskService.updateTask(t.key, { dueDate: newDueDate }, t.projectId, t.teamId)
        )
      );

      // Update local state
      const newData = taskArray.map((t) => {
        if (tasksInList.find((task) => task.key === t.key)) {
          return { ...t, dueDate: newDueDate };
        }
        return t;
      });
      setTaskArray(newData);

      Alert.alert(
        "✓ Tasks Moved",
        `Moved ${tasksInList.length} task${tasksInList.length > 1 ? "s" : ""} to Later`
      );
    } catch (error) {
      Alert.alert("Error", "Failed to move tasks");
    }
  };

  // Lifted State for Persistence, now using default Project/Team path
  const { loading: dataLoading, taskArray: localTaskArray, setTaskArray: setLocalTaskArray } = useTaskData(DEFAULT_PROJECT_ID, DEFAULT_TEAM_ID);
  
  // Use props if provided (e.g. from parent wrapper), otherwise local
  const currentTaskArray = taskArray.length > 0 ? taskArray : localTaskArray;
  const currentSetTaskArray = taskArray.length > 0 ? setTaskArray : setLocalTaskArray;
  const isLoading = loading || dataLoading;

  const handleSaveEdit = async (taskId: string, formData: any) => {
    try {
      // Detect removed attachments
      const original = editingTask?.attachments ?? [];
      const current = formData.attachments ?? [];
      const removed = original.filter((url: string) => !current.includes(url));
      
      if (removed.length > 0) {
        await TaskService.deleteAttachments(removed);
      }

      const newUrls = await TaskService.uploadImages(formData.newLocalImages);
      const payload = {
        listName: formData.listName.trim(),
        taskName: formData.taskName.trim(),
        notes: formData.notes ?? "",
        priority: formData.priority,
        dueDate: formData.dueDate,
        attachments: [...formData.attachments, ...newUrls],
        // Save back as object structure
        dependencies: {
          block: [],
          blockedBy: formData.dependencies
        },
        dependenciesList: formData.dependencies // Legacy support
      };

      // Recalculate score
      const tempTask = { ...editingTask, ...payload };
      calculateFinalScore(tempTask, listLoadMap, taskArray);
      (payload as any).priorityScore = tempTask.priorityScore;

      // Check if moved
      const oldProj = editingTask.projectId || DEFAULT_PROJECT_ID;
      const oldTeam = editingTask.teamId || DEFAULT_TEAM_ID;
      const newProj = formData.projectId || oldProj;
      const newTeam = formData.teamId || oldTeam;

      if (oldProj !== newProj || oldTeam !== newTeam) {
          if (taskId) {
            // MUST pass tempTask (full data) not just payload, otherwise we lose CreatedUser and other fields
            await TaskService.moveTask(taskId, tempTask, oldProj, oldTeam, newProj, newTeam);
            // Refresh logic? moveTask deletes old, so real-time listener should catch delete.
            // And real-time listener on new path (if active) should catch add.
            // However, local state update might be tricky if we don't listen to all.
            // If TaskList is showing a specific team, moving it Out means removing it.
            // If TaskList is "My Tasks" (all teams), we need to ensure we listen to new team.
            // For now, simpler: let the listener handle it.
             setEditVisible(false);
             setEditingTask(null);
             return;
          }
      }

      if (taskId) {
        // Use original project/team IDs for a regular update (no move)
        await TaskService.updateTask(taskId, payload, oldProj, oldTeam);
      }
      setEditVisible(false);
      setEditingTask(null);
    } catch (e: any) {
      alert(e.message);
    }
  };


  // Prepare sections for SectionList (List View)
  const displaySections = useMemo(() => {
    const result = [];
    
    // 1. AI Focus Section (if active)
    if (focusTasks.length > 0 && aiAccepted) {
      result.push({
        title: "AI Suggested Focus",
        data: focusTasks,
        isAiSection: true
      });
    }
    
    // 2. Regular Sections
    result.push(...sections);
    
    return result;
  }, [sections, focusTasks, aiAccepted]);

  const renderSectionHeader = ({ section: { title, data, isAiSection } }: any) => {
    if (isAiSection) {
       return (
          <View style={{ marginTop: 16, marginHorizontal: 16, marginBottom: 8, flexDirection: "row", alignItems: "center" }}>
             <Text style={{ fontSize: 18, fontWeight: "bold", color: theme.text }}>{title}</Text>
             <View style={{ marginLeft: 8, backgroundColor: `${COLORS.purple}15`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: COLORS.purple }}>Today's Priorities</Text>
             </View>
          </View>
       );
    }
    
    return (
      <View style={[styles.sectionHeader, { backgroundColor: isDarkmode ? "#000" : "#f2f2f7", marginTop: 0 }]}>
        <Text style={{ fontWeight: "700", fontSize: 16, color: theme.text }}>{title}</Text>
        <View style={{ backgroundColor: `${COLORS.primary}15`, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: COLORS.primary }}>{data.length}</Text>
        </View>
      </View>
    );
  };

  const renderItem = ({ item, index, section }: any) => {
    if (section.isAiSection) {
       // Special AI Styling
       const isTop1 = index === 0;
       const isTop2 = index === 1;
       const isTop3 = index === 2;
       
       let rankLabel = `#${index + 1}`;
       let rankColor = COLORS.primary;
       let bgColor = isDarkmode ? `${COLORS.primary}10` : `${COLORS.primary}05`;
       let borderColor = isDarkmode ? `${COLORS.primary}30` : `${COLORS.primary}20`;
       
       if (isTop1) {
          rankLabel = "🏆 TOP 1 PRIORITY";
          rankColor = COLORS.danger;
          bgColor = isDarkmode ? `${COLORS.danger}15` : `${COLORS.danger}05`;
          borderColor = COLORS.danger;
       } else if (isTop2) {
          rankLabel = "🥈 TOP 2 PRIORITY";
          rankColor = COLORS.warning;
          bgColor = isDarkmode ? `${COLORS.warning}15` : `${COLORS.warning}05`;
          borderColor = COLORS.warning;
       } else if (isTop3) {
          rankLabel = "🥉 TOP 3 PRIORITY";
          rankColor = COLORS.success;
          bgColor = isDarkmode ? `${COLORS.success}15` : `${COLORS.success}05`;
          borderColor = COLORS.success;
       }

       return (
        <View style={{ 
            marginHorizontal: 16,
            marginBottom: 12, 
            backgroundColor: bgColor, 
            borderRadius: 12, 
            borderWidth: 1, 
            borderColor: borderColor,
            overflow: 'hidden'
        }}>
          <View style={{ 
              backgroundColor: rankColor, 
              paddingVertical: 4, 
              paddingHorizontal: 12, 
              alignSelf: 'flex-start',
              borderBottomRightRadius: 12
          }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{rankLabel}</Text>
          </View>
          
          {item.reason && (
            <TouchableOpacity 
              onPress={() => Alert.alert("Why this task?", item.reason)}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                padding: 6,
                paddingHorizontal: 12,
                backgroundColor: 'rgba(0,0,0,0.05)',
                borderBottomLeftRadius: 12,
                flexDirection: 'row',
                alignItems: 'center'
              }}
            >
              <Text style={{ fontSize: 10, color: borderColor, fontWeight: '600', marginRight: 4 }}>Why?</Text>
              <Ionicons name="help-circle" size={14} color={borderColor} />
            </TouchableOpacity>
          )}
          
          <View style={{ padding: 12, paddingTop: 8 }}>
              <TaskItem 
                  item={{ ...item, _rank: index + 1 }} 
                  compact={false} 
                  readonly={true}
                  onToggle={handleToggleComplete} 
                  onDelete={handleDelete} 
                  onEdit={(item: any) => { setEditingTask(item); setEditVisible(true); }} 
                  onScorePress={setScoreExplainTask} 
               />
          </View>
        </View>
      );
    }

    // Normal Item
    return (
       <View style={{ paddingHorizontal: 0 }}>
          <TaskItem item={item} compact={compactMode} onToggle={handleToggleComplete} onDelete={handleDelete} onEdit={(item: any) => { setEditingTask(item); setEditVisible(true); }} onScorePress={setScoreExplainTask} />
       </View>
    );
  };

  // Loading state - MUST be after all hooks are defined!
  if (loading) {
    return (
      <Layout>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={{ marginTop: 12, color: theme.textSecondary }}>Loading tasks...</Text>
        </View>
      </Layout>
    );
  }

  return (
    <Layout>
      <TopNav
        middleContent={viewMode === "calendar" ? "Calendar" : "Task List"}
        leftContent={
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={20} color={isDarkmode ? themeColor.white100 : themeColor.dark} />
          </TouchableOpacity>
        }
        rightContent={
          <TouchableOpacity onPress={() => setTheme(isDarkmode ? "light" : "dark")}>
            <Ionicons name={isDarkmode ? "sunny" : "moon"} size={20} color={isDarkmode ? themeColor.white100 : themeColor.dark} />
          </TouchableOpacity>
        }
      />
      <View style={{ flex: 1 }}>
        {/* View Switcher (Segmented Control) - Only show if NOT controlled externally */ }
        {!externalViewMode && (
          <View style={{ marginHorizontal: 16, marginTop: 16, marginBottom: 8, flexDirection: 'row', backgroundColor: isDarkmode ? '#1e293b' : '#e2e8f0', borderRadius: 12, padding: 4 }}>
            <TouchableOpacity 
              onPress={() => setViewMode("list")}
              style={{ 
                flex: 1, 
                paddingVertical: 8, 
                alignItems: 'center', 
                borderRadius: 10,
                backgroundColor: viewMode === "list" ? (isDarkmode ? '#334155' : '#ffffff') : 'transparent',
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: viewMode === "list" ? 0.1 : 0,
                shadowRadius: 2,
                elevation: viewMode === "list" ? 2 : 0
              }}
            >
              <Text style={{ fontWeight: "600", fontSize: 13, color: theme.text }}>List View</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setViewMode("calendar")}
              style={{ 
                flex: 1, 
                paddingVertical: 8, 
                alignItems: 'center', 
                borderRadius: 10,
                backgroundColor: viewMode === "calendar" ? (isDarkmode ? '#334155' : '#ffffff') : 'transparent',
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: viewMode === "calendar" ? 0.1 : 0,
                shadowRadius: 2,
                elevation: viewMode === "calendar" ? 2 : 0
              }}
            >
              <Text style={{ fontWeight: "600", fontSize: 13, color: theme.text }}>Timeline</Text>
            </TouchableOpacity>
          </View>
        )}

        {viewMode === "list" ? (
           <SectionList
              sections={displaySections}
              keyExtractor={(item, index) => item.key + index}
              renderSectionHeader={renderSectionHeader}
              renderItem={renderItem}
              stickySectionHeadersEnabled={false}
              contentContainerStyle={{ paddingBottom: 100 }}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={{ flex: 1, paddingVertical: 60, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="albums-outline" size={48} color={theme.textSecondary} style={{ marginBottom: 16, opacity: 0.5 }} />
                  <Text style={{ color: theme.textSecondary, fontSize: 16, fontWeight: '600', marginBottom: 4 }}>No Tasks Yet</Text>
                  <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Tap + to add your first task</Text>
                </View>
              }
              ListHeaderComponent={
                 <>
                   <LoadBalancingBanner listLoadMap={listLoadMap} taskArray={taskArray} onMoveToLater={handleMoveToLater} isDarkmode={isDarkmode} />
                   
                   {/* AI Prioritization Header (Inline) */}
                   <TouchableOpacity
                       onPress={() => {
                          try {
                            const visibleTasks = sections.reduce((acc: any[], s: any) => [...acc, ...s.data], []);
                            analyzeTasksWithAI(visibleTasks);
                          } catch (e: any) {
                            Alert.alert("Error", "AI logic failed: " + e.message);
                          }
                       }}
                       disabled={aiBriefingLoading}
                       style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginHorizontal: 16, marginBottom: 16, backgroundColor: isDarkmode ? `${COLORS.primary}15` : `${COLORS.primary}10`, borderRadius: 12, borderWidth: 1, borderColor: `${COLORS.primary}30` }}
                   >
                       {aiBriefingLoading ? (
                         <ActivityIndicator size="small" color={COLORS.primary} style={{ marginRight: 8 }} />
                       ) : (
                         <Ionicons name="sparkles" size={18} color={COLORS.primary} style={{ marginRight: 8 }} />
                       )}
                       <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.primary }}>
                           {aiBriefingLoading ? "Analyzing..." : "Analyze & Prioritize Tasks"}
                       </Text>
                   </TouchableOpacity>

                   {/* AI Suggestions (Pre-acceptance) */}
                   {aiSuggestions && !aiAccepted && (
                     <View style={{ marginHorizontal: 16, marginBottom: 20, padding: 16, backgroundColor: isDarkmode ? "#1f2937" : "#f0f9ff", borderRadius: 12, borderWidth: 1, borderColor: COLORS.primary }}>
                        <Text style={{ fontWeight: "700", color: COLORS.primary, marginBottom: 8 }}>AI Suggestions</Text>
                        <Text style={{ color: theme.text, marginBottom: 12 }}>{aiSuggestions.summary}</Text>
                        
                        {aiSuggestions.topTasks && aiSuggestions.topTasks.length > 0 && (
                          <View style={{ marginBottom: 16 }}>
                            <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textSecondary, marginBottom: 10 }}>Recommended Tasks:</Text>
                            {aiSuggestions.topTasks.map((suggestion: any, idx: number) => {
                              const task = taskArray.find((t: any) => t.key === suggestion.id);
                              if (!task) {
                                console.warn(`AI suggested invalid task ID ${suggestion.id}`);
                                return null;
                              }
                              return (
                                <View key={`suggestion-${idx}`} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, padding: 10, backgroundColor: isDarkmode ? '#0f172a' : '#ffffff', borderRadius: 8, borderWidth: 1, borderColor: isDarkmode ? '#334155' : '#e2e8f0' }}>
                                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: idx === 0 ? `${COLORS.danger}20` : idx === 1 ? `${COLORS.warning}20` : `${COLORS.success}20`, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                                    <Text style={{ fontSize: 12, fontWeight: '800', color: idx === 0 ? COLORS.danger : idx === 1 ? COLORS.warning : COLORS.success }}>{suggestion.rank}</Text>
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }} numberOfLines={1}>{task.taskName}</Text>
                                    {suggestion.reason && <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>💡 {suggestion.reason}</Text>}
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        )}
                        <View style={{ flexDirection: "row", gap: 8 }}>
                           <Button text="Accept" onPress={() => {
                             const suggestedTasks = aiSuggestions.topTasks.map((s: any) => taskArray.find((t: any) => String(t.key).trim() === String(s.id).trim())).filter(Boolean);
                             if (suggestedTasks.length === 0) { Alert.alert("Error", "Could not find tasks."); return; }
                             setFocusTasks(suggestedTasks);
                             setAiAccepted(true);
                           }} style={{ flex: 1 }} status="success" />
                           <Button text="Reject" onPress={() => { setAiSuggestions(null); setAiAccepted(false); }} style={{ flex: 1 }} status="danger" outline />
                        </View>
                     </View>
                   )}
                 </>
              }
           />
        ) : (
           <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
               {/* Month View Container */}
               <View style={{ marginBottom: 20 }}>
                 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
                    <TouchableOpacity onPress={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>
                        <Ionicons name="chevron-back" size={24} color={theme.text} />
                    </TouchableOpacity>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: theme.text }}>
                        {currentMonth.toLocaleDateString("en-US", { month: 'long', year: 'numeric' })}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                        <TouchableOpacity onPress={() => {
                            const today = new Date();
                            setCurrentMonth(today);
                            setTimelineDate(today);
                        }}>
                            <Text style={{ color: COLORS.primary, fontWeight: "600" }}>Today</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>
                            <Ionicons name="chevron-forward" size={24} color={theme.text} />
                        </TouchableOpacity>
                    </View>
                 </View>
                 {/* Weekday Headers */}
                 <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8, justifyContent: 'space-between' }}>
                    {['S','M','T','W','T','F','S'].map((day, i) => (
                        <Text key={i} style={{ width: (SCREEN_WIDTH - 32) / 7, textAlign: 'center', color: theme.textSecondary, fontWeight: '600', opacity: 0.6 }}>{day}</Text>
                    ))}
                 </View>

                 {/* Month Grid */}
                 <View style={{ paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                   {monthGrid.map((item, index) => {
                      const { date: d, isCurrentMonth } = item;
                      const isSelected = isSameDay(d, timelineDate);
                      const isToday = isSameDay(d, new Date());
                      
                      return (
                         <TouchableOpacity 
                            key={index}
                            onPress={() => {
                                setTimelineDate(d);
                                // If clicking a date outside current month, switch month view?
                                if (!isCurrentMonth) setCurrentMonth(d);
                            }}
                            style={{ 
                               alignItems: 'center', 
                               justifyContent: 'center',
                               width: (SCREEN_WIDTH - 32) / 7,
                               height: 48,
                               marginBottom: 4,
                            }}
                         >
                            <View style={{
                                width: 36,
                                height: 36,
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 18,
                                backgroundColor: isSelected ? COLORS.primary : (isToday ? `${COLORS.primary}20` : 'transparent'),
                                borderWidth: isToday && !isSelected ? 1 : 0,
                                borderColor: COLORS.primary
                            }}>
                                <Text style={{ 
                                    fontSize: 15, 
                                    fontWeight: isSelected || isToday ? '700' : '400', 
                                    color: isSelected ? '#fff' : (isCurrentMonth ? theme.text : theme.textSecondary),
                                    opacity: isCurrentMonth ? 1 : 0.4 
                                }}>
                                  {d.getDate()}
                                </Text>
                            </View>
                            
                            {/* Dot indicator if tasks exist */}
                            {taskArray.some(t => { const td = toDate(t.dueDate); return td && isSameDay(td, d) && !t.isCompleted }) && (
                               <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isSelected ? '#fff' : COLORS.primary, marginTop: 4 }} />
                            )}
                         </TouchableOpacity>
                      );
                   })}
                 </View>
               </View>

               {/* Selected Day Header */}
               <View style={{ paddingHorizontal: 20, marginBottom: 14, marginTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                 <Text style={{ fontSize: 18, fontWeight: '700', color: theme.text }}>
                   {timelineDate.toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric' })}
                 </Text>
                 <Text style={{ fontSize: 13, color: theme.textSecondary, fontWeight: "600" }}>{tasksForTimeline.length} tasks</Text>
               </View>

               {/* Task List for Selected Day */}
               <View style={{ paddingHorizontal: 0 }}>
                 {tasksForTimeline.length > 0 ? tasksForTimeline.map((item: any) => (
                    <View key={item.key}>
                       <TaskItem item={item} compact={compactMode} onToggle={handleToggleComplete} onDelete={handleDelete} onEdit={(item: any) => { setEditingTask(item); setEditVisible(true); }} onScorePress={setScoreExplainTask} />
                    </View>
                 )) : (
                    <View style={{ padding: 40, alignItems: 'center', justifyContent: 'center' }}>
                       <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: isDarkmode ? '#1e293b' : '#f8fafc', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                          <Ionicons name="file-tray-outline" size={32} color={theme.textSecondary} style={{ opacity: 0.5 }} />
                       </View>
                       <Text style={{ color: theme.textSecondary, fontSize: 14 }}>No tasks scheduled for this day</Text>
                       <TouchableOpacity onPress={() => navigation.navigate("TaskAdd", { presetDate: timelineDate.toISOString() })} style={{ marginTop: 16 }}>
                          <Text style={{ color: COLORS.primary, fontWeight: "600" }}>+ Add task for {timelineDate.toLocaleDateString("en-US", { month: 'short', day: 'numeric' })}</Text>
                       </TouchableOpacity>
                    </View>
                 )}
               </View>
           </ScrollView>
        )}

      </View>

      <ScoreExplanationModal 
        visible={!!scoreExplainTask} 
        onClose={() => setScoreExplainTask(null)} 
        task={scoreExplainTask} 
        listLoadMap={listLoadMap} 
      />

      <TaskEditModal visible={editVisible} onClose={() => setEditVisible(false)} editingTask={editingTask} onSave={handleSaveEdit} taskArray={taskArray} />
    </Layout>
  );
}

const styles = StyleSheet.create({
  statCard: { padding: 14, borderRadius: 14, alignItems: "center" },
  statNumber: { fontSize: 20, fontWeight: "800", marginBottom: 2 },
  statLabel: { fontSize: 11, fontWeight: "500" },
  cardContainer: { marginHorizontal: 16, marginBottom: 10, borderRadius: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2, overflow: "hidden" },
  cardInner: { flexDirection: "row", padding: 16, paddingLeft: 20, alignItems: "center" },
  sectionHeader: { paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 16 },
  label: { fontSize: 14, fontWeight: "600", color: "#64748b", marginBottom: 6, marginTop: 12 },
  priorityRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  priorityChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "transparent" },
  priorityChipActive: { backgroundColor: "#e0e7ff", borderColor: "#6366f1" },
});
