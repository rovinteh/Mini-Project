export type MainStackParamList = {
  MainTabs: undefined;
  SecondScreen: undefined;
  ThirdScreen: undefined;
  FourthScreen: undefined;
  MyMenu: undefined;
  QuestionAdd: undefined;
  QuestionList: undefined;
  BlogAdd: undefined;
  BlogList: undefined;
  MemoryFeed: undefined;
  QRCodeGenerate: undefined;
  QRCodeScan: undefined;
  ContactOwnerList: undefined;
  MemoryMoodCalendar: undefined;
  MemoryAlbum: undefined;
  MyVideo: undefined;
  MyAudio: undefined;
  MyChart: undefined;
  MyLocalGenAI: undefined;
  PostCategoriesChart: undefined;
  MyPrint: undefined;


  MemoryUpload:
    | {
        editMode?: boolean;
        postId?: string;
        postData?: any;
      }
    | undefined;

  MemoryComments: { postId: string };
  MemoryStoryView: { postId: string };
  NoteAdd: undefined;
  NoteList: undefined;
  TopicAdd: undefined;
  TopicList: undefined;
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
  CategoryList: {
    title: string;
    description: string;
    category: string;
  };
  CategoryAdd: undefined;

  TopicDetail: {
    key: string;
    title: string;
    description: string;
    imageURL: string;
    startDate: number;
    updatedDate: number;
    CreatedUser: any;
  };
  TopicEdit: {
    key: string;
    title: string;
    description: string;
    imageURL: string;
    startDate: number;
    updatedDate: number;
    CreatedUser: any;
  };
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
