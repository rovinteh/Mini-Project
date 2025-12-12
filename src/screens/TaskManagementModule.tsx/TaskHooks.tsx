import { useState, useEffect, useMemo, useRef } from "react";
import { Alert, Platform } from "react-native";
import {
  Project, Team, WorkloadDistribution, AICoordinationSettings, Task, PriorityScore, TaskProgress, TaskDependencies,
  DEFAULT_PROJECT_ID, DEFAULT_TEAM_ID, ChatMessage
} from "./data";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  doc,
  collection,
  deleteDoc,
  updateDoc,
  arrayUnion,
  query,
  where,
  onSnapshot,
  getDoc,
  collectionGroup,
  setDoc,
  or,
  arrayRemove,
  addDoc,
  orderBy,
  limit
} from "firebase/firestore";
import {
  getStorage,
  ref,
  deleteObject,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

// ============================================================================
// 🔧 CONFIGURATION
// ============================================================================
export const CONFIG = {
  GEMINI_KEY: "AIzaSyC2dEPGBmrpHwhBHdByqQXU33R9Dz2dPIo",
  AI_TIMEOUT: 60000, 
};



export const COLORS = {
  primary: "#6366f1",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  purple: "#8b5cf6",
};

// ============================================================================
// 🛠️ UTILS
// ============================================================================
export const toDate = (v: any): Date | null => {
  if (!v) return null;
  // @ts-ignore
  if (typeof v?.toDate === "function") return v.toDate();
  try {
    return new Date(v);
  } catch {
    return null;
  }
};

export const formatDateKey = (date: Date) => date.toISOString().split("T")[0];

export const formatDisplayDate = (date: Date | null) => {
  if (!date) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getMonth()]} ${date.getDate()}`;
};

export const formatDetailedDate = (date: Date | null) => {
  if (!date) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = date.getDate();
  const m = months[date.getMonth()];
  const y = date.getFullYear();
  let hour = date.getHours();
  const min = date.getMinutes().toString().padStart(2, '0');
  const ampm = hour >= 12 ? 'pm' : 'am';
  hour = hour % 12;
  hour = hour ? hour : 12;
  return `${d} ${m} ${y} ${hour}:${min} ${ampm}`;
};

// ============================================================================
// 🔗 DEPENDENCY GRAPH UTILITIES
// ============================================================================

export const findBlockedTasks = (taskKey: string, allTasks: any[]): any[] => {
  return allTasks.filter(t => {
    if (t.isCompleted) return false;
    const deps = t.dependencies;
    const hasDependency = Array.isArray(deps) 
      ? deps.includes(taskKey) 
      : deps?.blockedBy?.includes(taskKey);
    return hasDependency || t.taskDependencies?.includes(taskKey);
  });
};

export const findBlockingTasks = (task: any, allTasks: any[]): any[] => {
  let depKeys: string[] = [];
  if (Array.isArray(task.dependencies)) {
    depKeys = task.dependencies;
  } else if (task.dependencies?.blockedBy && Array.isArray(task.dependencies.blockedBy)) {
    depKeys = task.dependencies.blockedBy;
  } else if (task.taskDependencies && Array.isArray(task.taskDependencies)) {
    depKeys = task.taskDependencies;
  }
  return allTasks.filter(t => 
    depKeys.includes(t.key) && !t.isCompleted
  );
};

export const calculateCascadeImpact = (taskKey: string, allTasks: any[], visited = new Set<string>()): number => {
  if (visited.has(taskKey)) return 0;
  visited.add(taskKey);
  
  const directlyBlocked = findBlockedTasks(taskKey, allTasks);
  let totalImpact = directlyBlocked.length;
  
  for (const blockedTask of directlyBlocked) {
    totalImpact += calculateCascadeImpact(blockedTask.key, allTasks, visited);
  }
  
  return totalImpact;
};

export const calculateDependencyDepth = (task: any, allTasks: any[], depth = 0, visited = new Set<string>()): number => {
  if (visited.has(task.key)) return depth;
  visited.add(task.key);
  
  const blockingTasks = findBlockingTasks(task, allTasks);
  
  if (blockingTasks.length === 0) return depth;
  
  const maxDepth = Math.max(
    ...blockingTasks.map(bt => calculateDependencyDepth(bt, allTasks, depth + 1, visited))
  );
  
  return maxDepth;
};

export const isCriticalPathTask = (taskKey: string, allTasks: any[]): boolean => {
  const blockedTasks = findBlockedTasks(taskKey, allTasks);
  return blockedTasks.some(t => t.priority === "High");
};





// ============================================================================
// 🧮 LOGIC
// ============================================================================

export const calculateFinalScore = (
  task: any,
  listLoadMap: Record<string, number> = {},
  allTasks: any[] = []
) => {
  // 1. URGENCY (50%): Time-based pressure
  let urgencyRaw = 0;
  let dueDate: Date | null = null;
  
  if (task.dueDate) {
    dueDate = toDate(task.dueDate);
    if (dueDate) {
      const now = new Date();
      const diffMs = dueDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) urgencyRaw = 1.0;          // Overdue / Today
      else if (diffDays <= 2) urgencyRaw = 0.8;     // 1-2 Days
      else if (diffDays <= 7) urgencyRaw = 0.4;     // Week
      else if (diffDays <= 14) urgencyRaw = 0.2;    // 2 Weeks
      else urgencyRaw = 0.05;                       // Long term
    }
  }

  // 2. IMPORTANCE (30%): User-defined value
  let userPriorityVal = 0.33; // Default Low
  if (task.priority === "High") userPriorityVal = 1.0;
  else if (task.priority === "Medium") userPriorityVal = 0.66;
  
  // 3. IMPACT (20%): Context (Deps 10% + Effort 5% + Focus 5%)
  
  // Dependencies (10%)
  let dependencyScore = 0;
  if (allTasks.length > 0) {
     const blockedBy = findBlockingTasks(task, allTasks).length; 
     const blocking = findBlockedTasks(task.key, allTasks).length;
     // Being blocked is bad/neutral, Blocking others makes me important
     dependencyScore = Math.min(blocking, 3) / 3; 
  } else {
     // Fallback
     const depCount = Array.isArray(task.dependencies) ? task.dependencies.length : 0;
     dependencyScore = Math.min(depCount, 3) / 3;
  }

  // Effort (5%) - Low effort = Quick Win = Bonus
  let effortVal = 0.5;
  if (task.effort === "Low") effortVal = 1.0;      // Quick win
  else if (task.effort === "High") effortVal = 0.2; // Slog

  // Focus (5%) - Recency
  let focusVal = 0.2;
  if (task.progress?.lastUpdate) {
    const days = (Date.now() - task.progress.lastUpdate) / 86400000;
    if (days < 1) focusVal = 1.0;
    else if (days < 3) focusVal = 0.6;
  }
  if (task.isCompleted) return -1;

  // WEIGHTED SUM (Transparent, No Adjustments)
  const scoreUrgency = urgencyRaw * 0.50;      // Max 50 pts
  const scorePriority = userPriorityVal * 0.30; // Max 30 pts
  const scoreDeps = dependencyScore * 0.10;     // Max 10 pts
  const scoreEffort = effortVal * 0.05;         // Max 5 pts
  const scoreFocus = focusVal * 0.05;           // Max 5 pts

  const finalScorePercent = (scoreUrgency + scorePriority + scoreDeps + scoreEffort + scoreFocus) * 100;
  
  task.priorityScore = {
    urgencyScore: urgencyRaw, 
    dependencyScore: dependencyScore,
    effortScore: effortVal,
    behaviorScore: userPriorityVal,
    breakdown: {
      urgency: scoreUrgency,
      userPriority: scorePriority,
      dependencies: scoreDeps,
      effort: scoreEffort,
      focus: scoreFocus
      // No boost needed
    },
    finalPriority: finalScorePercent / 100,
    explanation: `Urgency: ${Math.round(scoreUrgency*100)}%, Priority: ${Math.round(scorePriority*100)}%...` 
  };

  const finalScore = finalScorePercent / 100;
  return finalScore;
};

// ============================================================================
// 🔌 SERVICES
// ============================================================================
export const TaskService = {
  async toggleComplete(task: any, projectId: string = DEFAULT_PROJECT_ID, teamId: string = DEFAULT_TEAM_ID) {
    const db = getFirestore();
    const newStatus = !task.isCompleted;
    const updates: any = {
      isCompleted: newStatus,
    };

    if (newStatus) {
      const startDateVal = task.progress?.startDate ?? task.startDate ?? Date.now();
      const start = toDate(startDateVal)?.getTime() || Date.now();
      const durationMs = Date.now() - start;
      updates["progress.actualTimeSpent"] = durationMs;
      updates["progress.completedDate"] = Date.now();
    } else {
      updates["progress.completedDate"] = null;
    }

    let refStr = "Task";
    const targetProject = task.projectId || projectId;
    const targetTeam = task.teamId || teamId;
    
    if (targetProject && targetTeam) {
      refStr = `Projects/${targetProject}/Teams/${targetTeam}/Tasks`;
    }
    
    await updateDoc(doc(db, refStr, task.key), updates);
  },

  async updateTask(taskId: string, data: any, projectId: string = DEFAULT_PROJECT_ID, teamId: string = DEFAULT_TEAM_ID) {
    const db = getFirestore();
    let refStr = "Task";
    if (projectId && teamId) {
      refStr = `Projects/${projectId}/Teams/${teamId}/Tasks`;
    }
    await updateDoc(doc(db, refStr, taskId), {
      ...data,
      updatedDate: Date.now(),
    });
  },

  async deleteTask(taskId: string, attachments: string[] = [], projectId: string = DEFAULT_PROJECT_ID, teamId: string = DEFAULT_TEAM_ID) {
    const db = getFirestore();
    const storage = getStorage();
    
    let refStr = "Task";
    if (projectId && teamId) {
      refStr = `Projects/${projectId}/Teams/${teamId}/Tasks`;
    }

    await deleteDoc(doc(db, refStr, taskId));

    // Delete attachments
    await Promise.allSettled(
      attachments.map(async (u: string) => {
        try {
          const r = ref(storage, u);
          await deleteObject(r);
        } catch {}
      })
    );
  },

  async deleteAttachments(urls: string[]) {
    const storage = getStorage();
    await Promise.allSettled(
      urls.map(async (u) => {
        try {
          const r = ref(storage, u);
          await deleteObject(r);
        } catch {}
      })
    );
  },

  async uploadImages(locals: { uri: string }[]) {
    const storage = getStorage();
    if (!locals || !locals.length) return [] as string[];
    const uploads = await Promise.all(
      locals.map(async (item) => {
        const blob: Blob = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.onload = () => resolve(xhr.response as Blob);
          xhr.onerror = () => reject(new TypeError("Network request failed"));
          xhr.responseType = "blob";
          xhr.open("GET", item.uri, true);
          xhr.send(null);
        });
        const guid =
          Date.now().toString(16) + Math.random().toString(16).substring(2);
        const imageRef = ref(storage, `Task/${guid}`);
        await uploadBytes(imageRef, blob);
        return await getDownloadURL(imageRef);
      })
    );
    return uploads;
  },

  async moveTask(
    taskId: string, 
    data: any, 
    oldProjectId: string, 
    oldTeamId: string,
    newProjectId: string,
    newTeamId: string
  ) {
    const db = getFirestore();
    const oldPath = `Projects/${oldProjectId}/Teams/${oldTeamId}/Tasks/${taskId}`;
    const newPath = `Projects/${newProjectId}/Teams/${newTeamId}/Tasks/${taskId}`;
    
    if (oldPath === newPath) {
       return this.updateTask(taskId, data, oldProjectId, oldTeamId);
    }
    
    // 1. Create new doc (using setDoc to preserve ID, or addDoc if key change needed, but setDoc is better)
    // Note: We need setDoc imported.
    await setDoc(doc(db, newPath), {
        ...data,
        updatedDate: Date.now(),
        projectId: newProjectId,
        teamId: newTeamId
    });
    
    // 2. Delete old doc
    // Attachments can stay where they are (in Storage), URL is valid.
    await deleteDoc(doc(db, oldPath));
  }
};

export const AIService = {
  async generateBriefing(prompt: string) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), CONFIG.AI_TIMEOUT);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json" }
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(id);

      if (!response.ok) throw new Error(`Gemini API Error: ${response.status}`);
      const data = await response.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch (error) {
      console.error("🚁 Gemini Briefing Error:", error);
      return null;
    }
  },

  async generateInsights(prompt: string) {
      return generateGeminiInsights(prompt);
  }
};



// ============================================================================
// 🎣 HOOKS
// ============================================================================
export const useTaskData = (projectId?: string, teamId?: string) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [taskArray, setTaskArray] = useState<any[]>([]);
  const auth = getAuth();
  const db = getFirestore();

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setTaskArray([]);
        setLoading(false);
        return;
      }

      let q;
      if (projectId && teamId) {
          console.log("🔥 useTaskData: Querying path:", `Projects/${projectId}/Teams/${teamId}/Tasks`);
          q = collection(db, `Projects/${projectId}/Teams/${teamId}/Tasks`);
        } else {
          console.log("🔥 useTaskData: Querying GLOBAL 'Tasks' via collectionGroup for current user (Assigned Only)");
          // Simplified query to avoid permission/index issues with 'or' queries on collectionGroup
          q = query(collectionGroup(db, "Tasks"), where("assignedTo", "==", user.uid));
        }

      const unsubscribeSnapshot = onSnapshot(q, (querySnapshot) => {
        const arr: any[] = [];
        querySnapshot.forEach((docItem) => {
          const data = docItem.data();
          // Fallback to path if data missing IDs (Corrects "No document to update" error)
          let pid = data.projectId;
          let tid = data.teamId;
          
          if (!pid || !tid) {
             // Path: Projects/PID/Teams/TID/Tasks/DocID
             // ref.parent = Tasks collection
             // ref.parent.parent = Team Doc (TID)
             // ref.parent.parent.parent = Teams collection
             // ref.parent.parent.parent.parent = Project Doc (PID)
             if (docItem.ref.parent.parent) {
                tid = docItem.ref.parent.parent.id;
                if (docItem.ref.parent.parent.parent && docItem.ref.parent.parent.parent.parent) {
                    pid = docItem.ref.parent.parent.parent.parent.id;
                }
             }
          }
          
          arr.push({ ...data, key: docItem.id, projectId: pid, teamId: tid });
        });

        // Loop for score calculation (if needed)
        const tempListMap: Record<string, number> = {};
        arr.forEach(t => {
            if (!t.isCompleted) {
            const key = t.listName ?? "default";
            tempListMap[key] = (tempListMap[key] ?? 0) + 1;
            }
        });
        
        arr.forEach(task => {
            if (!task.priorityScore || !task.priorityScore.finalPriority) {
            calculateFinalScore(task, tempListMap, arr);
            }
        });

        setTaskArray(arr);
        setLoading(false);
      }, (err) => {
        console.error("🔥 TaskData Firestore Error:", err);
        setLoading(false);
        if (err.message.includes("index") || err.code === 'failed-precondition') {
             alert("⚠️ Missing Index: Please check your Metro Console (terminal) for the Firebase Index creation link. Tasks won't load until this is fixed.");
        }
      });

      return () => unsubscribeSnapshot();
    });

    return () => unsubscribeAuth();
  }, [projectId, teamId]);

  return { loading, taskArray, setTaskArray };
};




export const useProjectData = () => {
  const [ownedProjects, setOwnedProjects] = useState<Project[]>([]);
  const [memberProjects, setMemberProjects] = useState<Project[]>([]);
  const [memberProjectIds, setMemberProjectIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const auth = getAuth();
  const db = getFirestore();

  useEffect(() => {
    if (!auth.currentUser) return;
    
    // 1. Fetch Owned Projects
    const q1 = query(
      collection(db, "Projects"), 
      where("createdBy", "==", auth.currentUser.uid)
    );
    const unsub1 = onSnapshot(q1, (snap) => {
      const arr: Project[] = [];
      snap.forEach(d => arr.push({ ...d.data(), id: d.id } as Project));
      setOwnedProjects(arr);
    });

    // 2. Fetch Projects where Member (via Collection Group)
    // First, listen to TEAMS to get the project IDs
    const q2 = query(
        collectionGroup(db, "Teams"), 
        where("members", "array-contains", auth.currentUser.uid)
    );
    const unsub2 = onSnapshot(q2, (snap) => {
        const pids = new Set<string>();
        snap.docs.forEach(d => {
            if (d.ref.parent && d.ref.parent.parent) {
                pids.add(d.ref.parent.parent.id);
            }
        });
        setMemberProjectIds(Array.from(pids));
    }, (error) => {
        console.log("Member Projects Listener Error:", error);
    });

    setLoading(false);
    return () => { unsub1(); unsub2(); };
  }, []);

  // 3. Listen to Member Projects (Real-time updates)
  useEffect(() => {
    if (memberProjectIds.length === 0) {
        setMemberProjects([]);
        return;
    }
    
    // Listen to each project document individually
    const unsubs: (() => void)[] = [];

    memberProjectIds.forEach(pid => {
        if (!pid) return;
        const unsub = onSnapshot(doc(db, "Projects", pid), (snap) => {
             if (snap.exists()) {
                 const p = { ...snap.data(), id: snap.id } as Project;
                 setMemberProjects(prev => {
                    const map = new Map(prev.map(proj => [proj.id, proj]));
                    map.set(p.id, p);
                    return Array.from(map.values()).filter(x => memberProjectIds.includes(x.id));
                 });
             }
        }, (err) => console.log("Error listening to project " + pid, err));
        unsubs.push(unsub);
    });

    return () => { unsubs.forEach(u => u()); };
  }, [memberProjectIds]);

  // Merge and Deduplicate
  const projects = useMemo(() => {
      const map = new Map<string, Project>();
      ownedProjects.forEach(p => map.set(p.id, p));
      memberProjects.forEach(p => map.set(p.id, p));
      return Array.from(map.values());
  }, [ownedProjects, memberProjects]);

  const createProject = async (name: string) => {
    if (!auth.currentUser) return;
    // Create Project
    // Then Create Default Team
    const newProjRef = doc(collection(db, "Projects"));
    const projData: Project = {
      id: newProjRef.id,
      name,
      description: "My new project",
      status: "Active",
      teams: [], // will add default team ID here if we track it
      createdAt: Date.now(),
      createdBy: auth.currentUser.uid
    };
    await import("firebase/firestore").then(fs => fs.setDoc(newProjRef, projData));
    
    // Create Default Team
    const teamRef = doc(collection(db, `Projects/${newProjRef.id}/Teams`));
    const teamData: Team = {
      id: teamRef.id,
      name: "General",
      description: "General team",
      members: [auth.currentUser.uid],
      createdAt: Date.now()
    };
    await import("firebase/firestore").then(fs => fs.setDoc(teamRef, teamData));
  };

  
  const updateProject = async (projectId: string, data: Partial<Project>) => {
    if (!auth.currentUser) return;
    const ref = doc(db, "Projects", projectId);
    await updateDoc(ref, data);
  };

  return { projects, loading, createProject, updateProject };
};

export const useTeamData = (projectId: string | null) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const db = getFirestore();

  useEffect(() => {
    if (!projectId) {
      setTeams([]);
      return;
    }
    setLoading(true);
    const q = collection(db, `Projects/${projectId}/Teams`);
    const unsub = onSnapshot(q, (snap) => {
      const arr: Team[] = [];
      snap.forEach(d => arr.push({ ...d.data(), id: d.id } as Team));
      setTeams(arr);
      setLoading(false);
    });
    return () => unsub();
  }, [projectId]);

  const createTeam = async (name: string) => {
    if (!projectId) return;
    const ref = doc(collection(db, `Projects/${projectId}/Teams`));
    await import("firebase/firestore").then(fs => fs.setDoc(ref, {
      id: ref.id,
      name,
      description: "",
      members: [],
      createdAt: Date.now()
    } as Team));
  };

  const joinTeam = async (teamId: string, targetProjectId?: string): Promise<"success" | "already_joined" | "error"> => {
    const pid = targetProjectId || projectId;
    if (!pid || !teamId) return "error";
    const auth = getAuth();
    if (!auth.currentUser) return "error";
    
    try {
      const db = getFirestore();
      const ref = doc(db, `Projects/${pid}/Teams/${teamId}`);
      
      const snap = await getDoc(ref);
      if (snap.exists()) {
          const d = snap.data() as Team;
          if (d.members && d.members.includes(auth.currentUser.uid)) {
              return "already_joined"; 
          }
      }

      await updateDoc(ref, {
        members: arrayUnion(auth.currentUser.uid)
      });
      return "success";
    } catch (e) {
      console.error("Join Team Error", e);
      return "error";
    }
  };
  
  const updateTeam = async (teamId: string, data: Partial<Team>) => {
    if (!projectId || !teamId) return;
    const ref = doc(db, `Projects/${projectId}/Teams/${teamId}`);
    await updateDoc(ref, data);
  };
  
  const deleteTeam = async (teamId: string) => {
    if (!projectId || !teamId) return;
    const ref = doc(db, `Projects/${projectId}/Teams/${teamId}`);
    await deleteDoc(ref);
  };

  const removeMember = async (teamId: string, memberId: string) => {
    if (!projectId || !teamId) return;
    const ref = doc(db, `Projects/${projectId}/Teams/${teamId}`);
    await updateDoc(ref, {
        members: arrayRemove(memberId)
    });
  };

  return { teams, loading, createTeam, joinTeam, updateTeam, deleteTeam, removeMember };
};

export const useProjectTasks = (projectId: string | null, teamId: string | null) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const db = getFirestore();

  useEffect(() => {
    if (!projectId || !teamId) {
      setTasks([]);
      return;
    }
    setLoading(true);
    const q = collection(db, `Projects/${projectId}/Teams/${teamId}/Tasks`);
    
    const unsub = onSnapshot(q, (snap) => {
      const arr: any[] = [];
      snap.forEach(d => arr.push({ ...d.data(), key: d.id }));
      setTasks(arr);
      setLoading(false);
    });
    
    return () => unsub();
  }, [projectId, teamId]);

  return { tasks, loading };
};

export const useTaskGrouping = (taskArray: any[], selectedList: string | null, selectedDate: string, aiSortOn: boolean) => {
  const listLoadMap = useMemo(() => {
    const map: Record<string, number> = {};
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);
    nextWeek.setHours(23, 59, 59, 999);

    taskArray.forEach((t) => {
      if (t.isCompleted) return;
      
      const d = toDate(t.dueDate);
      // Only count active tasks (Today or This Week)
      // Exclude no-date (Backlog) and future > 7 days (Later)
      if (!d || d > nextWeek) return;

      const key = t.listName ?? "default";
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [taskArray]);

  const groupTasks = (tasks: any[]) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);
    nextWeek.setHours(23, 59, 59, 999);

    let filteredTasks = tasks;

    if (selectedList) {
      filteredTasks = filteredTasks.filter((t) => t.listName === selectedList);
    }
    
    
    const scoredTasks = filteredTasks.map((t) => ({
      ...t,
      _score: calculateFinalScore(t, listLoadMap, taskArray), 
    }));

    const groups = {
      Today: [] as any[],
      "This Week": [] as any[],
      Later: [] as any[],
      Completed: [] as any[],
    };

    scoredTasks.forEach((t) => {
      if (t.isCompleted) {
        groups.Completed.push(t);
        return;
      }
      const d = toDate(t.dueDate);
      if (!d) {
        groups.Later.push(t);
        return;
      }
      if (d <= today) {
        groups.Today.push(t);
      } else if (d <= nextWeek) {
        groups["This Week"].push(t);
      } else {
        groups.Later.push(t);
      }
    });

    Object.keys(groups).forEach((k) => {
      groups[k as keyof typeof groups].sort((a, b) => {
        if (aiSortOn) return b._score - a._score;
        const da = toDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const db = toDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (da === db) return b._score - a._score;
        return da - db;
      });
    });

    return [
      { title: "Today", data: groups.Today },
      { title: "This Week", data: groups["This Week"] },
      { title: "Later", data: groups.Later },
      { title: "Completed", data: groups.Completed },
    ].filter((s) => s.data.length > 0);
  };

  const sections = useMemo(() => groupTasks(taskArray), [taskArray, selectedList, selectedDate, aiSortOn, listLoadMap]);

  return { sections, listLoadMap };
};

// ============================================================================
// 🧠 AI TASK ANALYSIS HOOK (Ollama Real-Time)
// ============================================================================
// Module-level cache to persist insights across tab switches in the same session
let insightsCache: any = null;
let lastAnalyzedHash = "";

export const useAITaskAnalysis = (tasks: Task[] = [], provider: "gemini" | "ollama" = "gemini") => {
  const [aiBriefing, setAiBriefing] = useState("");
  const [aiBriefingLoading, setAiBriefingLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<any>(insightsCache);
  const [aiAccepted, setAiAccepted] = useState(false);
  const [focusTasks, setFocusTasks] = useState<Task[]>([]); // Tasks accepted by user

  // Helper to create a simple hash of task state to detect meaningful changes
  const getTaskHash = (tList: Task[]) => {
      return tList.map(t => `${t.key}_${t.isCompleted}_${t.dueDate ? toDate(t.dueDate)?.toISOString() : ''}`).join('|');
  };

  const analyzeTasksWithAI = async () => {
    // Basic debounce / check if we actually need to re-run
    const currentHash = getTaskHash(tasks);
    if (insightsCache && currentHash === lastAnalyzedHash) {
        console.log("⚡ AI Analysis: Using Cached Insights");
        setAiSuggestions(insightsCache);
        return;
    }

    if (tasks.filter(t => !t.isCompleted).length === 0) {
        setAiBriefing("No active tasks to analyze.");
        return;
    }

    setAiBriefingLoading(true);
    setAiBriefing("Analyzing your workload...");

    const startTime = Date.now();

    try {
      const pendingTasks = tasks.filter((t: any) => !t.isCompleted);
      
      const sortedPending = pendingTasks
        .map((t: any) => {
          let urgencyDays = 9999;
          const due = toDate(t.dueDate);
          if (due) {
            // Normalize to start of day for accurate day diff
            const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
            const today = new Date();
            const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            urgencyDays = Math.ceil((dueDay.getTime() - todayDay.getTime()) / (1000 * 3600 * 24));
          }
          return { ...t, _urgencyDays: urgencyDays };
        })
        .sort((a: any, b: any) => {
          if (a._urgencyDays !== b._urgencyDays) return a._urgencyDays - b._urgencyDays;
          const priorityOrder = { High: 1, Medium: 2, Low: 3 };
          // @ts-ignore
          const aPri = priorityOrder[a.priority] || 4;
          // @ts-ignore
          const bPri = priorityOrder[b.priority] || 4;
          return aPri - bPri;
        });
      
      const summary = sortedPending
        .slice(0, 15) // Analyze top 15 most urgent
        .map((t: any) => {
          const days = t._urgencyDays === 9999 ? null : t._urgencyDays;
          let dueStr = "no date";
          if (days !== null) {
            if (days < 0) dueStr = `⚠️ OVERDUE ${Math.abs(days)}d`;
            else if (days === 0) dueStr = `🔥 DUE TODAY`;
            else dueStr = `${days}d left`;
          }
          return `[${t.key}] ${t.taskName} (${t.priority || "Low"}, ${dueStr})`;
        })
        .join("\n");

      const prompt = `Analyze these tasks and recommend top 3 priorities.
      
