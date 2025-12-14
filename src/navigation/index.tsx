// src/navigation/index.tsx
import React, { useContext } from "react";
import { Platform } from "react-native";
import { getApps, initializeApp } from "firebase/app";
// @ts-ignore – available in RN bundle even if typings complain
import { initializeAuth, getReactNativePersistence, browserLocalPersistence } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { AuthContext } from "../provider/AuthProvider";
import { NavigationContainer } from "@react-navigation/native";

import Main from "./MainStack";
import Auth from "./AuthStack";
import Loading from "../screens/utils/Loading";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCh_I6y5GCLkzFRFdbl8Na69SomyiVBysI",
  authDomain: "myminiprojectjay.firebaseapp.com",
  projectId: "myminiprojectjay",
  storageBucket: "myminiprojectjay.firebasestorage.app",
  messagingSenderId: "96591390670",
  appId: "1:96591390670:web:7d80f3f3e61252b21d6d9f",
  measurementId: "G-17X825V6HB",
};

// Initialize Firebase + Auth persistence
let app;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);

  let persistence;
  if (Platform.OS === 'web') {
    persistence = browserLocalPersistence;
  } else {
    persistence = getReactNativePersistence(AsyncStorage);
  }

  initializeAuth(app, {
    persistence,
  });
}

export default function RootNavigation() {
  const auth = useContext(AuthContext);
  const user = auth.user;

  return (
    <NavigationContainer>
      {user == null && <Loading />}
      {user == false && <Auth />}
      {user == true && <Main />}
    </NavigationContainer>
  );
}
