// Removed import from TaskHooks to avoid circular dependency
// import { Task } from "./TaskHooks";

export const DEFAULT_PROJECT_ID = "MyPersonalProject";
export const DEFAULT_TEAM_ID = "MySelf";

export interface AICoordinationSettings {
  teamRef?: any; // serialized DocumentReference
  smartWorkloadBalancingEnabled: boolean;
  automationWeight: number;
  nudgeFrequency: "High" | "Medium" | "Low";
  skillThresholdHours: number;
  coordinationRules: string;
}

export interface WorkloadDistribution {
  teamRef?: any;
  userWorkloads: Record<string, number>; // userId -> load score
  totalCapacity: number;
  currentUtilization: number;
  overloadedUsers: string[];
  lastBalanced: number; // timestamp
}

export interface Team {
  id: string;
  name: string;
  description: string;
  aiSettings?: AICoordinationSettings;
  workload?: WorkloadDistribution;
  members: string[]; // User IDs
  createdAt: number;
}

export interface ProjectTimeline {
  startDate: number;
  endDate: number;
  actualStart?: number;
  actualEnd?: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: "Active" | "Completed" | "OnHold";
  timeline?: ProjectTimeline;
  teams: string[]; // Team IDs (though we might just query the subcollection)
  createdAt: number;
  createdBy: string;
}

// ============================================================================
// 📦 INTERFACES
// ============================================================================

export interface PriorityScore {
  urgencyScore: number;
  dependencyScore: number;
  effortScore: number;
  behaviorScore: number;
  finalPriority: number;
  explanation: string;
  breakdown?: {
    urgency: number;
    effort: number;
    dependencies: number;
    userPriority: number;
    focus: number;
  };
}

export interface TaskProgress {
  actualTimeSpent: number;
  lastUpdate: number;
  startDate?: number;
  completedDate?: number;
  isStalled: boolean;
}

export interface TaskDependencies {
  block: string[]; 
  blockedBy: string[];
}

export interface Task {
  key: string;
  taskName: string;
  listName: string;
  priority: string;
  dueDate: any;
  effort: string;
  isCompleted: boolean;
  notes?: string;
  attachments?: string[];
  priorityScore?: PriorityScore;
  progress?: TaskProgress;
  dependencies?: TaskDependencies; 
  _score?: number; 
  _dependencyMeta?: any;
  dependenciesList?: string[]; 
  projectId?: string;
  teamId?: string;
  assignedTo?: string;
  CreatedUser?: {
    CreatedUserId: string;
    CreatedUserName: string;
    CreatedUserPhoto?: string;
  };
}

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderPhoto?: string;
  createdAt: number;
}