CRITICAL RULES:
1. ID MUST MATCH EXACTLY.
2. Prioritize OVERDUE (⚠️) and TODAY (🔥).
3. Return valid JSON only.
4. When there is only 1 task, return it as rank 1, and do not return rank 2 and 3.
5. When there are only 2 tasks, return them as rank 1 and 2, and do not return rank 3.
Tasks:
${summary}

Response JSON Format:
{
  "summary": "Brief 1-sentence reason",
  "topTasks": [
    { "rank": 1, "id": "EXACT_ID_FROM_LIST", "reason": "short reason" },
    { "rank": 2, "id": "EXACT_ID_FROM_LIST", "reason": "short reason" },
    { "rank": 3, "id": "EXACT_ID_FROM_LIST", "reason": "short reason" }
  ]
  
}`;

      // Provider Selection: Gemini vs Ollama
      let text = null;
      if (provider === "ollama") {
         text = await generateOllamaInsights(prompt);
      } else {
         text = await generateGeminiInsights(prompt);
      }

      if (text) {
        try {
          const tryParse = (raw: string) => {
            const start = raw.indexOf("{");
            if (start === -1) return null;
            let candidate = raw.slice(start);
            const lastClose = candidate.lastIndexOf("}");
            if (lastClose !== -1) candidate = candidate.slice(0, lastClose + 1);
            return JSON.parse(candidate); // Try direct parse first
          };

          // Robust parsing for LLM output (which might have extra text/markdown)
          let parsed = tryParse(text);
          
          if (!parsed || !parsed.topTasks) {
             console.warn("AI Response JSON invalid, attempting repair...");
             // Simple repair if needed, but tryParse handles basics
             return; 
          }

          insightsCache = parsed;
          lastAnalyzedHash = currentHash;
          setAiSuggestions(parsed);
          setAiBriefing("");
          setAiAccepted(false);
        } catch (parseError) {
          console.error("❌ JSON Parse Error:", parseError, text);
          setAiBriefing("Could not parse AI response.");
        }
      } else {
        setAiBriefing("AI service returned no response.");
      }
    } catch (e: any) {
      console.error("AI Error:", e);
    } finally {
      setAiBriefingLoading(false);
    }
  };

  // AUTO-TRIGGER ON MOUNT OR CHANGE
  // We use a timeout to debounce rapid changes (e.g. typing or multiple edits)
  useEffect(() => {
      const timer = setTimeout(() => {
          analyzeTasksWithAI();
      }, 2000); // 2s debounce
      return () => clearTimeout(timer);
  }, [getTaskHash(tasks)]); // Check hash to trigger 
  
  return {
    aiBriefing,
    aiBriefingLoading,
    aiSuggestions,
    aiAccepted,
    setAiAccepted,
    setAiSuggestions,
    analyzeTasksWithAI,
    focusTasks,
    setFocusTasks,
  };
};

// ============================================================================
// 👥 MEMBER PROFILES HOOK
// ============================================================================
export const useMemberProfiles = (userIds: string[]) => {
  const [profiles, setProfiles] = useState<Record<string, { displayName: string, photoURL: string }>>({});
  const db = getFirestore();
  
  // Create a stable key for dependency array
  const idsKey = userIds ? userIds.sort().join(',') : '';

  useEffect(() => {
      if (!userIds || userIds.length === 0) return;

      const fetchProfiles = async () => {
          const newProfiles = { ...profiles };
          let hasChange = false;

          await Promise.all(userIds.map(async (uid) => {
              if (newProfiles[uid]) return; // Skip if already fetched

              try {
                  const snap = await getDoc(doc(db, "users", uid));
                  if (snap.exists()) {
                      const data = snap.data();
                      newProfiles[uid] = { 
                          displayName: data.displayName || "Unknown Member", 
                          photoURL: data.photoURL 
                      };
                      hasChange = true;
                  }
              } catch (e) {
                  console.log("Error fetching user profile", uid, e);
              }
          }));

          if (hasChange) {
              setProfiles(newProfiles);
          }
      };

      fetchProfiles();
  }, [idsKey]);

  return profiles;
};

// ============================================================================
// 💬 CHAT HOOK
// ============================================================================
export const useTeamMessages = (projectId: string | null, teamId: string | null) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const db = getFirestore();

    const sendMessage = async (text: string, user: any) => {
        if (!projectId || !teamId || !text.trim()) return;
        
        try {
            await addDoc(collection(db, `Projects/${projectId}/Teams/${teamId}/Messages`), {
                text: text.trim(),
                senderId: user.uid,
                senderName: user.displayName || "Unknown",
                senderPhoto: user.photoURL || null,
                createdAt: Date.now()
            });
        } catch (e) {
            console.error("SendMessage Error:", e);
            Alert.alert("Error", "Failed to send message");
        }
    };

    useEffect(() => {
        if (!projectId || !teamId) {
            setMessages([]);
            return;
        }

        setLoading(true);
        const q = query(
            collection(db, `Projects/${projectId}/Teams/${teamId}/Messages`),
            orderBy("createdAt", "asc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as ChatMessage[];
            setMessages(msgs);
            setLoading(false);
        }, (err) => {
            console.error("Chat Listener Error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [projectId, teamId]);

    return { messages, loading, sendMessage };
};
// ============================================================================
// 🤖 AI SUMMARY HOOK
// ============================================================================

const summaryCache: Record<string, string> = {};

// --- GEMINI INSIGHTS GENERATOR ---
const generateGeminiInsights = async (prompt: string) => {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { response_mime_type: "application/json" }
                }),
            }
        );

        if (!response.ok) throw new Error(`Gemini API Error: ${response.status}`);

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        return text || null;
    } catch (error) {
        console.error("❌ Gemini Insights Error:", error);
        return null;
    }
};

// --- RESTORED OLLAMA INSIGHTS GENERATOR ---
export const generateOllamaSummary = async (messages: string[], teamName: string) => {
    try {
        const prompt = `
