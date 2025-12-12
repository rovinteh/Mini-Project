import React, { useState, useEffect } from "react";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, updateDoc } from "firebase/firestore";
import { View, ScrollView, TouchableOpacity, Alert, Dimensions, Modal, FlatList, Image, Platform, KeyboardAvoidingView, ActivityIndicator } from "react-native";
import QRCode from 'react-native-qrcode-svg';
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  Layout,
  TopNav,
  Text,
  useTheme,
  themeColor,
  Button,
  TextInput,
} from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { GlassView } from "expo-glass-effect";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MainStackParamList } from "../../types/navigation";
import { useProjectData, useTeamData, useProjectTasks, useMemberProfiles, useTeamConversationSummary } from "./TaskHooks";
import { Project, Team, DEFAULT_PROJECT_ID, DEFAULT_TEAM_ID } from "./data";
import TeamChat from "./TeamChat";

const { width } = Dimensions.get("window");

type Props = NativeStackScreenProps<MainStackParamList, "TeamManagement"> & {
  pendingSelection?: { projectId: string; teamId: string } | null;
  onSelectionHandled?: () => void;
};

export default function TeamManagement({
  navigation,
  pendingSelection,
  onSelectionHandled
}: Props) {
  const { isDarkmode, setTheme } = useTheme();
  
  // Data Hooks
  const { projects, createProject, updateProject } = useProjectData();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  
  // Reassignment State
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [taskToReassign, setTaskToReassign] = useState<any>(null); // Type Task if imported, using any for safety now
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null);
  const [isChatExpanded, setIsChatExpanded] = useState(false);

  const hasAdminRights = getAuth().currentUser?.email?.endsWith('@1utar.my');

  const checkPermission = () => {
    if (hasAdminRights) return true;
    Alert.alert("Permission Denied", "Only Team Leader can perform further action.");
    return false;
  };
  
  const { teams, createTeam, updateTeam, deleteTeam, removeMember } = useTeamData(selectedProjectId);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const currentProject = projects.find(p => p.id === selectedProjectId);
  const currentTeam = teams.find(t => t.id === selectedTeamId);
  

  const { tasks: teamTasks } = useProjectTasks(selectedProjectId, selectedTeamId);
  const { summary, loading: summaryLoading } = useTeamConversationSummary(selectedProjectId, selectedTeamId, currentTeam?.name || "Team");


  // UI State
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [showQR, setShowQR] = useState(false);
  
  // Team Rename State
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [teamToRename, setTeamToRename] = useState<Team | null>(null);
  const [renameText, setRenameText] = useState("");
  


  const handleTeamLongPress = (team: Team) => {
    if (!checkPermission()) return;
    
    Alert.alert(
      "Manage Team",
      `What would you like to do with "${team.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
            text: "Rename", 
            onPress: () => {
                setTeamToRename(team);
                setRenameText(team.name);
                setShowRenameModal(true);
            } 
        },
        { 
            text: "Delete", 
            style: "destructive", 
            onPress: () => {
                Alert.alert(
                    "Confirm Delete", 
                    "Are you sure you want to delete this team? This action cannot be undone.",
                    [
                        { text: "Cancel", style: "cancel" },
                        { 
                            text: "Delete", 
                            style: "destructive", 
                            onPress: () => {
                                deleteTeam(team.id); 
                                if (selectedTeamId === team.id) setSelectedTeamId(null);
                            } 
                        }
                    ]
                );
            } 
        }
      ]
    );
  };

  const handleRenameSubmit = () => {
      if (teamToRename && renameText.trim()) {
          updateTeam(teamToRename.id, { name: renameText.trim() });
          setShowRenameModal(false);
          setTeamToRename(null);
      }
  };

  // Handle Pending Selection
  useEffect(() => {
    if (pendingSelection) {
       if (pendingSelection.projectId !== selectedProjectId) {
           setSelectedProjectId(pendingSelection.projectId);
           setSelectedTeamId(null);
       }
    }
  }, [pendingSelection]);

  useEffect(() => {
     if (pendingSelection && teams.length > 0 && selectedProjectId === pendingSelection.projectId) {
         const found = teams.find(t => t.id === pendingSelection.teamId);
         if (found) {
             setSelectedTeamId(found.id);
             if (onSelectionHandled) onSelectionHandled();
         }
     }
  }, [teams, pendingSelection, selectedProjectId]);

  useEffect(() => {
    // Auto-select first project if available and none selected (and no pending intent)
    if (projects.length > 0 && !selectedProjectId && !pendingSelection) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects]);

  useEffect(() => {
    // Auto-select first team
    if (teams.length > 0 && !selectedTeamId && !pendingSelection) {
      setSelectedTeamId(teams[0].id);
    }
  }, [teams]);


  const memberProfiles = useMemberProfiles(currentTeam?.members || []);
  const currentUserId = getAuth().currentUser?.uid;

  // Real Workload Calculation
  const calculateWorkload = () => {
    if (!currentTeam || !currentTeam.members) return [];
    
    // 1. Initialize map
    const workloadMap: Record<string, number> = {};
    currentTeam.members.forEach(m => workloadMap[m] = 0);
    
    // 2. Count active tasks
    teamTasks.forEach(t => {
      if (t.isCompleted) return;
      // Use assignedTo for workload distribution, falling back to CreatedUserId only if unassigned
      const userId = t.assignedTo || t.CreatedUser?.CreatedUserId; 
      if (userId && workloadMap.hasOwnProperty(userId)) {
          workloadMap[userId]++;
      }
    });

    // 3. Convert to array with load % (Relative to total team tasks)
    const totalTeamTasks = Object.values(workloadMap).reduce((a, b) => a + b, 0);

    return Object.entries(workloadMap).map(([id, count]) => {
      // Use memberProfiles to get name (already fetched)
      // Note: memberProfiles is a map of id -> profile
      const name = id === currentUserId ? "You" : (memberProfiles[id]?.displayName || id.substring(0, 5));
      
      let percentage = 0;
      if (totalTeamTasks > 0) {
        percentage = Math.round((count / totalTeamTasks) * 100);
      }

      return {
        name: name,
        load: Math.min(percentage, 100), // Should not exceed 100 mathematically, but safe cap
        tasks: count
      };
    });
  };
  
  const workloadStats = calculateWorkload();

  const handleReassignTask = async (taskId: string, newMemberId: string) => {
      if (!selectedProjectId || !selectedTeamId) return;
      try {
        const ref = doc(getFirestore(), `Projects/${selectedProjectId}/Teams/${selectedTeamId}/Tasks/${taskId}`);
        await updateDoc(ref, { assignedTo: newMemberId });
        setTaskToReassign(null); // Close selection
        // No need to close main modal, user might want to reassign more
      } catch (e) {
        Alert.alert("Error", "Failed to reassign task");
      }
  };

  const handleCreateProject = async () => {
    if (!checkPermission()) return;
    if (!newProjectName.trim()) return;
    await createProject(newProjectName);
    setNewProjectName("");
    setShowProjectModal(false);
  };

  const handleCreateTeam = async () => {
    if (!checkPermission()) return;
    if (!newTeamName.trim()) return;
    await createTeam(newTeamName);
    setNewTeamName("");
    setShowTeamModal(false);
  };

  return (
    <Layout>
      <TopNav
        middleContent="Team Management"
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
          if (isDarkmode) {
            setTheme("light");
          } else {
            setTheme("dark");
          }
        }}
      />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? -20 : 0}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1 }}>
            {!isChatExpanded && (
            <View style={{ flex: 1 }}>
                <ScrollView style={{ flex: 1, padding: 16 }} showsVerticalScrollIndicator={false}>
                    <View style={{ marginBottom: 20 }}>
                    <Text style={{ fontSize: 14, opacity: 0.6, marginBottom: 5 }}>Current Project</Text>
                    <TouchableOpacity 
                        onPress={() => setShowProjectModal(true)}
                        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDarkmode ? '#1e293b' : '#fff', padding: 12, borderRadius: 10 }}
                    >
                        <Ionicons name="briefcase" size={20} color="#3b82f6" style={{ marginRight: 10 }} />
                        <Text style={{ flex: 1, fontWeight: 'bold' }}>{currentProject?.name || "Select Project"}</Text>
                        <Ionicons name="chevron-down" size={16} color={isDarkmode ? '#fff' : '#000'} />
                    </TouchableOpacity>
                    </View>

                    {/* Project Timeline */}
                    {selectedProjectId && currentProject && (
                        <View style={{ marginBottom: 20, padding: 15, borderRadius: 10, overflow: "hidden", backgroundColor: isDarkmode ? '#1e293b' : '#fff' }}>
                            <Text style={{ fontWeight: 'bold', marginBottom: 10 }}>Project Timeline</Text>
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                                {/* Start Date */}
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 12, opacity: 0.6 }}>Start Date</Text>
                                    {Platform.OS === 'ios' ? (
                                        <DateTimePicker
                                            value={currentProject.timeline?.startDate ? new Date(currentProject.timeline.startDate) : new Date()}
                                            mode="date"
                                            display="compact"
                                            style={{ marginTop: 5, alignSelf: 'flex-start' }}
                                            disabled={!hasAdminRights}
                                            onChange={(e, d) => {
                                                if (d && checkPermission() && selectedProjectId) {
                                                    const old = currentProject.timeline || { startDate: 0, endDate: 0 };
                                                    const newTimeline = { ...old, startDate: d.getTime(), endDate: old.endDate || (d.getTime() + 86400000) };
                                                    updateProject(selectedProjectId, { timeline: newTimeline } as any).catch(err => console.error(err));
                                                }
                                            }}
                                        />
                                    ) : Platform.OS === 'web' ? (
                                        <View style={{ padding: 10, backgroundColor: isDarkmode?'#00000030':'#f0f0f0', borderRadius: 8, marginTop: 5 }}>
                                            <DateTimePicker
                                                value={currentProject.timeline?.startDate ? new Date(currentProject.timeline.startDate) : new Date()}
                                                mode="date"
                                                style={{ width: '100%', height: 25, opacity: hasAdminRights ? 1 : 0.5 }}
                                                onChange={(e, d) => {
                                                    let selectedDate = d;
                                                    if (!selectedDate && (e as any).target?.value) {
                                                        selectedDate = new Date((e as any).target.value);
                                                    }
                                                    if (selectedDate && !isNaN(selectedDate.getTime()) && checkPermission() && selectedProjectId) {
                                                        const old = currentProject.timeline || { startDate: 0, endDate: 0 };
                                                        const newTimeline = { ...old, startDate: selectedDate.getTime(), endDate: old.endDate || (selectedDate.getTime() + 86400000) };
                                                        updateProject(selectedProjectId, { timeline: newTimeline } as any).catch(err => Alert.alert("Error", "Failed to save date"));
                                                    }
                                                }}
                                            />
                                        </View>
                                    ) : (
                                        // Android or others
                                        <TouchableOpacity 
                                            onPress={() => checkPermission() && setShowStartPicker(true)}
                                            style={{ padding: 10, backgroundColor: isDarkmode?'#00000030':'#f0f0f0', borderRadius: 8, marginTop: 5 }}
                                        >
                                            <Text style={{ fontWeight: 'bold', color: isDarkmode ? '#fff' : '#333' }}>
                                                {currentProject.timeline?.startDate 
                                                ? new Date(currentProject.timeline.startDate).toLocaleDateString() 
                                                : "Set Start"}
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                                
                                {/* End Date */}
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 12, opacity: 0.6 }}>End Date</Text>
                                    {Platform.OS === 'ios' ? (
                                        <DateTimePicker
                                            value={currentProject.timeline?.endDate ? new Date(currentProject.timeline.endDate) : new Date()}
                                            mode="date"
                                            display="compact"
                                            style={{ marginTop: 5, alignSelf: 'flex-start' }}
                                            disabled={!hasAdminRights}
                                            onChange={(e, d) => {
                                                if (d && checkPermission() && selectedProjectId) {
                                                    const old = currentProject.timeline || { startDate: 0, endDate: 0 };
                                                    const newTimeline = { ...old, endDate: d.getTime() };
                                                    updateProject(selectedProjectId, { timeline: newTimeline } as any).catch(err => console.error(err));
                                                }
                                            }}
                                        />
                                    ) : Platform.OS === 'web' ? (
                                        <View style={{ padding: 10, backgroundColor: isDarkmode?'#00000030':'#f0f0f0', borderRadius: 8, marginTop: 5 }}>
                                            <DateTimePicker
                                                value={currentProject.timeline?.endDate ? new Date(currentProject.timeline.endDate) : new Date()}
                                                mode="date"
                                                style={{ width: '100%', height: 25, opacity: hasAdminRights ? 1 : 0.5 }}
                                                onChange={(e, d) => {
                                                    let selectedDate = d;
                                                    if (!selectedDate && (e as any).target?.value) {
                                                        selectedDate = new Date((e as any).target.value);
                                                    }
                                                    if (selectedDate && !isNaN(selectedDate.getTime()) && checkPermission() && selectedProjectId) {
                                                        const old = currentProject.timeline || { startDate: 0, endDate: 0 };
                                                        const newTimeline = { ...old, endDate: selectedDate.getTime() };
                                                        updateProject(selectedProjectId, { timeline: newTimeline } as any).catch(err => Alert.alert("Error", "Failed to save date"));
                                                    }
                                                }}
                                            />
                                        </View>
                                    ) : (
                                        <TouchableOpacity 
                                            onPress={() => checkPermission() && setShowEndPicker(true)}
                                            style={{ padding: 10, backgroundColor: isDarkmode?'#00000030':'#f0f0f0', borderRadius: 8, marginTop: 5 }}
                                        >
                                            <Text style={{ fontWeight: 'bold', color: isDarkmode ? '#fff' : '#333' }}>
                                                {currentProject.timeline?.endDate 
                                                ? new Date(currentProject.timeline.endDate).toLocaleDateString() 
                                                : "Set End"}
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>
                            
                            {/* Pickers (Android Only) */}
                            {Platform.OS === 'android' && showStartPicker && (
                                <DateTimePicker
                                    value={currentProject.timeline?.startDate ? new Date(currentProject.timeline.startDate) : new Date()}
                                    mode="date"
                                    display="default"
                                    onChange={(e, d) => {
                                        setShowStartPicker(false);
                                        if (d && selectedProjectId) {
                                            const old = currentProject.timeline || { startDate: 0, endDate: 0 };
                                            const newTimeline = { ...old, startDate: d.getTime(), endDate: old.endDate || (d.getTime() + 86400000) };
                                            updateProject(selectedProjectId, { timeline: newTimeline } as any);
                                        }
                                    }}
                                />
                            )}
                            {Platform.OS === 'android' && showEndPicker && (
                                <DateTimePicker
                                    value={currentProject.timeline?.endDate ? new Date(currentProject.timeline.endDate) : new Date()}
                                    mode="date"
                                    display="default"
                                    onChange={(e, d) => {
                                        setShowEndPicker(false);
                                        if (d && selectedProjectId) {
                                            const old = currentProject.timeline || { startDate: 0, endDate: 0 };
                                            const newTimeline = { ...old, endDate: d.getTime() };
                                            updateProject(selectedProjectId, { timeline: newTimeline } as any);
                                        }
                                    }}
                                />
                            )}
                        </View>
                    )}

                    {/* Team Selector & Info */}
                    {selectedProjectId && (
                    <View style={{ marginBottom: 20 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <Text style={{ fontSize: 14, opacity: 0.6 }}>Active Team</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
                            {selectedTeamId && (
                                <TouchableOpacity onPress={() => setShowQR(true)}>
                                    <Ionicons name="qr-code-outline" size={24} color={isDarkmode ? "#fff" : "#333"} />
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity 
                                onPress={() => setShowTeamModal(true)}
                                style={{
                                    backgroundColor: '#3b82f6',
                                    paddingHorizontal: 12,
                                    paddingVertical: 6,
                                    borderRadius: 8,
                                    flexDirection: 'row',
                                    alignItems: 'center'
                                }}
                            >
                                <Ionicons name="add" size={16} color="#fff" style={{ marginRight: 4 }} />
                                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>New Team</Text>
                            </TouchableOpacity>
                        </View>
                        </View>
                        
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {teams.map(t => (
                            <TouchableOpacity
                            key={t.id}
                            onPress={() => setSelectedTeamId(t.id)}
                            onLongPress={() => handleTeamLongPress(t)}
                            style={{
                                marginRight: 10,
                                padding: 10,
                                backgroundColor: t.id === selectedTeamId ? '#3b82f6' : (isDarkmode ? '#1e293b' : '#e2e8f0'),
                                borderRadius: 8
                            }}
                            >
                            <Text style={{ color: t.id === selectedTeamId ? '#fff' : (isDarkmode ? '#ccc' : '#333') }}>
                                {t.name}
                            </Text>
                            </TouchableOpacity>
                        ))}
                        </ScrollView>
                    </View>
                    )}

                    {/* AI Team Summary */}
                    {(summary || summaryLoading) && (
                        <View style={{ 
                            marginBottom: 20, 
                            backgroundColor: isDarkmode ? '#1e293b' : '#fff', 
                            borderRadius: 12, 
                            padding: 15,
                            borderLeftWidth: 4,
                            borderLeftColor: '#8b5cf6' 
                        }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <Text style={{ fontWeight: 'bold', color: isDarkmode ? '#fff' : '#0f172a' }}>✨ Team AI Summary</Text>
                                {summaryLoading && <ActivityIndicator size="small" color="#8b5cf6" />}
                            </View>
                            
                            {!summaryLoading && summary ? (
                                (() => {
                                    try {
                                        // Attempt to clean and parse JSON
                                        const cleanSummary = summary.replace(/```json/g, '').replace(/```/g, '').trim();
                                        const parsed = JSON.parse(cleanSummary);
                                        
                                        if (typeof parsed === 'object' && parsed !== null) {
                                            return Object.entries(parsed).map(([category, items]) => (
                                                <View key={category} style={{ marginBottom: 12 }}>
                                                    <Text style={{ 
                                                        fontWeight: 'bold', 
                                                        fontSize: 14,
                                                        color: isDarkmode ? '#a78bfa' : '#7c3aed', 
                                                        marginBottom: 6 
                                                    }}>
                                                        {category.replace(/[\[\]"]/g, '')}
                                                    </Text>
                                                    {Array.isArray(items) && items.map((item: any, idx: number) => (
                                                        <View key={idx} style={{ flexDirection: 'row', marginBottom: 4, paddingLeft: 4 }}>
                                                            <Text style={{ color: isDarkmode ? '#94a3b8' : '#64748b', marginRight: 8 }}>•</Text>
                                                            <Text style={{ flex: 1, fontSize: 13, lineHeight: 20, color: isDarkmode ? '#cbd5e1' : '#334155' }}>
                                                                {String(item)}
                                                            </Text>
                                                        </View>
                                                    ))}
                                                </View>
                                            ));
                                        }
                                        throw new Error("Not an object");
                                    } catch (e) {
                                        // Fallback rendering for plain text
                                        return (
                                            <Text style={{ fontSize: 13, lineHeight: 20, color: isDarkmode ? '#cbd5e1' : '#475569' }}>
                                                {summary}
                                            </Text>
                                        );
                                    }
                                })()
                            ) : !summaryLoading && (
                                <Text style={{ fontSize: 13, fontStyle: 'italic', opacity: 0.6 }}>
                                    Analyzing recent conversations...
                                </Text>
                            )}
                        </View>
                    )}

                    {/* Workload Distribution */}
                    <View style={{ padding: 15, borderRadius: 16, overflow: 'hidden', backgroundColor: isDarkmode ? '#1e293b' : '#fff', marginBottom: 25 }}>
                        <Text style={{ fontWeight: 'bold', marginBottom: 10 }}>Workload Distribution</Text>
                        {workloadStats.map((w, i) => (
                        <View key={i} style={{ marginBottom: 10 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text style={{ fontSize: 12 }}>{w.name}</Text>
                            <Text style={{ fontSize: 12 }}>{w.load}%</Text>
                            </View>
                            <View style={{ height: 6, backgroundColor: isDarkmode ? '#334155' : '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                            <View style={{ height: '100%', width: `${w.load}%`, backgroundColor: w.load > 80 ? '#ef4444' : '#10b981' }} />
                            </View>
                            {w.load > 80 && (
                                <Text style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>⚠️ Overloaded - Consider reassigning</Text>
                            )}
                        </View>
                        ))}
                        
                        {hasAdminRights && (
                            <Button 
                                text="Manage Assignments" 
                                size="sm" 
                                status="primary" 
                                outline
                                onPress={() => checkPermission() && setShowReassignModal(true)}
                                style={{ marginTop: 10 }}
                            />
                        )}
                    </View>


                    {/* Team Members List */}
                    <View style={{ marginBottom: 20 }}>
                        <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Team Members</Text>
                        {currentTeam?.members.length === 0 ? (
                            <Text>No members yet.</Text>
                        ) : (
                            <View style={{ backgroundColor: isDarkmode ? '#1e293b' : '#fff', borderRadius: 12, padding: 15 }}>
                                {/* For demo, just showing User ID, normally fetch Profile data */}
                                {currentTeam?.members.map(m => (
                                    <View key={m} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                                            {(() => {
                                                const u = getAuth().currentUser;
                                                const isMe = m === u?.uid;
                                                const photo = isMe ? u?.photoURL : memberProfiles[m]?.photoURL;
                                                if (photo) {
                                                    return <Image source={{ uri: photo }} style={{ width: 32, height: 32, borderRadius: 16 }} />;
                                                }
                                                return <Ionicons name="person" size={16} color="#64748b" />;
                                            })()}
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ fontWeight: '500' }}>
                                                {m === currentUserId ? "You" : (memberProfiles[m]?.displayName || "Loading Member...")}
                                            </Text>
                                        </View>
                                        
                                        {hasAdminRights && m !== currentUserId && (
                                            <TouchableOpacity 
                                                onPress={() => setMemberToRemove(m)}
                                                style={{ padding: 8 }}
                                            >
                                                <Ionicons name="trash-outline" size={20} color="#ef4444" />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                ))}

                            </View>
                        )}
                    </View>
                </ScrollView>
            </View>
            )}
            
            {selectedProjectId && selectedTeamId && (
                 <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 0, paddingTop: 10 }}>
                     <TeamChat 
                        projectId={selectedProjectId} 
                        teamId={selectedTeamId} 
                        teamName={currentTeam?.name}
                        onFocus={() => setIsChatExpanded(true)}
                        onBlur={() => setIsChatExpanded(false)}
                     />
                 </View>
            )}
        </View>
      </KeyboardAvoidingView>

      {/* QR Code Modal - Moved outside of List */}
        <Modal visible={showQR} transparent animationType="fade" onRequestClose={() => setShowQR(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
                <View style={{ backgroundColor: isDarkmode ? '#1e293b' : 'white', padding: 30, borderRadius: 20, alignItems: 'center' }}>
                    <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 20, color: isDarkmode ? '#fff' : '#000' }}>
                        Join {currentTeam?.name}
                    </Text>
                    <View style={{ padding: 10, backgroundColor: 'white', borderRadius: 10 }}>
                        {currentTeam && selectedProjectId && (
                            <QRCode 
                                value={JSON.stringify({ 
                                    projectId: selectedProjectId, 
                                    teamId: currentTeam.id, 
                                    name: currentTeam.name 
                                })} 
                                size={200} 
                            />
                        )}
                    </View>
                    <Text style={{ marginTop: 20, color: isDarkmode ? '#ccc' : '#666', textAlign: 'center' }}>
                        Scan this code with the App Scanner to join.
                    </Text>
                    <Button text="Close" onPress={() => setShowQR(false)} style={{ marginTop: 20, width: '100%' }} />
                </View>
            </View>
        </Modal>

        {/* Rename Team Modal */}
        <Modal visible={showRenameModal} transparent animationType="fade" onRequestClose={() => setShowRenameModal(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
                <View style={{ backgroundColor: isDarkmode ? '#1e293b' : 'white', padding: 20, borderRadius: 12, width: '80%' }}>
                    <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 15, color: isDarkmode ? '#fff' : '#000' }}>Rename Team</Text>
                    <TextInput 
                        placeholder="Enter new team name"
                        value={renameText}
                        onChangeText={setRenameText}
                        containerStyle={{ marginBottom: 20 }}
                    />
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
                        <Button text="Cancel" size="sm" status="danger" onPress={() => setShowRenameModal(false)} />
                        <Button text="Save" size="sm" onPress={handleRenameSubmit} />
                    </View>
                </View>
            </View>
        </Modal>

        {/* Remove Member Confirmation Modal */}
        <Modal visible={!!memberToRemove} transparent animationType="fade" onRequestClose={() => setMemberToRemove(null)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
                <View style={{ backgroundColor: isDarkmode ? '#1e293b' : 'white', padding: 20, borderRadius: 12, width: '80%' }}>
                    <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 15, color: isDarkmode ? '#fff' : '#000' }}>Remove Member</Text>
                    <Text style={{ marginBottom: 20, color: isDarkmode ? '#ccc' : '#666' }}>
                        Are you sure you want to remove this member?
                    </Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
                        <Button text="Cancel" size="sm" status="primary" outline onPress={() => setMemberToRemove(null)} />
                        <Button 
                            text="Remove" 
                            size="sm" 
                            status="danger" 
                            onPress={() => {
                                if (selectedTeamId && memberToRemove) {
                                    removeMember(selectedTeamId, memberToRemove);
                                    setMemberToRemove(null);
                                }
                            }} 
                        />
                    </View>
                </View>
            </View>
        </Modal>

      {/* Project Modal */}
      <Modal visible={showProjectModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
            <View style={{ backgroundColor: isDarkmode ? '#1e293b' : '#fff', padding: 20, borderRadius: 12 }}>
                <Text style={{ marginBottom: 15, fontSize: 18, fontWeight: 'bold' }}>Create Project</Text>
                <TextInput 
                    placeholder="Project Name" 
                    value={newProjectName} 
                    onChangeText={setNewProjectName}
                    containerStyle={{ marginBottom: 15 }}
                />
                
                <ScrollView style={{ maxHeight: 200, marginBottom: 15 }}>
                    <Text style={{ marginBottom: 5, opacity: 0.6 }}>Or Select Existing:</Text>
                    {projects.map(p => (
                        <TouchableOpacity 
                            key={p.id} 
                            style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: isDarkmode ? '#334155' : '#e2e8f0' }}
                            onPress={() => {
                                setSelectedProjectId(p.id);
                                setShowProjectModal(false);
                            }}
                        >
                            <Text>{p.name}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>

                <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <Button text="Cancel" status="info" outline onPress={() => setShowProjectModal(false)} size="sm" style={{ marginRight: 10 }} />
                    <Button text="Create" status="primary" onPress={handleCreateProject} size="sm" />
                </View>
            </View>
        </View>
      </Modal>

      {/* Team Modal */}
      <Modal visible={showTeamModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
            <View style={{ backgroundColor: isDarkmode ? '#1e293b' : '#fff', padding: 20, borderRadius: 12 }}>
                <Text style={{ marginBottom: 15, fontSize: 18, fontWeight: 'bold' }}>Create Team</Text>
                <TextInput 
                    placeholder="Team Name" 
                    value={newTeamName} 
                    onChangeText={setNewTeamName}
                    containerStyle={{ marginBottom: 15 }}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <Button text="Cancel" status="info" outline onPress={() => setShowTeamModal(false)} size="sm" style={{ marginRight: 10 }} />
                    <Button text="Create" status="primary" onPress={handleCreateTeam} size="sm" />
                </View>
            </View>
        </View>
      </Modal>

      {/* Assignment Management Modal */}
      <Modal visible={showReassignModal} transparent animationType="slide" onRequestClose={() => setShowReassignModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: isDarkmode ? '#1e293b' : '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '80%', padding: 20 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Manage Assignments</Text>
                    <TouchableOpacity onPress={() => setShowReassignModal(false)}>
                        <Ionicons name="close" size={24} color={isDarkmode ? '#fff' : '#000'} />
                    </TouchableOpacity>
                </View>

                {taskToReassign ? (
                    <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
                            <TouchableOpacity onPress={() => setTaskToReassign(null)} style={{ marginRight: 10 }}>
                                <Ionicons name="arrow-back" size={24} color={isDarkmode ? '#fff' : '#333'} />
                            </TouchableOpacity>
                            <Text style={{ fontSize: 16, fontWeight: 'bold' }}>Assign "{taskToReassign.taskName}" to:</Text>
                        </View>
                        <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
                             {currentTeam?.members.map(m => (
                                 <TouchableOpacity 
                                    key={m} 
                                    onPress={() => handleReassignTask(taskToReassign.key || taskToReassign.id, m)}
                                    style={{ 
                                        flexDirection: 'row', 
                                        alignItems: 'center', 
                                        padding: 15, 
                                        backgroundColor: taskToReassign.assignedTo === m ? '#3b82f620' : (isDarkmode ? '#334155' : '#f1f5f9'),
                                        borderRadius: 10,
                                        marginBottom: 10,
                                        borderWidth: taskToReassign.assignedTo === m ? 1 : 0,
                                        borderColor: '#3b82f6'
                                    }}
                                 >
                                     <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', marginRight: 15 }}>
                                         {memberProfiles[m]?.photoURL ? (
                                            <Image source={{ uri: memberProfiles[m].photoURL }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                                         ) : (
                                            <Ionicons name="person" size={20} color="#64748b" />
                                         )}
                                     </View>
                                     <Text style={{ fontSize: 16, fontWeight: '500' }}>
                                         {m === currentUserId ? "You" : (memberProfiles[m]?.displayName || "Loading...")}
                                     </Text>
                                     {taskToReassign.assignedTo === m && (
                                         <View style={{ marginLeft: 'auto' }}>
                                             <Ionicons name="checkmark-circle" size={24} color="#3b82f6" />
                                         </View>
                                     )}
                                 </TouchableOpacity>
                             ))}
                        </ScrollView>
                    </View>
                ) : (
                    <View style={{ flex: 1 }}>
                        <Text style={{ marginBottom: 10, opacity: 0.6 }}>Found {teamTasks.length} tasks in this team.</Text>
                        <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
                            {teamTasks.map(t => (
                                <TouchableOpacity 
                                    key={t.key || t.id} 
                                    onPress={() => setTaskToReassign(t)}
                                    style={{ 
                                        flexDirection: 'row', 
                                        justifyContent: 'space-between',
                                        alignItems: 'center', 
                                        padding: 15, 
                                        backgroundColor: isDarkmode ? '#334155' : '#f8fafc',
                                        borderRadius: 10,
                                        marginBottom: 10
                                    }}
                                >
                                    <View style={{ flex: 1, marginRight: 10 }}>
                                        <Text style={{ fontWeight: '600', fontSize: 16, marginBottom: 4 }} numberOfLines={1}>{t.taskName || "Untitled Task"}</Text>
                                        
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            {/* Assignee Avatar */}
                                            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', marginRight: 8, overflow: 'hidden' }}>
                                                {memberProfiles[t.assignedTo]?.photoURL ? (
                                                    <Image source={{ uri: memberProfiles[t.assignedTo].photoURL }} style={{ width: 24, height: 24 }} />
                                                ) : (
                                                    <Ionicons name="person" size={14} color="#64748b" />
                                                )}
                                            </View>
                                            
                                            <Text style={{ fontSize: 12, opacity: 0.8, flex: 1 }} numberOfLines={1}>
                                                {t.assignedTo === currentUserId ? "You" : (memberProfiles[t.assignedTo]?.displayName || "Unassigned")}
                                            </Text>
                                        </View>

                                        {t.date && (
                                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                                 <Ionicons name="calendar-outline" size={12} color={isDarkmode ? '#94a3b8' : '#64748b'} style={{ marginRight: 4 }} />
                                                 <Text style={{ fontSize: 11, opacity: 0.6 }}>
                                                    Due: {new Date(t.date).toLocaleDateString()}
                                                 </Text>
                                            </View>
                                        )}
                                    </View>
                                    <View style={{ backgroundColor: isDarkmode ? '#1e293b' : '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: isDarkmode ? '#475569' : '#e2e8f0' }}>
                                        <Text style={{ fontSize: 12, color: '#3b82f6' }}>Reassign</Text>
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                )}
            </View>
        </View>
      </Modal>

    </Layout>
  );
}
