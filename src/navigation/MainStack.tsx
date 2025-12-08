import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import MainTabs from "./MainTabs";
import MemoryFeed from "../screens/MemoryBook/MemoryFeed";
import MemoryUpload from "../screens/MemoryBook/MemoryUpload";
import MemoryComments from "../screens/MemoryBook/MemoryComments";
import MemoryStoryView from "../screens/MemoryBook/MemoryStoryView";
import MemorySearch from "../screens/MemoryBook/MemorySearch";
import MemoryReels from "../screens/MemoryBook/MemoryReels";
import MemoryProfile from "../screens/MemoryBook/MemoryProfile";
import MemoryPostView from "../screens/MemoryBook/MemoryPostView";
import MemoryChat from "../screens/MemoryBook/MemoryChat";
import MemoryChatsList from "../screens/MemoryBook/MemoryChatsList";
import MemoryMoodCalendar from "../screens/MemoryBook/MemoryMoodCalendar";
import MemoryAlbum from "../screens/MemoryBook/MemoryAlbum";
import MemoryFloatingMenu from "../screens/MemoryBook/MemoryFloatingMenu";

const MainStack = createNativeStackNavigator();

const Main = () => {
  return (
    <MainStack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <MainStack.Screen name="MainTabs" component={MainTabs} />
      <MainStack.Screen name="MemoryUpload" component={MemoryUpload} />
      <MainStack.Screen name="MemoryComments" component={MemoryComments} />
      <MainStack.Screen name="MemoryStoryView" component={MemoryStoryView} />
      <MainStack.Screen name="MemoryProfile" component={MemoryProfile} />
      <MainStack.Screen name="MemoryReels" component={MemoryReels} />
      <MainStack.Screen name="MemorySearch" component={MemorySearch} />
      <MainStack.Screen name="MemoryPostView" component={MemoryPostView} />
      <MainStack.Screen name="MemoryChat" component={MemoryChat} />
      <MainStack.Screen name="MemoryChatsList" component={MemoryChatsList} />
      <MainStack.Screen
        name="MemoryMoodCalendar"
        component={MemoryMoodCalendar}
      />
      <MainStack.Screen name="MemoryAlbum" component={MemoryAlbum} />
      <MainStack.Screen name="MemoryFeed" component={MemoryFeed} />
      <MainStack.Screen
        name="MemoryFloatingMenu"
        component={MemoryFloatingMenu}
      />
    </MainStack.Navigator>
  );
};

export default Main;