Act as a strict data extraction engine. Analyze the following team conversation for the "${teamName}" team.
Extract ONLY relevant details. Output a JSON object.

Instructions:
- Ignore the messages of greetings, pleasantries, "Testing", one-word messages Like "HAHAHA","Hello","Welcome".
- Categorize content into "Update", "Action", "Blocker".
- **CRITICAL**: Every item MUST start with "Sender Name (DD-MMM-YYYY HH:MM AM/PM) - ".
- Example: "Rovin (11-Dec-2025 05:00 PM) - Task completed"
- Do NOT output empty categories.

JSON Format:
{
  "Update": ["Sender (Date Time) - Content", ...],
  "Action": ["Sender (Date Time) - Content", ...],
  "Blocker": ["Sender (Date Time) - Content", ...]
}

Conversation:
${messages.map(m => `- ${m}`).join("\n")}
        `;

        // Use localhost for Web, and LAN IP for Mobile
        const OLLAMA_HOST = Platform.OS === 'web' ? 'localhost' : '192.168.0.16'; 
        const OLLAMA_API_URL = `http://${OLLAMA_HOST}:11434/api/generate`;

        const response = await fetch(OLLAMA_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama3.2:3b",
                prompt: prompt,
                stream: false,
                format: "json",
                options: { temperature: 0.1 }
            }),
        });

        if (!response.ok) throw new Error("Ollama connection failed");
        const data = await response.json();
        
        // Handle both direct JSON response or embedded JSON in response property
        let text = data.response;
        // Attempt parsing if it looks like JSON object string
        try {
             const json = JSON.parse(text);
             if (json.response) text = json.response; 
        } catch {}

        return text || "No insights generated.";

    } catch (error) {
        console.error("❌ Ollama Summary Error:", error);
        return null;
    }
};

