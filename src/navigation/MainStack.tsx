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
import MemoryMediaViewer from "../screens/MemoryBook/MemoryMediaViewer";

import FitnessMenu from "../screens/Health&Fitness/FitnessMenu";
import LogMeal from "../screens/Health&Fitness/LogMeal";
import WeeklySummary from "../screens/Health&Fitness/WeeklySummary";
import WorkoutPreference from "../screens/Health&Fitness/WorkoutPreference";
import WorkoutSession from "../screens/Health&Fitness/WorkoutSession";

import TaskManagementMenu from "../screens/TaskManagementModule.tsx/TaskManagementMenu";
import TaskAdd from "../screens/TaskManagementModule.tsx/TaskAdd";
import TaskList from "../screens/TaskManagementModule.tsx/TaskList";
import TaskCalendar from "../screens/TaskManagementModule.tsx/TaskCalendar";
import AIAnalytics from "../screens/TaskManagementModule.tsx/AIAnalytics";
import TeamManagement from "../screens/TaskManagementModule.tsx/TeamManagement";

import MoneyManagementModule from "../screens/FinTrackPro/MoneyManagementModule"; //Money Management
import SpendingInsights from "../screens/FinTrackPro/SpendingInsights";
import TransactionAdd from "../screens/FinTrackPro/TransactionAdd";
import TransactionList from "../screens/FinTrackPro/TransactionList";
import ExpensesChart from "../screens/FinTrackPro/ExpensesChart";
import BudgetHub from "../screens/FinTrackPro/BudgetHub";

const MainStack = createNativeStackNavigator();

function Main() {
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

      <MainStack.Screen
        name="MemoryMediaViewer"
        component={MemoryMediaViewer}
        options={{
          headerShown: false,
        }}
      />
      <MainStack.Screen name="FitnessMenu" component={FitnessMenu} />
      <MainStack.Screen name="LogMeal" component={LogMeal} />
      <MainStack.Screen name="WeeklySummary" component={WeeklySummary} />
      <MainStack.Screen
        name="WorkoutPreference"
        component={WorkoutPreference}
      />
      <MainStack.Screen name="WorkoutSession" component={WorkoutSession} />

      <MainStack.Screen name="TaskAdd" component={TaskAdd} />
      <MainStack.Screen name="TaskList" component={TaskList} />
      <MainStack.Screen name="TaskCalendar" component={TaskCalendar} />
      <MainStack.Screen name="TeamManagement" component={TeamManagement} />
      <MainStack.Screen name="AIAnalytics" component={AIAnalytics} />
      <MainStack.Screen
        name="TaskManagementMenu"
        component={TaskManagementMenu}
      />

      <MainStack.Screen //Money Management
        name="MoneyManagementModule"
        component={MoneyManagementModule}
      />
      <MainStack.Screen name="SpendingInsights" component={SpendingInsights} />
      <MainStack.Screen name="TransactionAdd" component={TransactionAdd} />
      <MainStack.Screen name="TransactionList" component={TransactionList} />
      <MainStack.Screen name="ExpensesChart" component={ExpensesChart} />
      <MainStack.Screen name="BudgetHub" component={BudgetHub} />
    </MainStack.Navigator>
  );
}

export default Main;
