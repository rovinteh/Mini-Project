export type MainStackParamList = {
  MainTabs: undefined;
  MemoryFeed: undefined;
  QRCodeGenerate: undefined;
  QRCodeScan: undefined;
  MemoryMoodCalendar: undefined;
  MemoryAlbum: undefined;
  MemoryUpload:
    | {
        editMode?: boolean;
        postId?: string;
        postData?: any;
      }
    | undefined;

  MemoryComments: { postId: string };
  MemoryStoryView: { postId: string };
  MemorySearch: undefined;
  MemoryReels: undefined;
  MemoryProfile: undefined;
  MemoryPostView: {
    postId: string;
    startIndex?: number;
  };
  MemoryChatsList: undefined;
  MemoryChat: {
    peerId: string;
    peerName: string;
  };
MemoryNotifications: undefined;
  PostAdd: {
    title: string;
    description: string;
    category: string;
  };
  MemoryFloatingMenu: undefined;
  FitnessMenu: undefined;
  LogMeal: undefined;
  WeeklySummary: undefined;
  WorkoutPreference: undefined;
  WorkoutSession: undefined;
  TaskAdd:
    | { presetDate?: string; projectId?: string; teamId?: string }
    | undefined;
  TaskManagementMenu: undefined;
  TeamManagement: undefined;
  AIAnalytics:
    | {
        projects?: any[];
        tasks?: any[];
        metrics?: {
          pendingCount: number;
          dueTodayCount: number;
          overdueCount: number;
          urgentCount: number;
          completedThisWeek: number;
          plannedThisWeek: number;
          efficiency: number;
        };
      }
    | undefined;
  TaskList: undefined;
  TaskCalendar: undefined;
  TaskChart: undefined;
  TaskQRScanner: undefined;

  //Money Management
  MoneyManagementModule: undefined;
  SpendingInsights: undefined;
  TransactionAdd: { transactionId?: string } | undefined;
  TransactionList: undefined;
  ExpensesChart: undefined;
  BudgetHub: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgetPassword: undefined;
};

export type MainTabsParamList = {
  Home: undefined;
  Profile: undefined;
  About: undefined;
};
