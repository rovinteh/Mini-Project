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

  PostAdd: {
    title: string;
    description: string;
    category: string;
  };
  MemoryFloatingMenu: undefined;
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