// Generic Ollama Generator for Task Analysis
const generateOllamaInsights = async (prompt: string) => {
    try {
        const OLLAMA_HOST = Platform.OS === 'web' ? 'localhost' : '192.168.0.16'; 
        const OLLAMA_API_URL = `http://${OLLAMA_HOST}:11434/api/generate`;

        const response = await fetch(OLLAMA_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama3.2:3b",
                prompt: prompt,
                stream: false,
                format: "json",
                options: { temperature: 0.1 }
            }),
        });

        if (!response.ok) throw new Error("Ollama connection failed");
        const data = await response.json();
        
        // Handle both direct JSON response or embedded JSON in response property
        let text = data.response;
        try {
             const json = JSON.parse(text);
             if (json.response) text = json.response; 
        } catch {}

        return text;

    } catch (error) {
        console.error("❌ Ollama Insights Error:", error);
        return null;
    }
};

export const useTeamConversationSummary = (projectId: string | null, teamId: string | null, teamName: string) => {
    const [summary, setSummary] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const db = getFirestore();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null); // Use ref for timeout cleanup

    useEffect(() => {
        if (!projectId || !teamId) return;

        const cacheKey = `${projectId}_${teamId}_v3`;
        
        // 1. Load Initial Cache IMMEDIATELY or RESET
        if (summaryCache[cacheKey]) {
            setSummary(summaryCache[cacheKey]);
        } else {
            setSummary(null); // Clear previous team's summary to avoid leak
        }

        // 2. Subscribe to Real-Time Updates
        setLoading(true);
        const q = query(
            collection(db, `Projects/${projectId}/Teams/${teamId}/Messages`),
            orderBy("createdAt", "desc"),
            limit(50)
        );

        const unsubscribe = onSnapshot(q, (snap) => {
            if (snap.empty) {
                setSummary("No conversation history found.");
                setLoading(false);
                return;
            }

            // Prepare messages for AI
            const messages = snap.docs.map(d => {
                const data = d.data();
                const sender = data.senderName || "Unknown";
                const text = data.text || "";
                const date = new Date(data.createdAt).toLocaleString(undefined, { 
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                });
                return `[${date}] ${sender}: ${text}`;
            }).reverse();

            // 3. Debounce the AI Call (Wait 5 seconds after last message)
            if (timeoutRef.current) clearTimeout(timeoutRef.current);

            timeoutRef.current = setTimeout(async () => {
                // Determine if we actually need to summarize (simple hash or length check could opt here)
                // For now, always summarize on change, but with delay
                try {
                    setLoading(true);
                    const summaryText = await generateOllamaSummary(messages, teamName);
                    if (summaryText) {
                        summaryCache[cacheKey] = summaryText;
                        setSummary(summaryText);
                    }
                } catch (err) {
                    console.error("Auto-Summary Error:", err);
                } finally {
                    setLoading(false);
                }
            }, 5000); 
        }, (err) => {
            console.error("Summary Snapshot Error:", err);
            setLoading(false);
        });

        return () => {
            unsubscribe();
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [projectId, teamId]);

    return { summary, loading };
};

export const useUserTeamsStats = () => {
    const [stats, setStats] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const auth = getAuth();
    const db = getFirestore();

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoading(false);
            return;
        }

        const q = query(
            collectionGroup(db, 'Teams'),
            where('members', 'array-contains', user.uid)
        );

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            const tempStats: any[] = [];
            
            // Map team docs to promises to fetch Project names
            const promises = snapshot.docs.map(async (docSnap) => {
                const teamData = docSnap.data();
                const memberCount = teamData.members?.length || 0;
                
                // Firestore path: Projects/{projectId}/Teams/{teamId}
                // docSnap.ref.parent = Teams collection
                // docSnap.ref.parent.parent = Project document ref
                const projectRef = docSnap.ref.parent.parent;
                
                let projectName = "Unknown Project";
                if (projectRef) {
                    const projectSnap = await getDoc(projectRef);
                    if (projectSnap.exists()) {
                        projectName = projectSnap.data().name || "Untitled";
                    }
                }

                return {
                    teamName: teamData.name || "Unnamed Team",
                    projectName: projectName,
                    value: memberCount
                };
            });

            const results = await Promise.all(promises);
            // Sort by Project Name for grouping
            results.sort((a, b) => a.projectName.localeCompare(b.projectName));
            
            setStats(results);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    return { stats, loading };
};

