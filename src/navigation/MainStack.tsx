import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import SecondScreen from "../screens/SecondScreen";
import MainTabs from "./MainTabs";
import ThirdScreen from "../screens/ThirdScreen";
import FourthScreen from "../screens/FourthScreen";
import MyMenu from "../screens/MyModule/MyMenu";
import QuestionAdd from "../screens/MyModule/QuestionAdd";
import QuestionList from "../screens/MyModule/QuestionList";
import BlogAdd from "../screens/MyModule/BlogAdd";
import BlogList from "../screens/MyModule/BlogList";
import MemoryFeed from "../screens/MemoryBook/MemoryFeed";
import MemoryUpload from "../screens/MemoryBook/MemoryUpload";
import MemoryComments from "../screens/MemoryBook/MemoryComments";
import MemoryStoryView from "../screens/MemoryBook/MemoryStoryView";
import NoteAdd from "../screens/MyModule/NoteAdd";
import NoteList from "../screens/MyModule/NoteList";
import TopicAdd from "../screens/MyModule/TopicAdd";
import TopicList from "../screens/MyModule/TopicList";
import MemorySearch from "../screens/MemoryBook/MemorySearch";
import MemoryReels from "../screens/MemoryBook/MemoryReels";
import MemoryProfile from "../screens/MemoryBook/MemoryProfile";
import MemoryPostView from "../screens/MemoryBook/MemoryPostView";
import TopicEdit from "../screens/MyModule/TopicEdit";
import TopicDetail from "../screens/MyModule/TopicDetail";
import PostAdd from "../screens/MyModule/PostAdd";
import CategoryList from "../screens/MyModule/CategoryList";
import CategoryAdd from "../screens/MyModule/CategoryAdd";
import QRCodeGenerate from "../screens/MyModule/QRCodeGenerate";
import QRCodeScan from "../screens/MyModule/QRCodeScan";
import ContactOwnerList from "../screens/MyModule/ContactOwnerList";
import MemoryChat from "../screens/MemoryBook/MemoryChat";
import MemoryChatsList from "../screens/MemoryBook/MemoryChatsList";
import MemoryMoodCalendar from "../screens/MemoryBook/MemoryMoodCalendar";
import MemoryAlbum from "../screens/MemoryBook/MemoryAlbum";
import MyVideo from "../screens/MyModule/MyVideo";
import MyChart from "../screens/MyModule/MyChart";
import MyAudio from "../screens/MyModule/MyAudio";
import MyLocalGenAI from "../screens/MyModule/MyLocalGenAI";
import PostCategoriesChart from "../screens/MyModule/PostCategoriesChart";
import MyPrint from "../screens/MyModule/MyPrint";


const MainStack = createNativeStackNavigator();

const Main = () => {
  return (
    <MainStack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <MainStack.Screen name="MainTabs" component={MainTabs} />
      <MainStack.Screen name="SecondScreen" component={SecondScreen} />
      <MainStack.Screen name="ThirdScreen" component={ThirdScreen} />
      <MainStack.Screen name="FourthScreen" component={FourthScreen} />

      <MainStack.Screen name="MyMenu" component={MyMenu} />
      <MainStack.Screen name="QuestionAdd" component={QuestionAdd} />
      <MainStack.Screen name="QuestionList" component={QuestionList} />
      <MainStack.Screen name="BlogAdd" component={BlogAdd} />
      <MainStack.Screen name="BlogList" component={BlogList} />

      <MainStack.Screen name="MemoryFeed" component={MemoryFeed} />
      <MainStack.Screen name="MemoryUpload" component={MemoryUpload} />
      <MainStack.Screen name="MemoryComments" component={MemoryComments} />
      <MainStack.Screen name="MemoryStoryView" component={MemoryStoryView} />
      <MainStack.Screen name="NoteAdd" component={NoteAdd} />
      <MainStack.Screen name="NoteList" component={NoteList} />
      <MainStack.Screen name="TopicAdd" component={TopicAdd} />
      <MainStack.Screen name="TopicList" component={TopicList} />
      <MainStack.Screen name="MemoryProfile" component={MemoryProfile} />
      <MainStack.Screen name="MemoryReels" component={MemoryReels} />
      <MainStack.Screen name="MemorySearch" component={MemorySearch} />
      <MainStack.Screen name="MemoryPostView" component={MemoryPostView} />
      <MainStack.Screen name="TopicEdit" component={TopicEdit} />
      <MainStack.Screen name="TopicDetail" component={TopicDetail} />
      <MainStack.Screen name="PostAdd" component={PostAdd} />
      <MainStack.Screen name="CategoryList" component={CategoryList} />
      <MainStack.Screen name="CategoryAdd" component={CategoryAdd} />
      <MainStack.Screen name="QRCodeGenerate" component={QRCodeGenerate} />
      <MainStack.Screen name="QRCodeScan" component={QRCodeScan} />
      <MainStack.Screen name="ContactOwnerList" component={ContactOwnerList} />
      <MainStack.Screen name="MemoryChat" component={MemoryChat} />
      <MainStack.Screen name="MemoryChatsList" component={MemoryChatsList} />
      <MainStack.Screen
        name="MemoryMoodCalendar"
        component={MemoryMoodCalendar}
      />
      <MainStack.Screen name="MemoryAlbum" component={MemoryAlbum} />
      <MainStack.Screen name="MyVideo" component={MyVideo} />
      <MainStack.Screen name="MyAudio" component={MyAudio} />
      <MainStack.Screen name="MyChart" component={MyChart} />
      <MainStack.Screen name="MyLocalGenAI" component={MyLocalGenAI} />
      <MainStack.Screen
        name="PostCategoriesChart"
        component={PostCategoriesChart}
      />
      <MainStack.Screen name="MyPrint" component={MyPrint} />

    </MainStack.Navigator>
  );
};

export default Main;