export const useProjectNameResolver = (projectIds: string[]) => {
    const [projectNames, setProjectNames] = useState<Record<string, string>>({});
    const db = getFirestore();

    useEffect(() => {
        const fetchNames = async () => {
             const uniqueIds = Array.from(new Set(projectIds)).filter(id => id && id !== DEFAULT_PROJECT_ID);
             if (uniqueIds.length === 0) {
                 setProjectNames({ [DEFAULT_PROJECT_ID]: "Personal" });
                 return;
             }
             
             // Chunk requests if needed, but for now simple promise all
             const promises = uniqueIds.map(pid => getDoc(doc(db, "Projects", pid)));
             const projectDocs = await Promise.all(promises);
             
             const nameMap: Record<string, string> = {
                 [DEFAULT_PROJECT_ID]: "Personal"
             };
             
             projectDocs.forEach(snap => {
                 if (snap.exists()) {
                     nameMap[snap.id] = snap.data().name || "Untitled Project";
                 }
             });
             
             setProjectNames(nameMap);
        };

        fetchNames();
    }, [JSON.stringify(projectIds)]);

    return projectNames;
};

// ============================================================================
// 📊 PROJECT STATS HOOK (Chart Specific)
// ============================================================================
export const useProjectFullTasks = (projectIds: string[]) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const db = getFirestore();

  useEffect(() => {
    if (!projectIds || projectIds.length === 0) {
        setTasks([]);
        setLoading(false);
        return;
    }

    const activeIds = projectIds.slice(0, 10);
    if (activeIds.length === 0) {
        setLoading(false);
        return;
    }

    setLoading(true);
    try {
        const q = query(
            collectionGroup(db, 'Tasks'),
            where('projectId', 'in', activeIds)
        );
    
        const unsubscribe = onSnapshot(q, (snap) => {
            const arr: any[] = [];
            snap.forEach(doc => {
                arr.push({ ...doc.data(), id: doc.id });
            });
            setTasks(arr);
            setLoading(false);
        }, (err) => {
            console.error("ProjectStats Error:", err);
            setLoading(false);
            if (err.code === 'failed-precondition' || err.message.includes('index')) {
                 Alert.alert("Missing Index", "Check your terminal for the Firestore Index link. Charts require a new index.");
            }
        });
        
        return () => unsubscribe();
    } catch (e) {
        console.log("Query setup error:", e);
        setLoading(false);
    }
  }, [JSON.stringify(projectIds)]);

  return { tasks, loading };
};
